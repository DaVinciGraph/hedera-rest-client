import { describe, it, expect, vi } from "vitest";
import { BalancesBuilder } from "../../src/resources/balances/builder";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// Minimal Response-like helper
const mkRes = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body) } as any);

// A small raw response that wrapPaged can consume
const sampleResponse = {
	balances: [
		{ account: "0.0.100", balance: 1000 },
		{ account: "0.0.101", balance: 2000 },
	],
	timestamp: "1700000000.123456789",
	links: { next: null },
};

function makeRegistry({
	defaultLimit = 25,
	maxLimit = 100,
	failover = false,
	getImpl,
}: {
	defaultLimit?: number;
	maxLimit?: number;
	failover?: boolean;
	getImpl?: (target: any, path: string, params?: any) => Promise<any>;
}) {
	let callCount = 0;
	const get = vi.fn(async (target: any, path: string, params?: any) => {
		callCount++;
		if (getImpl) {
			// If custom implementation throws and failover is enabled, simulate failover
			try {
				return await getImpl(target, path, params);
			} catch (err) {
				if (failover && err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
					// Simulate failover success on second call
					return mkRes(sampleResponse);
				}
				throw err;
			}
		}
		return mkRes(sampleResponse);
	});

	const registry: any = {
		get,
		isFailoverEnabled: vi.fn(() => failover),
		getLogger: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn() })),
		resolve: vi.fn((_p?: string, _n?: string) => ({
			provider: _p ?? "public",
			network: _n ?? "testnet",
			baseUrl: "https://example.test",
			page: { defaultLimit, maxLimit },
		})),
	};
	registry.getWithTarget = vi.fn(async (target: any, path: string, params?: any, signal?: AbortSignal) => {
		const response = await registry.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});
	return registry;
}

describe("BalancesBuilder — list()", () => {
	it("applies limit resolution for 'default' (object form)", async () => {
		const registry = makeRegistry({ defaultLimit: 42, maxLimit: 777 });
		const b = new BalancesBuilder(registry as any, "public", "testnet");

		await b.list({ limit: "default" } as any).get();

		// Inspect call
		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, , params] = registry.get.mock.calls[0];
		expect(params.limit).toBe(42);
	});

	it("applies limit resolution for 'max' (DSL form)", async () => {
		const registry = makeRegistry({ defaultLimit: 11, maxLimit: 333 });
		const b = new BalancesBuilder(registry as any, "public", "testnet");

		await b.list((q) => q.limit("max")).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, , params] = registry.get.mock.calls[0];
		expect(params.limit).toBe(333);
	});

	it("passes through other params from DSL", async () => {
		const registry = makeRegistry({});
		const b = new BalancesBuilder(registry as any, "public", "testnet");

		await b.list((q) => q.accountId("0.0.123").accountBalance().greaterThan(1000).timestamp().lessThanOrEqualTo("1700000100").order("desc").limit(10)).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe("/api/v1/balances");
		expect(params["account.id"]).toBe("0.0.123");
		expect(params["account.balance"]).toBe("gt:1000");
		expect(params["timestamp"]).toEqual(["lte:1700000100"]);
		// limit will be replaced by resolver, but still a number
		expect(typeof params["limit"]).toBe("number");
		expect(params["order"]).toBe("desc");
	});

	it("failover: registry.get handles failover internally when primary throws retryable error", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(503, "service unavailable");
			},
		});
		const b = new BalancesBuilder(registry as any, "public", "testnet");

		const page = await b.list({ order: "asc", limit: 3 } as any).get();

		// Builder calls registry.get once; failover is internal
		expect(registry.get).toHaveBeenCalledTimes(1);

		// Returned page shape (wrapPaged mapping) - failover succeeded
		expect(page.balances).toHaveLength(2);
		expect(page.timestamp).toBe("1700000000.123456789");
	});
});
