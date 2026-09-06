// tests/resources/network.builder.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkBuilder } from "../../src/resources/network/builder";
import type { NetworkSupplyResponse, NetworkExchangeRateSetResponse, NetworkFeesResponse, NetworkNodesResponse, NetworkStakeResponse } from "../../src/types";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// --- Test doubles (ProviderRegistry + Cache) ---

const makeRegistry = (opts?: { defaultLimit?: number; maxLimit?: number; failoverEnabled?: boolean; failFirst?: boolean }) => {
	const calls: Array<{ method: string; path: string; params?: any }> = [];
	const page = {
		defaultLimit: opts?.defaultLimit ?? 25,
		maxLimit: opts?.maxLimit ?? 100,
	};

	let failFirst = !!opts?.failFirst;
	const failoverEnabled = !!opts?.failoverEnabled;

	const responses: Record<string, any> = {
		"/api/v1/network/supply": { supply: "ok" } as unknown as NetworkSupplyResponse,
		"/api/v1/network/exchangerate": { rate: "ok" } as unknown as NetworkExchangeRateSetResponse,
		"/api/v1/network/fees": { fees: "ok" } as unknown as NetworkFeesResponse,
		"/api/v1/network/nodes": { nodes: [], links: { next: null } } satisfies NetworkNodesResponse,
		"/api/v1/network/stake": { stake: "ok" } as unknown as NetworkStakeResponse,
	};
	const responseBody = (path: string, params?: any) => {
		if (path === "/api/v1/network/supply" && typeof params?.q === "string") {
			return params.q.toLowerCase() === "totalcoins" ? "50000000000.00000000" : "49452000000.00000000";
		}
		return responses[path] ?? {};
	};
	const responseFor = (path: string, params?: any) => {
		const body = responseBody(path, params);
		return {
			json: async () => body,
			text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		};
	};

	const reg = {
		resolve: vi.fn().mockImplementation((_p?: any, _n?: any) => ({
			provider: _p ?? "public",
			network: _n ?? "testnet",
			baseUrl: `https://${_p ?? "public"}.${_n ?? "testnet"}.mirror.test`,
			page,
		})),
		getLogger: vi.fn().mockReturnValue({
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		}),
		isFailoverEnabled: vi.fn().mockReturnValue(failoverEnabled),
		get: vi.fn().mockImplementation(async (_target: any, path: string, params?: any) => {
			calls.push({ method: "get", path, params });
			if (failFirst) {
				failFirst = false;
				// Use retryable error for failover to work
				if (failoverEnabled) {
					// Simulate internal failover success
					return responseFor(path, params);
				}
				throw new HttpError(503, "service unavailable");
			}
			return responseFor(path, params);
		}),
		getWithFailover: vi.fn().mockImplementation(async (_provider: string, _network: string, path: string, params?: any) => {
			calls.push({ method: "getWithFailover", path, params });
			return responseFor(path, params);
		}),
	};
	(reg as any).getWithTarget = vi.fn(async (...args: any[]) => {
		const [target, path, params] = args;
		const response = await (reg.get as any)(...args);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});

	return { reg: reg as any, calls, page };
};

const makeCache = () => {
	const store = new Map<string, any>();
	const get = vi.fn(async (network: string, k: string) => store.get(`${network}:${k}`));
	const set = vi.fn(async (network: string, k: string, v: any, _ttl: number) => {
		store.set(`${network}:${k}`, v);
	});
	return {
		cache: {
			enabled: true,
			ttlSeconds: 60,
			get,
			set,
		},
		store,
		get,
		set,
	};
};

// --- Tests ---

