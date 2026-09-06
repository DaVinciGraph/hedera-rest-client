// tests/resources/schedules.builder.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SchedulesBuilder } from "../../src/resources/schedules/builder";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

/** -----------------------
 * Test doubles
 * --------------------- */
const makeRegistry = (opts?: { defaultLimit?: number; maxLimit?: number; failoverEnabled?: boolean; failFirst?: boolean; throw404?: boolean }) => {
	const calls: Array<{ method: string; path: string; params?: any }> = [];
	const page = {
		defaultLimit: opts?.defaultLimit ?? 25,
		maxLimit: opts?.maxLimit ?? 100,
	};

	let failFirst = !!opts?.failFirst;
	const failoverEnabled = !!opts?.failoverEnabled;
	const throw404 = !!opts?.throw404;

	// Stub responses
	const responses: Record<string, any> = {
		"/api/v1/schedules": {
			schedules: [{ schedule_id: "0.0.111" }],
			links: { next: null },
		},
		"/api/v1/schedules/0.0.123": {
			schedule_id: "0.0.123",
			creator_account_id: "0.0.10",
			payer_account_id: "0.0.20",
		},
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
			if (throw404 && path.startsWith("/api/v1/schedules/")) {
				throw new HttpError(404, "Not Found");
			}
			if (failFirst) {
				failFirst = false;
				// Use retryable error for failover to work
				if (failoverEnabled) {
					// Simulate internal failover success
					return {
						json: async () => responses[path] ?? {},
						text: async () => JSON.stringify(responses[path] ?? {}),
					};
				}
				throw new HttpError(503, "service unavailable");
			}
			return {
				json: async () => responses[path] ?? {},
				text: async () => JSON.stringify(responses[path] ?? {}),
			};
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

/** -----------------------
 * Tests
 * --------------------- */
describe("SchedulesBuilder — builder behavior", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	/* ---------------------------------
     list: limit resolution + path/params
     --------------------------------- */
	it("list: resolves limit 'max' and 'default', and preserves numeric", async () => {
		const { reg, calls, page } = makeRegistry({ defaultLimit: 25, maxLimit: 99 });
		const { cache } = makeCache();
		const b = new SchedulesBuilder(reg, "public", "testnet", cache);

		// max
		const r1 = await b.list((q) => q.accountId("0.0.100").limit("max")).get();
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules",
			params: { "account.id": "0.0.100", limit: page.maxLimit },
		});
		expect(r1.schedules).toEqual([{ schedule_id: "0.0.111" }]);

		// default
		const r2 = await b.list((q) => q.scheduleId("0.0.500").limit("default")).get();
		expect(calls[1]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules",
			params: { "schedule.id": "0.0.500", limit: page.defaultLimit },
		});
		expect(r2.schedules).toEqual([{ schedule_id: "0.0.111" }]);

		// numeric
		const r3 = await b.list((q) => q.accountId().notEqualTo("0.0.123").limit(7)).get();
		expect(calls[2]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules",
			params: { "account.id": "ne:0.0.123", limit: 7 },
		});
		expect(r3.schedules).toEqual([{ schedule_id: "0.0.111" }]);
	});

	it("list: uses failover when primary fails and failover is enabled", async () => {
		const { reg, calls } = makeRegistry({ failoverEnabled: true, failFirst: true });
		const { cache } = makeCache();
		const b = new SchedulesBuilder(reg, "public", "testnet", cache);

		const res = await b.list((q) => q.accountId("0.0.200").order("desc").limit(5)).get();

		// Only one get() call (failover is internal)
		expect(calls.length).toBe(1);
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules",
			params: { "account.id": "0.0.200", order: "desc", limit: 5 },
		});
		expect(res.schedules).toEqual([{ schedule_id: "0.0.111" }]);
	});

	/* ---------------------------------
     one: caching, 404→null, failover
     --------------------------------- */
	it("one: caches on useCache=true and returns cached on subsequent call", async () => {
		const { reg, calls } = makeRegistry();
		const { cache, get, set } = makeCache();
		const b = new SchedulesBuilder(reg, "public", "testnet", cache);

		const first = await b.one((q) => q.scheduleId("0.0.123").useCache(true)).get();

		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules/0.0.123",
			params: undefined,
		});
		expect(first).toEqual({
			schedule_id: "0.0.123",
			creator_account_id: "0.0.10",
			payer_account_id: "0.0.20",
		});
		expect(get).toHaveBeenCalledWith("testnet", "schedules:0.0.123");
		expect(set).toHaveBeenCalledWith("testnet", "schedules:0.0.123", first, 60);

		// second call hits cache (no new GET)
		const second = await b.one((q) => q.scheduleId("0.0.123").useCache(true)).get();
		expect(second).toEqual(first);
		expect(calls.filter((c) => c.method === "get").length).toBe(1);
	});

	it("one: returns null on 404 without failover", async () => {
		const { reg, calls } = makeRegistry({ throw404: true, failoverEnabled: true });
		const { cache } = makeCache();
		const b = new SchedulesBuilder(reg, "public", "testnet", cache);

		const res = await b.one((q) => q.scheduleId("0.0.123").useCache(true)).get();

		expect(res).toBeNull();
		// Only primary GET attempted; 404 short-circuits failover
		expect(calls.length).toBe(1);
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules/0.0.123",
		});
	});

	it("one: uses failover when primary throws non-404 and failover enabled; still caches", async () => {
		const { reg, calls } = makeRegistry({ failoverEnabled: true, failFirst: true });
		const { cache, get, set } = makeCache();
		const b = new SchedulesBuilder(reg, "public", "testnet", cache);

		const res = await b.one((q) => q.scheduleId("0.0.123").useCache(true)).get();

		// Only one get() call (failover is internal)
		expect(calls.length).toBe(1);
		expect(calls[0]).toMatchObject({
			method: "get",
			path: "/api/v1/schedules/0.0.123",
		});
		expect(res).toEqual({
			schedule_id: "0.0.123",
			creator_account_id: "0.0.10",
			payer_account_id: "0.0.20",
		});

		// Cache set after successful request (including internal failover)
		expect(get).toHaveBeenCalledWith("testnet", "schedules:0.0.123");
		expect(set).toHaveBeenCalledWith("testnet", "schedules:0.0.123", res, 60);
	});
});
