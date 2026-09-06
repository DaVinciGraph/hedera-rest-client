import { describe, it, expect } from "vitest";

import { TopicsBuilder } from "../../src/resources/topics/builder";
import { TokensBuilder } from "../../src/resources/tokens/builder";
import { NetworkBuilder } from "../../src/resources/network/builder";

import { HttpError } from "../../src/core/errors";

/* ---------------------------
   Fake ProviderRegistry
---------------------------- */
class FakeRegistry {
	calls: any[] = [];
	failoverEnabled = false;
	throwOnGet: Error | null = null;
	fixedJson: any = {};
	defaults = { provider: "prov", network: "net", defaultLimit: 25, maxLimit: 100 };

	constructor(opts?: Partial<FakeRegistry>) {
		Object.assign(this, opts);
	}

	resolve(provider?: string, network?: string) {
		this.calls.push({ fn: "resolve", provider, network });
		const p = provider ?? this.defaults.provider;
		const n = network ?? this.defaults.network;
		return {
			provider: p,
			network: n,
			baseUrl: `https://${p}.${n}.mirror`,
			page: { defaultLimit: this.defaults.defaultLimit, maxLimit: this.defaults.maxLimit },
		};
	}

	isFailoverEnabled() {
		return this.failoverEnabled;
	}

	get(target: any, path: string, params?: any, signal?: AbortSignal) {
		this.calls.push({ fn: "get", target, path, params, signal });
		// Simulate failover internally: if error is retryable and failover is enabled, return success
		if (this.throwOnGet) {
			if (this.failoverEnabled && this.throwOnGet instanceof HttpError && (this.throwOnGet.status === 429 || this.throwOnGet.status >= 500)) {
				// Simulate internal failover success
				return { json: async () => this.fixedJson, text: async () => JSON.stringify(this.fixedJson) } as any;
			}
			throw this.throwOnGet;
		}
		return { json: async () => this.fixedJson, text: async () => JSON.stringify(this.fixedJson) } as any;
	}

	getLogger() {
		return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
	}
}

/* ---------------------------
   Test cache helper
---------------------------- */
function makeCache(opts?: { enabled?: boolean; ttlSeconds?: number; preset?: Record<string, any> }) {
	const store = new Map<string, any>(Object.entries(opts?.preset ?? {}));
	const gets: Array<{ network: string; key: string }> = [];
	const sets: Array<{ network: string; key: string; val: any; ttl: number }> = [];

	const cache = {
		enabled: opts?.enabled ?? true,
		ttlSeconds: opts?.ttlSeconds ?? 60,
		async get(network: string, k: string) {
			gets.push({ network, key: k });
			return store.get(`${network}:${k}`);
		},
		async set(network: string, k: string, v: any, ttl: number) {
			sets.push({ network, key: k, val: v, ttl });
			store.set(`${network}:${k}`, v);
		},
		__inspect: { store, gets, sets },
	};
	return cache;
}

/* =========================================================
 * Generic caching tests across representative builders
 * ========================================================= */
