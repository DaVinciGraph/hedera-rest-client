// tests/resources/accounts.builder.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AccountsBuilder } from "../../src/resources/accounts/builder";
import { AccountsMapper } from "../../src/resources/accounts/mapper";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// A minimal response wrapper emulating fetch-like Response.json()
class FakeResponse {
	private body: any;
	constructor(body: any) {
		this.body = body;
	}
	async json() {
		return this.body;
	}
	async text() {
		return JSON.stringify(this.body);
	}
}

/**
 * A very small ProviderRegistry test double.
 * - Records calls to get()
 * - Allows enqueuing results/errors per call
 * - Provides page limits via target stub
 * - Simulates failover internally (like the real ProviderRegistry)
 */
class FakeRegistry {
	public getCalls: Array<{ target: any; path: string; params: any }> = [];

	public getQueue: any[] = [];
	public failoverEnabled = false;

	getLogger() {
		return {
			debug: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
		};
	}

	isFailoverEnabled() {
		return this.failoverEnabled;
	}

	// Signature used by builder: registry.get(target, path, params)
	// Now handles failover internally like the real implementation
	async get(target: any, path: string, params?: any, _signal?: AbortSignal) {
		this.getCalls.push({ target, path, params });
		const item = this.getQueue.shift();

		// If it's an error and failover is enabled, simulate failover
		if (item instanceof Error) {
			if (this.failoverEnabled && item instanceof HttpError && (item.status === 429 || item.status >= 500)) {
				// Simulate failover: try next item in queue
				const failoverItem = this.getQueue.shift();
				if (failoverItem instanceof Error) throw failoverItem;
				const res = failoverItem ?? { accounts: [], links: { next: null } };
				return new FakeResponse(res);
			}
			throw item;
		}

		const res = item ?? { accounts: [], links: { next: null } };
		return new FakeResponse(res);
	}

	async getWithTarget(target: any, path: string, params?: any, signal?: AbortSignal) {
		const response = await this.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	}

	// Provided for symmetry (not used by these tests)
	resolve(_provider?: string, _network?: string) {
		return {
			provider: _provider ?? "public",
			network: _network ?? "testnet",
			page: { defaultLimit: 25, maxLimit: 100 },
			baseUrl: "https://example.test",
		};
	}
}

/** Common resolved target used by tests (we’ll inject it via builder.resolve). */
const TARGET = {
	provider: "public",
	network: "testnet",
	page: { defaultLimit: 25, maxLimit: 100 },
	baseUrl: "https://example.test",
};

beforeEach(() => {
	vi.restoreAllMocks();
});

/* =====================================================================================
 * list(): limit resolution
 * ===================================================================================*/

describe("AccountsBuilder.list — limit resolution", () => {
	it("resolves limit('default') to target.page.defaultLimit", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ accounts: [], links: { next: null } });

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		// Inject a fixed resolve() so resolveLimitValue gets our known limits
		(builder as any).resolve = () => TARGET;

		await builder.list((q) => q.limit("default")).get();

		expect(registry.getCalls.length).toBe(1);
		const call = registry.getCalls[0];
		expect(call.path).toBe("/api/v1/accounts");
		expect(call.params.limit).toBe(25); // defaultLimit
	});

	it("resolves limit('max') to target.page.maxLimit", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ accounts: [], links: { next: null } });

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		await builder.list((q) => q.limit("max")).get();

		expect(registry.getCalls.length).toBe(1);
		expect(registry.getCalls[0].params.limit).toBe(100); // maxLimit
	});

	it("passes numeric limit as-is", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ accounts: [], links: { next: null } });

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		await builder.list((q) => q.limit(3)).get();

		expect(registry.getCalls.length).toBe(1);
		expect(registry.getCalls[0].params.limit).toBe(3);
	});

	it("omits limit when not provided", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ accounts: [], links: { next: null } });

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		await builder.list().get();

		expect(registry.getCalls.length).toBe(1);
		expect("limit" in registry.getCalls[0].params).toBe(false);
	});

	it("also resolves limit correctly in legacy object mode", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ accounts: [], links: { next: null } });

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		await builder.list({ includeBalance: true, limit: "max" } as any).get();

		expect(registry.getCalls.length).toBe(1);
		expect(registry.getCalls[0].params).toMatchObject({ balance: true, limit: 100 });
	});
});

