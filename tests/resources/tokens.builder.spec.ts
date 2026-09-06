// tests/resources/tokens.builder.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokensBuilder } from "../../src/resources/tokens/builder";
import { ProviderRegistry } from "../../src/core/provider";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// Minimal dummy Response-like wrapper
class DummyResponse<T> {
	constructor(private payload: T) {}
	async json() {
		return this.payload;
	}
	async text() {
		return JSON.stringify(this.payload);
	}
}

function makeRegistry({
	defaultLimit = 25,
	maxLimit = 50,
	failover = false,
	firstGetThrows,
	pathMap,
}: {
	defaultLimit?: number;
	maxLimit?: number;
	failover?: boolean;
	firstGetThrows?: (path: string) => any;
	pathMap: Record<string, any>;
}) {
	const calls: Array<{ path: string; params?: any }> = [];
	let firstCallMap = new Map<string, boolean>();

	const reg = {
		resolve: vi.fn(() => ({
			provider: "public",
			network: "testnet",
			baseUrl: "https://testnet.mirrornode.hedera.com",
			page: { defaultLimit, maxLimit },
		})),
		getLogger: vi.fn(() => ({
			debug: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
		})),
		isFailoverEnabled: vi.fn(() => failover),
		get: vi.fn(async (_target: any, path: string, params?: any) => {
			calls.push({ path, params });
			
			// Check if this path should throw on first call
			if (firstGetThrows && firstGetThrows(path)) {
				const isFirstCall = !firstCallMap.has(path);
				firstCallMap.set(path, true);
				
				if (isFirstCall) {
					const err = firstGetThrows(path);
					// If failover is enabled and error is retryable, simulate internal failover success
					if (failover && err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
						// Simulate internal failover: return success
						const key = path;
						if (!(key in pathMap)) throw new Error(`No stub for ${path}`);
						return new DummyResponse(pathMap[key]);
					}
					// Otherwise throw the error
					if (err instanceof Error) throw err;
					throw new Error("boom");
				}
			}
			
			const key = path;
			if (!(key in pathMap)) throw new Error(`No stub for ${path}`);
			return new DummyResponse(pathMap[key]);
		}),
		post: vi.fn(),
	} as unknown as ProviderRegistry;
	(reg as any).getWithTarget = vi.fn(async (...args: any[]) => {
		const [target, path, params] = args;
		const response = await (reg.get as any)(...args);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});

	return { reg, calls };
}