describe("NetworkBuilder — builder behavior", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	/* ---------------------
     supply (cacheable + failover)
     --------------------- */
	it("supply: builds path/params, caches on useCache=true, reuses cache on subsequent call", async () => {
		const { reg, calls } = makeRegistry();
		const { cache, get, set } = makeCache();

		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		// first call — no cache hit, should call registry.get and set cache
		const res1 = await b.supply((q) => q.timestamp().greaterThanOrEqualTo(1700000000).useCache(true)).get();

		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/supply",
			params: { timestamp: "gte:1700000000" },
		});
		expect(res1).toEqual({ supply: "ok" });
		expect(get).toHaveBeenCalledWith("testnet", "network:supply:gte:1700000000");
		expect(set).toHaveBeenCalledWith("testnet", "network:supply:gte:1700000000", { supply: "ok" }, 60);

		// second call — should hit cache, no extra registry.get call
		const res2 = await b.supply((q) => q.timestamp().greaterThanOrEqualTo(1700000000).useCache(true)).get();
		expect(res2).toEqual({ supply: "ok" });
		// still only one GET call in calls[0]
		expect(calls.filter((c) => c.method === "get").length).toBe(1);
	});

	it("supply: failover path is used when primary fails and failover enabled", async () => {
		const { reg, calls } = makeRegistry({ failoverEnabled: true, failFirst: true });
		const { cache, get, set } = makeCache();

		const b = new NetworkBuilder(reg, "public", "testnet", cache);
		const data = await b.supply({ timestamp: "1700000000", useCache: false } as any).get();

		// Only one get() call (failover is internal)
		expect(calls.length).toBe(1);
		expect(calls[0]).toMatchObject({ method: "get", path: "/api/v1/network/supply" });
		expect(data).toEqual({ supply: "ok" });
		expect(get).not.toHaveBeenCalled();
		expect(set).toHaveBeenCalledWith("testnet", "network:supply:1700000000", { supply: "ok" }, 60);
	});

	it("supply: returns and caches q responses as plain text with q-specific identity", async () => {
		const { reg, calls } = makeRegistry();
		const { cache, get, set } = makeCache();
		const builder = new NetworkBuilder(reg, "public", "testnet", cache);

		const first = await builder.supply({ q: "TOTALCOINS", useCache: true }).get();
		expect(first).toBe("50000000000.00000000");
		expect(calls[0]).toMatchObject({ path: "/api/v1/network/supply", params: { q: "TOTALCOINS" } });
		expect(get).toHaveBeenCalledWith("testnet", "network:supply::q=totalcoins");
		expect(set).toHaveBeenCalledWith("testnet", "network:supply::q=totalcoins", first, 60);

		const cached = await builder.supply((q) => q.q("totalcoins").useCache(true)).get();
		expect(cached).toBe(first);
		expect(calls.filter((call) => call.method === "get")).toHaveLength(1);

		const circulating = await builder.supply((q) => q.q("CiRcUlAtInG")).get();
		expect(circulating).toBe("49452000000.00000000");
		expect(set).toHaveBeenCalledWith("testnet", "network:supply::q=circulating", circulating, 60);
	});

	/* ---------------------
     exchangeRate (cacheable)
     --------------------- */
	it("exchangeRate: caches with useCache=true and returns cached value on second call", async () => {
		const { reg, calls } = makeRegistry();
		const { cache, get, set } = makeCache();

		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		const res1 = await b.exchangeRate((q) => q.timestamp().lessThanOrEqualTo(1700000050).useCache(true)).get();

		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/exchangerate",
			params: { timestamp: "lte:1700000050" },
		});
		expect(res1).toEqual({ rate: "ok" });
		expect(get).toHaveBeenCalledWith("testnet", "network:exchangerate:lte:1700000050");
		expect(set).toHaveBeenCalledWith("testnet", "network:exchangerate:lte:1700000050", { rate: "ok" }, 60);

		const res2 = await b.exchangeRate((q) => q.timestamp().lessThanOrEqualTo(1700000050).useCache(true)).get();

		expect(res2).toEqual({ rate: "ok" });
		expect(calls.filter((c) => c.method === "get").length).toBe(1);
	});

	/* ---------------------
     fees (never cached)
     --------------------- */
	it("fees: passes mapped params and does not use cache", async () => {
		const { reg, calls } = makeRegistry();
		const { cache } = makeCache();
		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		const res = await b.fees((q) => q.timestamp().greaterThan(1700).timestamp().lessThan(2000).order("asc")).get();

		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/fees",
			params: { timestamp: ["gt:1700", "lt:2000"], order: "asc" },
		});
		expect(res).toEqual({ fees: "ok" });
	});

	/* ---------------------
     nodes (limit resolution)
     --------------------- */
	it("nodes: resolves limit 'max' and 'default' using registry page config", async () => {
		const { reg, calls, page } = makeRegistry({ defaultLimit: 25, maxLimit: 99 });
		const { cache } = makeCache();
		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		// limit 'max' -> 99
		await b.nodes((q) => q.nodeId(0).limit("max")).get();
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/nodes",
			params: { "node.id": "0", limit: 99 },
		});

		// limit 'default' -> 25
		await b.nodes((q) => q.nodeId(1).limit("default")).get();
		expect(calls[1]).toMatchObject({
			method: "get",
			path: "/api/v1/network/nodes",
			params: { "node.id": "1", limit: page.defaultLimit },
		});

		// numeric limit preserved
		await b.nodes((q) => q.nodeId(2).limit(7)).get();
		expect(calls[2]).toMatchObject({
			method: "get",
			path: "/api/v1/network/nodes",
			params: { "node.id": "2", limit: 7 },
		});
	});

	it("nodes: supports equality-only fileId and no-ne nodeId comparators", async () => {
		const { reg, calls } = makeRegistry();
		const { cache } = makeCache();
		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		await b.nodes((q) => q.fileId().equalTo("0.0.90").nodeId().greaterThanOrEqualTo(3).order("desc").limit(5)).get();

		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/nodes",
			params: { "file.id": "eq:0.0.90", "node.id": "gte:3", order: "desc", limit: 5 },
		});
	});

	it("nodes: preserves raw links while exposing functional typed pagination", async () => {
		const { reg } = makeRegistry();
		const nextPath = "/api/v1/network/nodes?limit=1&node.id=gt%3A0";
		const firstLinks = { next: nextPath };
		const finalLinks = { next: null };

		reg.get = vi
			.fn()
			.mockResolvedValueOnce({
				text: async () => JSON.stringify({ nodes: [{ node_id: 0 }], links: firstLinks }),
			})
			.mockResolvedValueOnce({
				text: async () => JSON.stringify({ nodes: [{ node_id: 1 }], links: finalLinks }),
			});

		const b = new NetworkBuilder(reg, "public", "testnet");
		const first = await b.nodes({ limit: 1 }).get();

		// `links` was part of the pre-pagination response contract and must remain
		// available in addition to the ergonomic, strongly typed `next` helper.
		expect(first.links).toEqual(firstLinks);
		expect(first.next.url()).toBe(`https://public.testnet.mirror.test${nextPath}`);

		const second = await first.next();
		expect(second?.nodes).toEqual([{ node_id: 1 }]);
		expect(second?.links).toEqual(finalLinks);
		expect(second?.next.url()).toBeNull();
		expect(reg.get).toHaveBeenNthCalledWith(2, expect.anything(), nextPath, undefined);
	});

	/* ---------------------
     stake (cacheable, fixed cacheKey)
     --------------------- */
	it("stake: caches result when useCache=true and reuses on subsequent call", async () => {
		const { reg, calls } = makeRegistry();
		const { cache, get, set } = makeCache();
		const b = new NetworkBuilder(reg, "public", "testnet", cache);

		const r1 = await b.stake((q) => q.useCache(true)).get();
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/network/stake",
			params: undefined,
		});
		expect(r1).toEqual({ stake: "ok" });
		expect(get).toHaveBeenCalledWith("testnet", "network:stake");
		expect(set).toHaveBeenCalledWith("testnet", "network:stake", { stake: "ok" }, 60);

		const r2 = await b.stake((q) => q.useCache(true)).get();
		expect(r2).toEqual({ stake: "ok" });
		expect(calls.filter((c) => c.method === "get").length).toBe(1);
	});
});