/* =====================================================================================
 * list(): paging (next page)
 * ===================================================================================*/

describe("AccountsBuilder.list — paging (next)", () => {
	it("returns a page object and provides a working next() that fetches the next page", async () => {
		const registry = new FakeRegistry();
		const firstRaw = {
			accounts: [{ account: "0.0.1" }],
			links: { next: "/api/v1/accounts?limit=1&account.id=0.0.2" },
		};
		const secondRaw = {
			accounts: [{ account: "0.0.2" }],
			links: { next: null },
		};
		registry.getQueue.push(firstRaw, secondRaw);

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		const page1 = await builder.list((q) => q.limit(1)).get();

		// Expect first call and mapped content
		expect(registry.getCalls.length).toBe(1);
		expect(registry.getCalls[0].params.limit).toBe(1);
		expect(Array.isArray(page1.accounts)).toBe(true);
		expect(page1.accounts).toEqual(firstRaw.accounts);

		// If wrapPaged exposes .next, use it to retrieve the second page
		expect(typeof (page1 as any).next).toBe("function");
		const page2 = await (page1 as any).next();

		expect(registry.getCalls.length).toBe(2); // second fetch happened
		expect(page2.accounts).toEqual(secondRaw.accounts);

		// The second call should have been made to the 'next' path
		expect(registry.getCalls[1].path.includes("/api/v1/accounts")).toBe(true);
	});
});

/* =====================================================================================
 * list(): failover
 * ===================================================================================*/

describe("AccountsBuilder.list — failover", () => {
	it("registry.get handles failover internally when error is retryable", async () => {
		const registry = new FakeRegistry();
		registry.failoverEnabled = true;

		// First item: retryable error (500), second item: success from failover
		registry.getQueue.push(new HttpError(500, "internal server error"));
		const raw = { accounts: [{ account: "0.0.9" }], links: { next: null } };
		registry.getQueue.push(raw);

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		const page = await builder.list((q) => q.limit(2)).get();

		// Only one get call was made by the builder (failover is internal to registry.get)
		expect(registry.getCalls.length).toBe(1);
		expect(registry.getCalls[0].path).toBe("/api/v1/accounts");
		expect(registry.getCalls[0].params.limit).toBe(2);

		expect(page.accounts).toEqual(raw.accounts);
	});
});

/* =====================================================================================
 * one(): cache, 404 handling, and failover
 * ===================================================================================*/

describe("AccountsBuilder.one — cache hit", () => {
	it("returns cached result and does not call registry when cache hits", async () => {
		const registry = new FakeRegistry();

		const cached = { account: "0.0.1234", balance: { balance: 1 } };
		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (_network: string, _k: string) => cached),
			set: vi.fn(async () => {}),
		};

		const builder = new AccountsBuilder(registry as any, "public", "testnet", cache as any);
		(builder as any).resolve = () => TARGET;

		const out = await builder
			.one({
				idOrAliasOrEvmAddress: "0.0.1234",
				transactions: true,
				useCache: true,
			} as any)
			.get();

		expect(out).toMatchObject(cached);
		expect(typeof out?.next).toBe("function");
		await expect(out?.next()).resolves.toBeNull();
		expect(registry.getCalls.length).toBe(0);
		expect(cache.get).toHaveBeenCalledTimes(1);

		// Cache key payload is created by AccountsMapper; we can verify it looked plausible:
		expect((cache.get as any).mock.calls[0][0]).toBe("testnet");
		const keyUsed = (cache.get as any).mock.calls[0][1] as string;
		expect(keyUsed.startsWith("accounts:0.0.1234:")).toBe(true);
	});

	it("reconstructs transaction-history pagination from cached raw data", async () => {
		const registry = new FakeRegistry();
		const nextPath = "/api/v1/accounts/0.0.1234?limit=1&timestamp=lt%3A1700000000.000000001";
		const cached = {
			account: "0.0.1234",
			transactions: [{ consensus_timestamp: "1700000000.000000001" }],
			links: { next: nextPath },
		};
		const secondRaw = {
			account: "0.0.1234",
			transactions: [{ consensus_timestamp: "1699999999.000000001" }],
			links: { next: null },
		};
		registry.getQueue.push(secondRaw);

		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async () => cached),
			set: vi.fn(async () => {}),
		};
		const builder = new AccountsBuilder(registry as any, "public", "testnet", cache as any);
		(builder as any).resolve = () => TARGET;

		const first = await builder
			.one({ idOrAliasOrEvmAddress: "0.0.1234", limit: 1, transactions: true, useCache: true } as any)
			.get();

		expect(first?.links).toEqual(cached.links);
		expect(first?.next.url()).toBe(`https://example.test${nextPath}`);
		expect(registry.getCalls).toHaveLength(0);

		const second = await first?.next();
		expect(registry.getCalls).toHaveLength(1);
		expect(registry.getCalls[0].path).toBe(nextPath);
		expect(second?.transactions).toEqual(secondRaw.transactions);
		expect(second?.links).toEqual(secondRaw.links);
		await expect(second?.next()).resolves.toBeNull();
	});
});

