import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ProviderRegistry } from "../../src/core/provider";
import { TransactionsBuilder } from "../../src/resources/transactions/builder";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";
import { TransactionsListQueryBuilder } from "../../src/dsl/transactions";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

function makeRegistry(opts?: {
	failover?: boolean;
	defaultLimit?: number;
	maxLimit?: number;
	// when provided, primary get throws Error; failover succeeds
	primaryThrows?: boolean;
	// specific 404 for byId()
	primary404?: boolean;
}) {
	const calls: Array<{ kind: "get"; path: string; params?: any }> = [];

	const failover = !!opts?.failover;
	const defaultProvider = "prov";
	const defaultNetwork = "net";
	const page = {
		defaultLimit: opts?.defaultLimit ?? 25,
		maxLimit: opts?.maxLimit ?? 100,
	};

	const TXID = "0.0.100-1700000000-000000123";

	const listResponse = { transactions: [{ t: 1 }], links: { next: null } };
	const oneResponse = { transactions: [{ transaction_id: TXID, result: "SUCCESS" }] };

	const respond = (path: string) => {
		if (path === "/api/v1/transactions") {
			return { json: async () => listResponse, text: async () => JSON.stringify(listResponse) };
		}
		if (path.startsWith("/api/v1/transactions/")) {
			return { json: async () => oneResponse, text: async () => JSON.stringify(oneResponse) };
		}
		return { json: async () => ({}), text: async () => "{}" };
	};

	const registry = {
		resolve: vi.fn((provider?: string, network?: string) => ({
			provider: provider ?? defaultProvider,
			network: network ?? defaultNetwork,
			baseUrl: `https://${provider ?? defaultProvider}.${network ?? defaultNetwork}.mirror.test`,
			page,
		})),

		get: vi.fn(async (_target: any, path: string, params?: any) => {
			calls.push({ kind: "get", path, params });
			if (opts?.primary404 && path.startsWith("/api/v1/transactions/")) {
				throw new HttpError(404, "not found");
			}
			if (opts?.primaryThrows) {
				// Simulate internal failover for retryable errors when failover is enabled
				if (failover) {
					return respond(path);
				}
				throw new Error("primary down");
			}
			return respond(path);
		}),

		isFailoverEnabled: vi.fn(() => failover),

		getLogger: vi.fn(() => ({
			debug: vi.fn(),
			warn: vi.fn(),
		})),
	} as unknown as ProviderRegistry;
	(registry as any).getWithTarget = vi.fn(async (...args: any[]) => {
		const [target, path, params] = args;
		const response = await (registry.get as any)(...args);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});

	return {
		registry,
		calls,
		TXID,
		listResponse,
		oneResponse,
		reset: () => (calls.length = 0),
	};
}

function makeCache() {
	const store = new Map<string, any>();
	return {
		one: {
			enabled: true,
			ttlSeconds: 60,
			get: vi.fn(async (network: string, k: string) => store.get(`${network}:${k}`)),
			set: vi.fn(async (network: string, k: string, v: any) => store.set(`${network}:${k}`, v)),
		},
	};
}

describe("TransactionsBuilder — component behavior", () => {
	describe("byId()", () => {
		it("returns TransactionByIdResponse and caches when useCache=true; subsequent call hits cache", async () => {
			const { registry, TXID, oneResponse, calls } = makeRegistry();
			const caches = makeCache();

			//@ts-ignore
			const builder = new TransactionsBuilder(registry, "prov", "net", { one: caches.one });

			// FIRST call: hits network, caches
			const res1 = await builder.byId((q) => q.transactionId(TXID).useCache(true)).get();
			expect(res1).toEqual(oneResponse);
			expect(caches.one.set).toHaveBeenCalledTimes(1);
			expect(caches.one.set).toHaveBeenCalledWith("net", expect.any(String), oneResponse, 60);
			expect(calls.filter((c) => c.kind === "get").length).toBe(1);

			// SECOND call: should hit cache (no additional network call)
			const res2 = await builder.byId((q) => q.transactionId(TXID).useCache(true)).get();
			expect(res2).toEqual(oneResponse);
			expect(calls.filter((c) => c.kind === "get").length).toBe(1); // unchanged
			expect(caches.one.get).toHaveBeenCalledTimes(2); // two lookups
		});

		it("404 → empty array (no failover)", async () => {
			const { registry, TXID } = makeRegistry({ primary404: true, failover: false });
			const builder = new TransactionsBuilder(registry);

			const res = await builder.byId((q) => q.transactionId(TXID)).get();
			expect(res).toEqual({ transactions: [] });
		});

		it("failover: primary throws, secondary succeeds", async () => {
			const { registry, TXID, oneResponse, calls } = makeRegistry({ primaryThrows: true, failover: true });
			const builder = new TransactionsBuilder(registry);

			const res = await builder.byId((q) => q.transactionId(TXID)).get();
			expect(res).toEqual(oneResponse);

			// Only one get() call (failover is internal)
			expect(calls.length).toBe(1);
			expect(calls[0].kind).toBe("get");
		});
	});

	describe("list()", () => {
		it("wires params and numeric limit untouched", async () => {
			const { registry, calls, listResponse } = makeRegistry();
			const builder = new TransactionsBuilder(registry);

			const dsl = new TransactionsListQueryBuilder()
				.accountId()
				.greaterThanOrEqualTo("0.0.500")
				.timestamp()
				.greaterThan("1700000000")
				.timestamp()
				.lessThanOrEqualTo("1700001000")
				.transactionType("CRYPTOTRANSFER")
				.result("success")
				.transferType("credit")
				.order("desc")
				.limit(50);

			// Expected params via mapper parity
			const expected = TransactionsMapper.list(dsl.build());

			const page = await builder.list(() => dsl).get();
			expect(page.transactions).toEqual(listResponse.transactions);

			// Verify the actual call wiring
			const last = calls[calls.length - 1];
			expect(last.path).toBe("/api/v1/transactions");
			expect(last.params).toEqual(expected); // numeric 50 unchanged because maxLimit=100
		});

		it("resolves 'default' and 'max' limits via resolveLimitValue", async () => {
			const { registry, calls } = makeRegistry({ defaultLimit: 25, maxLimit: 100 });
			const builder = new TransactionsBuilder(registry);

			// default
			await builder.list((q) => q.limit("default")).get();
			const c1 = calls[calls.length - 1];
			expect(c1.params.limit).toBe(25);

			// max
			await builder.list((q) => q.limit("max")).get();
			const c2 = calls[calls.length - 1];
			expect(c2.params.limit).toBe(100);
		});

		it("failover: primary throws, secondary succeeds", async () => {
			const { registry, calls, listResponse } = makeRegistry({ primaryThrows: true, failover: true });
			const builder = new TransactionsBuilder(registry);

			const page = await builder.list((q) => q.accountId("0.0.123").transactionType("CRYPTORECEIPT").order("asc").limit(10)).get();

			expect(page.transactions).toEqual(listResponse.transactions);

			// Only one get() call (failover is internal)
			expect(calls.length).toBe(1);
			expect(calls[0].kind).toBe("get");
			expect(calls[0].path).toBe("/api/v1/transactions");
		});
	});
});