describe("TokensBuilder — behavior (limit, paging, cache, failover, 404)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("list(): resolves 'max' and 'default' limits; passes params to GET; returns page", async () => {
		const path = "/api/v1/tokens";
		const page1 = {
			tokens: [{ token_id: "0.0.1" }],
			links: { next: `${path}?next=abc` },
		};
		const page2 = {
			tokens: [{ token_id: "0.0.2" }],
			links: { next: null },
		};

		const { reg, calls } = makeRegistry({
			defaultLimit: 25,
			maxLimit: 50,
			pathMap: {
				[path]: page1,
				[`${path}?next=abc`]: page2,
			},
		});

		const b = new TokensBuilder(reg, "public", "testnet");
		// Using DSL with requested limit "max" -> clamp to 50
		const page = await b.list((q) => q.tokenId().greaterThan("0.0.100").order("asc").limit("max")).get();

		// First call
		expect(calls[0].path).toBe(path);
		expect(calls[0].params).toEqual({
			"token.id": "gt:0.0.100",
			order: "asc",
			limit: 50, // resolved
		});

		// Ensure page shape is returned and has the mapped items
		expect(page.tokens).toEqual([{ token_id: "0.0.1" }]);

		// If your wrapPaged exposes .next(), call it; otherwise skip.
		if ((page as any).next) {
			const next = await (page as any).next();
			expect(calls[1].path).toBe(`${path}?next=abc`);
			expect(next.tokens).toEqual([{ token_id: "0.0.2" }]);
		}
	});

	it("one(): useCache → hit on second call; 404 → null; failover stores cache", async () => {
		const path = "/api/v1/tokens/0.0.9";

		// First scenario: success, caching
		{
			const tokenResp = { token_id: "0.0.9", symbol: "TOK" };
			const cacheStore = new Map<string, any>();
			const tokenCache = {
				enabled: true,
				ttlSeconds: 600,
				get: vi.fn(async (network: string, k: string) => cacheStore.get(`${network}:${k}`)),
				set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => cacheStore.set(`${network}:${k}`, v)),
			};
			const { reg, calls } = makeRegistry({
				pathMap: { [path]: tokenResp },
			});

			//@ts-ignore
			const b = new TokensBuilder(reg, "public", "testnet", { token: tokenCache, nft: undefined as any });

			const q = (q: any) => q.tokenId("0.0.9").useCache(true);
			const out1 = await b.one(q).get();
			expect(out1).toEqual(tokenResp);
			// cache should be set
			expect(tokenCache.set).toHaveBeenCalledTimes(1);
			expect(tokenCache.set).toHaveBeenCalledWith("testnet", "token:0.0.9:", tokenResp, 600);

			// second call should hit cache (no new GET call)
			const out2 = await b.one(q).get();
			expect(out2).toEqual(tokenResp);
			expect(calls.length).toBe(1); // only the first GET happened
			expect(tokenCache.get).toHaveBeenCalled();
		}

		// Second scenario: 404 -> null
		{
			const notFound = new HttpError(404, "not found" as any);
			const { reg } = makeRegistry({
				pathMap: {}, // unused
				firstGetThrows: (p) => (p === path ? notFound : undefined),
			});

			const b = new TokensBuilder(reg, "public", "testnet", undefined as any);
			const out = await b.one((q) => q.tokenId("0.0.9").useCache(false)).get();
			expect(out).toBeNull();
		}

		// Third scenario: failover path (retryable error), still cached
		{
			const tokenResp = { token_id: "0.0.9", symbol: "TOK2" };
			const cacheStore = new Map<string, any>();
			const tokenCache = {
				enabled: true,
				ttlSeconds: 600,
				get: vi.fn(async (network: string, k: string) => cacheStore.get(`${network}:${k}`)),
				set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => cacheStore.set(`${network}:${k}`, v)),
			};
			const failErr = new HttpError(503, "service unavailable");
			const { reg } = makeRegistry({
				failover: true,
				firstGetThrows: (p) => (p === path ? failErr : undefined),
				pathMap: { [path]: tokenResp },
			});

			//@ts-ignore
			const b = new TokensBuilder(reg, "public", "testnet", { token: tokenCache, nft: undefined as any });
			const out = await b.one((q) => q.tokenId("0.0.9").useCache(true)).get();
			expect(out).toEqual(tokenResp);
			expect(tokenCache.set).toHaveBeenCalledTimes(1);
		}
	});

	it("balances(): resolves 'default' to per-network defaultLimit and passes params", async () => {
		const path = "/api/v1/tokens/0.0.7/balances";
		const resp = {
			balances: [{ account: "0.0.3", balance: 10 }],
			timestamp: "1700000000.000000000",
			links: { next: null },
		};

		const { reg, calls } = makeRegistry({
			defaultLimit: 25,
			maxLimit: 50,
			pathMap: { [path]: resp },
		});

		const b = new TokensBuilder(reg, "public", "testnet");
		const page = await b.balances((q) => q.tokenId("0.0.7").accountId().lessThan("0.0.100").accountBalance().greaterThan(0).timestamp("gte:1700000000").order("asc").limit("default")).get();

		expect(calls[0].path).toBe(path);
		expect(calls[0].params).toEqual({
			"account.id": "lt:0.0.100",
			"account.balance": "gt:0",
			timestamp: ["gte:1700000000"],
			order: "asc",
			limit: 25, // resolved to default
		});

		expect(page.balances).toEqual([{ account: "0.0.3", balance: 10 }]);
		//@ts-ignore
		expect(page?.timestamp).toBe("1700000000.000000000");
	});

	it("nfts(): passes params and resolves numeric limit unchanged", async () => {
		const path = "/api/v1/tokens/0.0.42/nfts";
		const resp = { nfts: [{ token_id: "0.0.42", serial_number: 1 }], links: { next: null } };

		const { reg, calls } = makeRegistry({
			pathMap: { [path]: resp },
		});

		const b = new TokensBuilder(reg, "public", "testnet");
		const page = await b.nfts((q) => q.tokenId("0.0.42").accountId("0.0.2").serialNumber().greaterThanOrEqualTo(10).order("desc").limit(3)).get();

		expect(calls[0].path).toBe(path);
		expect(calls[0].params).toEqual({
			"account.id": "0.0.2",
			serialnumber: "gte:10",
			order: "desc",
			limit: 3,
		});

		expect(page.nfts).toEqual([{ token_id: "0.0.42", serial_number: 1 }]);
	});

	it("nft(): useCache; 404 -> null; failover caches", async () => {
		const path = "/api/v1/tokens/0.0.5/nfts/7";

		// success + cache
		{
			const resp = { token_id: "0.0.5", serial_number: 7 };
			const cacheStore = new Map<string, any>();
			const nftCache = {
				enabled: true,
				ttlSeconds: 600,
				get: vi.fn(async (network: string, k: string) => cacheStore.get(`${network}:${k}`)),
				set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => cacheStore.set(`${network}:${k}`, v)),
			};
			const { reg, calls } = makeRegistry({ pathMap: { [path]: resp } });

			//@ts-ignore
			const b = new TokensBuilder(reg, "public", "testnet", { token: undefined as any, nft: nftCache });

			const q = (q: any) => q.tokenId("0.0.5").serialNumber(7).useCache(true);
			const out1 = await b.nft(q).get();
			expect(out1).toEqual(resp);
			expect(nftCache.set).toHaveBeenCalledTimes(1);
			expect(nftCache.set).toHaveBeenCalledWith("testnet", "nft:0.0.5:7", resp, 600);

			const out2 = await b.nft(q).get();
			expect(out2).toEqual(resp);
			expect(calls.length).toBe(1);
			expect(nftCache.get).toHaveBeenCalled();
		}

		// 404 → null
		{
			const notFound = new HttpError(404, "nf" as any);
			const { reg } = makeRegistry({
				pathMap: {},
				firstGetThrows: (p) => (p === path ? notFound : undefined),
			});

			const b = new TokensBuilder(reg, "public", "testnet", undefined as any);
			const out = await b.nft((q) => q.tokenId("0.0.5").serialNumber(7).useCache(false)).get();
			expect(out).toBeNull();
		}

		// failover caches (retryable error)
		{
			const resp = { token_id: "0.0.5", serial_number: 7 };
			const cacheStore = new Map<string, any>();
			const nftCache = {
				enabled: true,
				ttlSeconds: 600,
				get: vi.fn(async (network: string, k: string) => cacheStore.get(`${network}:${k}`)),
				set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => cacheStore.set(`${network}:${k}`, v)),
			};
			const failErr = new HttpError(500, "internal server error");
			const { reg } = makeRegistry({
				failover: true,
				firstGetThrows: (p) => (p === path ? failErr : undefined),
				pathMap: { [path]: resp },
			});

			//@ts-ignore
			const b = new TokensBuilder(reg, "public", "testnet", { token: undefined as any, nft: nftCache });
			const out = await b.nft((q) => q.tokenId("0.0.5").serialNumber(7).useCache(true)).get();
			expect(out).toEqual(resp);
			expect(nftCache.set).toHaveBeenCalledTimes(1);
		}
	});

	it("nftTransactions(): timestamp filters (array) + order/limit", async () => {
		const path = "/api/v1/tokens/0.0.77/nfts/12/transactions";
		const resp = { transactions: [{ tid: "0.0.1-1700000000-000000001" }], links: { next: null } };

		const { reg, calls } = makeRegistry({ pathMap: { [path]: resp } });

		const b = new TokensBuilder(reg, "public", "testnet");
		const page = await b.nftTransactions((q) => q.tokenId("0.0.77").serialNumber(12).timestamp("gte:1700000000").timestamp("1700000005.000000123").order("desc").limit(2)).get();

		expect(calls[0].path).toBe(path);
		expect(calls[0].params).toEqual({
			timestamp: ["gte:1700000000", "1700000005.000000123"],
			order: "desc",
			limit: 2,
		});

		expect(page.transactions).toEqual([{ tid: "0.0.1-1700000000-000000001" }]);
	});
});