describe("AccountsBuilder.one — cache miss stores result", () => {
	it("calls registry and caches the fresh result on miss", async () => {
		const registry = new FakeRegistry();
		const fresh = { account: "0.0.2222", balance: { balance: 5 } };
		registry.getQueue.push(fresh);

		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (_network: string, _k: string) => undefined),
			set: vi.fn(async (_network: string, _k: string, _v: any, _ttl: number) => {}),
		};

		const builder = new AccountsBuilder(registry as any, "public", "testnet", cache as any);
		(builder as any).resolve = () => TARGET;

		const query = {
			idOrAliasOrEvmAddress: "0.0.2222",
			order: "desc",
			limit: 10,
			useCache: true,
		} as any;

		const expectedKey = AccountsMapper.one(query).cacheKey;

		const out = await builder.one(query).get();

		expect(out).toMatchObject(fresh);
		expect(typeof out?.next).toBe("function");
		expect(registry.getCalls.length).toBe(1);
		expect(cache.get).toHaveBeenCalledTimes(1);
		expect(cache.set).toHaveBeenCalledTimes(1);
		expect((cache.set as any).mock.calls[0][0]).toBe("testnet");
		expect((cache.set as any).mock.calls[0][1]).toBe(expectedKey);
		expect((cache.set as any).mock.calls[0][2]).toEqual(fresh);
		expect((cache.set as any).mock.calls[0][2]).not.toHaveProperty("next");
		expect((cache.set as any).mock.calls[0][3]).toBe(600);
	});

	it("retains raw account fields and follows embedded transaction pagination", async () => {
		const registry = new FakeRegistry();
		const nextPath = "/api/v1/accounts/0.0.2222?limit=1&timestamp=lt%3A1700000000.000000001";
		const firstRaw = {
			account: "0.0.2222",
			transactions: [{ consensus_timestamp: "1700000000.000000001" }],
			links: { next: nextPath },
		};
		const secondRaw = {
			account: "0.0.2222",
			transactions: [{ consensus_timestamp: "1699999999.000000001" }],
			links: { next: null },
		};
		registry.getQueue.push(firstRaw, secondRaw);

		const builder = new AccountsBuilder(registry as any, "public", "testnet");
		(builder as any).resolve = () => TARGET;

		const first = await builder.one({ idOrAliasOrEvmAddress: "0.0.2222", limit: 1 } as any).get();
		expect(first).toMatchObject(firstRaw);
		expect(first?.next.url()).toBe(`https://example.test${nextPath}`);

		const second = await first?.next();
		expect(registry.getCalls).toHaveLength(2);
		expect(registry.getCalls[1].path).toBe(nextPath);
		expect(second).toMatchObject(secondRaw);
		await expect(second?.next()).resolves.toBeNull();
	});

	it("keys symbolic limits by the final request so provider-specific limits cannot collide", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push({ account: "0.0.2222", source: "wide" }, { account: "0.0.2222", source: "narrow" });
		registry.resolve = ((provider?: string) => ({
			provider: provider ?? "wide",
			network: "testnet",
			page: { defaultLimit: 25, maxLimit: provider === "narrow" ? 25 : 100 },
			baseUrl: "https://example.test",
		})) as any;

		const store = new Map<string, any>();
		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (network: string, key: string) => store.get(`${network}:${key}`)),
			set: vi.fn(async (network: string, key: string, value: any) => {
				store.set(`${network}:${key}`, value);
			}),
		};
		const builder = new AccountsBuilder(registry as any, "wide", "testnet", cache as any);

		const wide = await builder.one({ idOrAliasOrEvmAddress: "0.0.2222", limit: "max" }).get();
		const narrow = await builder.provider("narrow").one({ idOrAliasOrEvmAddress: "0.0.2222", limit: "max", useCache: true }).get();
		const wideHit = await builder.provider("wide").one({ idOrAliasOrEvmAddress: "0.0.2222", limit: "max", useCache: true }).get();

		expect(wide).toMatchObject({ source: "wide" });
		expect(narrow).toMatchObject({ source: "narrow" });
		expect(wideHit).toMatchObject({ account: "0.0.2222", source: "wide" });
		expect(typeof wideHit?.next).toBe("function");
		expect(registry.getCalls).toHaveLength(2);
		expect(registry.getCalls[0].params.limit).toBe(100);
		expect(registry.getCalls[1].params.limit).toBe(25);
		expect(cache.set.mock.calls.map(([, key]) => key)).toEqual([
			'accounts:0.0.2222:{"limit":100}',
			'accounts:0.0.2222:{"limit":25}',
		]);
	});
});