describe("Generic caching behavior", () => {
	describe("TopicsBuilder.one()", () => {
		it("miss → fetch → set(network, cacheKey, data, ttl) → second call hits cache (no network)", async () => {
			const reg = new FakeRegistry({ fixedJson: { id: "0.0.123", memo: "hello" } });
			const topicCache = makeCache({ enabled: true, ttlSeconds: 123 });

			const b = new TopicsBuilder(reg as any, "p1", "n1", {
				topic: topicCache as any,
				message: makeCache({ enabled: true }) as any,
			});

			// First call: cache miss → GET → set
			const out1 = await b.one({ topicId: "0.0.123", useCache: true }).get();
			expect(out1).toEqual({ id: "0.0.123", memo: "hello" });

			// Inspect cache interactions
			const k = "topic:0.0.123";
			expect(topicCache.__inspect.gets).toEqual([{ network: "n1", key: k }]); // network-scoped lookup
			expect(topicCache.__inspect.sets.length).toBe(1);
			expect(topicCache.__inspect.sets[0]).toMatchObject({ network: "n1", key: k, ttl: 123 });

			// Second call: should hit cache (no network)
			reg.throwOnGet = new Error("should not call network when cache is hot");
			const out2 = await b.one({ topicId: "0.0.123", useCache: true }).get();
			expect(out2).toEqual(out1);

			// Only one network GET should have happened
			const getCalls = reg.calls.filter((c) => c.fn === "get");
			expect(getCalls.length).toBe(1);
		});

		it("pre-populated cache returns value and bypasses network", async () => {
			const k = "topic:0.0.555";
			const reg = new FakeRegistry({ throwOnGet: new Error("must not touch network") });
			const topicCache = makeCache({
				enabled: true,
				preset: { [`n:${k}`]: { id: "0.0.555", memo: "cached" } },
			});

			const b = new TopicsBuilder(reg as any, "p", "n", {
				topic: topicCache as any,
				message: makeCache() as any,
			});

			const out = await b.one({ topicId: "0.0.555", useCache: true }).get();
			expect(out).toEqual({ id: "0.0.555", memo: "cached" });

			// No network calls
			const getCalls = reg.calls.filter((c) => c.fn === "get");
			expect(getCalls.length).toBe(0);
		});

		it.each(["warm", "cold"] as const)("rejects an already-aborted %s cache request before cache or network I/O", async (state) => {
			const k = "topic:0.0.556";
			const reg = new FakeRegistry({ fixedJson: { id: "0.0.556" } });
			const topicCache = makeCache({
				enabled: true,
				preset: state === "warm" ? { [`n:${k}`]: { id: "0.0.556", memo: "cached" } } : undefined,
			});
			const builder = new TopicsBuilder(reg as any, "p", "n", {
				topic: topicCache as any,
				message: makeCache() as any,
			});
			const controller = new AbortController();
			const reason = new DOMException("cancel before read", "AbortError");
			controller.abort(reason);

			await expect(builder.one({ topicId: "0.0.556", useCache: true }).get({ signal: controller.signal })).rejects.toBe(reason);
			expect(topicCache.__inspect.gets).toHaveLength(0);
			expect(reg.calls.filter((call) => call.fn === "get")).toHaveLength(0);
		});

		it("does not pretend to cancel custom cache I/O that was already in progress", async () => {
			const cached = { id: "0.0.557", memo: "cached" };
			let release!: (value: typeof cached) => void;
			let cacheReadStarted!: () => void;
			const started = new Promise<void>((resolve) => (cacheReadStarted = resolve));
			const topicCache = {
				enabled: true,
				ttlSeconds: 60,
				get: async () => {
					cacheReadStarted();
					return new Promise<typeof cached>((resolve) => (release = resolve));
				},
				set: async () => {},
			};
			const reg = new FakeRegistry({ throwOnGet: new Error("cache hit must bypass the network") });
			const builder = new TopicsBuilder(reg as any, "p", "n", {
				topic: topicCache as any,
				message: makeCache() as any,
			});
			const controller = new AbortController();

			const result = builder.one({ topicId: "0.0.557", useCache: true }).get({ signal: controller.signal });
			await started;
			controller.abort();
			release(cached);

			await expect(result).resolves.toEqual(cached);
			expect(reg.calls.filter((call) => call.fn === "get")).toHaveLength(0);
		});

		it("useCache=false bypasses cached reads even when enabled", async () => {
			const k = "topic:0.0.777";
			const reg = new FakeRegistry({ fixedJson: { id: "0.0.777" } });
			const topicCache = makeCache({
				enabled: true,
				preset: { [`n:${k}`]: { id: "0.0.777", memo: "stale" } },
			});

			const b = new TopicsBuilder(reg as any, "p", "n", {
				topic: topicCache as any,
				message: makeCache() as any,
			});

			const out = await b.one({ topicId: "0.0.777", useCache: false }).get();
			expect(out).toEqual({ id: "0.0.777" });

			// Cache wasn't read; the successful fresh response still refreshes it.
			expect(topicCache.__inspect.gets.length).toBe(0);
		});

		it("404 does not cache (returns null and no set)", async () => {
			const reg = new FakeRegistry({ throwOnGet: new HttpError(404, "nf") });
			const topicCache = makeCache({ enabled: true, ttlSeconds: 99 });

			const b = new TopicsBuilder(reg as any, "p", "n", {
				topic: topicCache as any,
				message: makeCache() as any,
			});

			const out = await b.one({ topicId: "0.0.999", useCache: true }).get();
			expect(out).toBeNull();

			// One lookup (miss), no set
			expect(topicCache.__inspect.gets).toEqual([{ network: "n", key: "topic:0.0.999" }]);
			expect(topicCache.__inspect.sets.length).toBe(0);
		});

		it("failover result is cached when primary get throws retryable error and failover is enabled", async () => {
			const reg = new FakeRegistry({
				throwOnGet: new HttpError(503, "service unavailable"),
				failoverEnabled: true,
				fixedJson: { id: "0.0.333", memo: "via-failover" },
			});
			const topicCache = makeCache({ enabled: true, ttlSeconds: 42 });

			const b = new TopicsBuilder(reg as any, "provA", "netA", {
				topic: topicCache as any,
				message: makeCache() as any,
			});

			const out = await b.one({ topicId: "0.0.333", useCache: true }).get();
			expect(out).toEqual({ id: "0.0.333", memo: "via-failover" });

			// Cached with correct key and TTL
			const setRec = topicCache.__inspect.sets[0];
			expect(setRec).toMatchObject({ network: "netA", key: "topic:0.0.333", ttl: 42 });

			// Failover was internal to registry.get() - only one get call from builder
			expect(reg.calls.filter((c) => c.fn === "get")).toHaveLength(1);
		});
	});

	describe("TokensBuilder.nft() uses the NFT cache bucket (not the token cache)", () => {
		it("populates and reads from caches.nft only", async () => {
			const reg = new FakeRegistry({ fixedJson: { token_id: "0.0.1001", serial_number: "5" } });
			const nftCache = makeCache({ enabled: true, ttlSeconds: 77 });
			const tokenCache = makeCache({ enabled: true, ttlSeconds: 77 });

			//@ts-ignore
			const b = new TokensBuilder(reg as any, "p", "n", { nft: nftCache as any, token: tokenCache as any });

			// First call: miss -> GET -> set(nft)
			const out1 = await b.nft({ tokenId: "0.0.1001", serialNumber: 5, useCache: true }).get();
			expect(out1).toEqual({ token_id: "0.0.1001", serial_number: "5" });

			// Token cache untouched
			expect(tokenCache.__inspect.gets.length).toBe(0);
			expect(tokenCache.__inspect.sets.length).toBe(0);

			// NFT cache set with key `nft:<id>:<serial>`
			const key = "nft:0.0.1001:5";
			expect(nftCache.__inspect.sets[0]).toMatchObject({ network: "n", key, ttl: 77 });

			// Second call should hit NFT cache, no network
			reg.throwOnGet = new Error("should not fetch again");
			const out2 = await b.nft({ tokenId: "0.0.1001", serialNumber: 5, useCache: true }).get();
			expect(out2).toEqual(out1);

			const getCalls = reg.calls.filter((c) => c.fn === "get");
			expect(getCalls.length).toBe(1);
		});
	});

	describe("NetworkBuilder.stake() caches using its single cache", () => {
		it("miss → fetch → set(network, 'network:stake', data, ttl) → hit", async () => {
			const reg = new FakeRegistry({ fixedJson: { staking_period: "t0" } });
			const cache = makeCache({ enabled: true, ttlSeconds: 15 });

			const b = new NetworkBuilder(reg as any, "p", "n", cache as any);

			// First call writes to 'network:stake'
			const out1 = await b.stake({ useCache: true }).get();
			expect(out1).toEqual({ staking_period: "t0" });

			expect(cache.__inspect.gets).toEqual([{ network: "n", key: "network:stake" }]);
			expect(cache.__inspect.sets[0]).toMatchObject({ network: "n", key: "network:stake", ttl: 15 });

			// Second call must be cache hit (no network)
			reg.throwOnGet = new Error("should not refetch stake");
			const out2 = await b.stake({ useCache: true }).get();
			expect(out2).toEqual(out1);

			const calls = reg.calls.filter((c) => c.fn === "get");
			expect(calls.length).toBe(1);
		});

		it("disabled cache: useCache=true but cache.enabled=false → no get/set, still fetches", async () => {
			const reg = new FakeRegistry({ fixedJson: { staking_period: "t1" } });
			const cache = makeCache({ enabled: false, ttlSeconds: 10 });

			const b = new NetworkBuilder(reg as any, "p", "n", cache as any);
			const out = await b.stake({ useCache: true }).get();
			expect(out).toEqual({ staking_period: "t1" });

			// No cache interaction
			expect(cache.__inspect.gets.length).toBe(0);
			expect(cache.__inspect.sets.length).toBe(0);

			// Network was called
			const calls = reg.calls.filter((c) => c.fn === "get");
			expect(calls.length).toBe(1);
		});
	});
});