describe("AccountsBuilder.one — 404 returns null (no failover, no cache set)", () => {
	it("returns null when registry.get throws HttpError(404)", async () => {
		const registry = new FakeRegistry();
		registry.getQueue.push(new HttpError(404, "not found"));

		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (_network: string, _k: string) => undefined),
			set: vi.fn(async (_network: string, _k: string, _v: any, _ttl: number) => {}),
		};

		const builder = new AccountsBuilder(registry as any, "public", "testnet", cache as any);
		(builder as any).resolve = () => TARGET;

		const out = await builder
			.one({
				idOrAliasOrEvmAddress: "0.0.3333",
				useCache: true,
			} as any)
			.get();

		expect(out).toBeNull();
		expect(registry.getCalls.length).toBe(1);
		expect(cache.set).not.toHaveBeenCalled();
	});
});

describe("AccountsBuilder.one — failover on non-404 error and cache set after success", () => {
	it("tries failover when non-404 and isFailoverEnabled=true; caches success", async () => {
		const registry = new FakeRegistry();
		registry.failoverEnabled = true;

		// First: retryable error, Second: success from failover
		registry.getQueue.push(new HttpError(503, "service unavailable"));
		const fresh = { account: "0.0.4444", balance: { balance: 7 } };
		registry.getQueue.push(fresh);

		const cache = {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (_network: string, _k: string) => undefined),
			set: vi.fn(async (_network: string, _k: string, _v: any, _ttl: number) => {}),
		};

		const builder = new AccountsBuilder(registry as any, "public", "testnet", cache as any);
		(builder as any).resolve = () => TARGET;

		const query = {
			idOrAliasOrEvmAddress: "0.0.4444",
			useCache: true,
		} as any;
		const expectedKey = AccountsMapper.one(query).cacheKey;

		const out = await builder.one(query).get();

		expect(out).toMatchObject(fresh);
		expect(typeof out?.next).toBe("function");
		expect(registry.getCalls.length).toBe(1); // Builder only calls once, failover is internal
		expect(cache.set).toHaveBeenCalledTimes(1);
		expect((cache.set as any).mock.calls[0][0]).toBe("testnet");
		expect((cache.set as any).mock.calls[0][1]).toBe(expectedKey);
	});
});
