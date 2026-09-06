import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryCacheAdapter } from "../../src/core/cache";
import { IndexedDbCacheAdapter } from "../../src/core/cache-indexeddb";
import { RedisCacheAdapter } from "../../src/core/cache-redis";
import { createNetworkScopedCache } from "../../src/core/network-cache";
import { ValidationError } from "../../src/core/errors";
import { ConfigError } from "../../src/core/errors";
import { snapshotCacheConfig } from "../../src/core/cache-config";
import { cacheExpiresAt } from "../../src/core/cache-ttl";

afterEach(() => vi.unstubAllGlobals());

describe("cache reliability", () => {
	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
		"rejects an invalid memory-cache TTL (%s)",
		async (ttl) => {
			const cache = new MemoryCacheAdapter();
			await expect(cache.set("key", "value", ttl)).rejects.toBeInstanceOf(ValidationError);
		}
	);

	it("treats a zero memory-cache TTL as immediately expired", async () => {
		const cache = new MemoryCacheAdapter();
		await cache.set("key", "value", 0);
		await expect(cache.get("key")).resolves.toBeUndefined();
	});

	it("reclaims expired memory entries during write-only workloads", async () => {
		let now = 1_000;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
		try {
			const cache = new MemoryCacheAdapter();
			for (let index = 0; index < 64; index += 1) await cache.set(`stale:${index}`, index, 1);
			now += 2_000;
			for (let index = 0; index < 8; index += 1) await cache.set(`fresh:${index}`, index, 60);

			expect((cache as any).store.size).toBe(8);
		} finally {
			clock.mockRestore();
		}
	});

	it("uses one clock snapshot when validating and computing the expiration boundary", () => {
		const now = 1_000;
		const clock = vi.spyOn(Date, "now").mockReturnValueOnce(now).mockReturnValue(now + 1);
		try {
			const expiration = cacheExpiresAt((Number.MAX_SAFE_INTEGER - now) / 1_000);
			expect(expiration).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
			expect(clock).toHaveBeenCalledOnce();
		} finally {
			clock.mockRestore();
		}
	});

	it("validates IndexedDB TTL before attempting environment access", async () => {
		const cache = new IndexedDbCacheAdapter();
		await expect(cache.set("key", "value", Number.NaN)).rejects.toBeInstanceOf(ValidationError);
	});

	it("opens IndexedDB in a worker-like environment without window or document", async () => {
		const request: any = {};
		const database = { close: vi.fn() };
		const open = vi.fn(() => request);
		vi.stubGlobal("indexedDB", { open });
		const cache = new IndexedDbCacheAdapter();

		const opening = (cache as any).getDb();
		request.result = database;
		request.onsuccess();

		await expect(opening).resolves.toBe(database);
		expect(open).toHaveBeenCalledWith("hedera-rest-cache", 1);
	});

	it("rejects a blocked IndexedDB open promptly and retries on the next access", async () => {
		const firstRequest: any = {};
		const secondRequest: any = {};
		const staleDatabase = { close: vi.fn() };
		const database = { close: vi.fn() };
		const open = vi.fn().mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
		vi.stubGlobal("indexedDB", { open });
		const cache = new IndexedDbCacheAdapter();

		const firstOpening = (cache as any).getDb();
		firstRequest.onblocked();
		await expect(firstOpening).rejects.toThrow(/blocked/);

		const secondOpening = (cache as any).getDb();
		secondRequest.result = database;
		secondRequest.onsuccess();
		await expect(secondOpening).resolves.toBe(database);
		expect(open).toHaveBeenCalledTimes(2);

		// If the first browser request eventually succeeds, its unowned DB is closed.
		firstRequest.result = staleDatabase;
		firstRequest.onsuccess();
		expect(staleDatabase.close).toHaveBeenCalledOnce();
	});

	it("releases an internally opened IndexedDB connection on version changes and reopens safely", async () => {
		const firstRequest: any = {};
		const secondRequest: any = {};
		const firstDatabase: any = { close: vi.fn() };
		const secondDatabase: any = { close: vi.fn() };
		const open = vi.fn().mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
		vi.stubGlobal("indexedDB", { open });
		const cache = new IndexedDbCacheAdapter();

		const firstOpening = (cache as any).getDb();
		firstRequest.result = firstDatabase;
		firstRequest.onsuccess();
		await expect(firstOpening).resolves.toBe(firstDatabase);

		firstDatabase.onversionchange();
		expect(firstDatabase.close).toHaveBeenCalledOnce();

		const secondOpening = (cache as any).getDb();
		secondRequest.result = secondDatabase;
		secondRequest.onsuccess();
		await expect(secondOpening).resolves.toBe(secondDatabase);
		expect(open).toHaveBeenCalledTimes(2);

		// A late event from the old connection must not clear its replacement.
		firstDatabase.onclose();
		await expect((cache as any).getDb()).resolves.toBe(secondDatabase);
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("reopens after an internally owned IndexedDB connection closes unexpectedly", async () => {
		const firstRequest: any = {};
		const secondRequest: any = {};
		const firstDatabase: any = { close: vi.fn() };
		const secondDatabase: any = { close: vi.fn() };
		const open = vi.fn().mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
		vi.stubGlobal("indexedDB", { open });
		const cache = new IndexedDbCacheAdapter();

		const firstOpening = (cache as any).getDb();
		firstRequest.result = firstDatabase;
		firstRequest.onsuccess();
		await firstOpening;
		firstDatabase.onclose();

		const secondOpening = (cache as any).getDb();
		secondRequest.result = secondDatabase;
		secondRequest.onsuccess();
		await expect(secondOpening).resolves.toBe(secondDatabase);
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("surfaces Redis command failures from the adapter", async () => {
		const setFailure = new Error("redis unavailable");
		const setCache = new RedisCacheAdapter({
			client: {
				get: vi.fn(),
				set: vi.fn().mockRejectedValue(setFailure),
				del: vi.fn(),
				pExpire: vi.fn(),
			},
		});
		await expect(setCache.set("key", "value", 10)).rejects.toThrow(/set|Redis/i);

		const getCache = new RedisCacheAdapter({
			client: {
				get: vi.fn().mockRejectedValue(new Error("redis unavailable")),
				set: vi.fn(),
				del: vi.fn(),
				pExpire: vi.fn(),
			},
		});
		await expect(getCache.get("key")).rejects.toThrow(/get|Redis/i);

		const deleteCache = new RedisCacheAdapter({
			client: {
				get: vi.fn(),
				set: vi.fn(),
				del: vi.fn().mockRejectedValue(new Error("redis unavailable")),
				pExpire: vi.fn(),
			},
		});
		await expect(deleteCache.delete("key")).rejects.toThrow(/del|Redis/i);
	});

	it("does not fall back to a non-atomic Redis write when atomic SET PX fails", async () => {
		const sendCommand = vi.fn(async (command: string[]) => {
			throw new Error(`atomic ${command[0]} failed`);
		});
		const set = vi.fn();
		const expire = vi.fn();
		const cache = new RedisCacheAdapter({
			client: { get: vi.fn(), set, expire, del: vi.fn(), sendCommand },
		});

		await expect(cache.set("key", "value", 10)).rejects.toThrow(/atomic SET failed/);
		expect(sendCommand).toHaveBeenCalledWith(["SET", "key", expect.any(String), "PX", "10000"]);
		expect(set).not.toHaveBeenCalled();
		expect(expire).not.toHaveBeenCalled();
	});

	it("makes cache reads and writes fail-open while reporting them", async () => {
		const readError = new Error("read failed");
		const writeError = new Error("write failed");
		const adapter = {
			get: vi.fn().mockRejectedValue(readError),
			set: vi.fn().mockRejectedValue(writeError),
		};
		const logger = { warn: vi.fn() };
		const cache = createNetworkScopedCache(adapter, {
			enabled: true,
			ttlSeconds: 60,
			logger,
		});

		await expect(cache.get("testnet", "token:0.0.1")).resolves.toBeUndefined();
		await expect(cache.set("testnet", "token:0.0.1", { ok: true }, 60)).resolves.toBeUndefined();
		expect(logger.warn).toHaveBeenCalledTimes(2);
		expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ network: "testnet", key: "token:0.0.1", error: readError });
		expect(logger.warn.mock.calls[1]?.[1]).toMatchObject({ network: "testnet", key: "token:0.0.1", error: writeError });
	});

	it("contains cache-boundary clone failures for non-serializable custom values", async () => {
		const adapter = {
			get: vi.fn().mockResolvedValue({ value: { callback: () => undefined }, expiresAt: Date.now() + 60_000 }),
			set: vi.fn(),
		};
		const logger = { warn: vi.fn() };
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60, logger });

		await expect(cache.get("testnet", "custom:key")).resolves.toBeUndefined();
		await expect(cache.set("testnet", "custom:key", { callback: () => undefined }, 60)).resolves.toBeUndefined();
		expect(adapter.set).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledTimes(2);
	});

	it("keeps arbitrary network names collision-free in physical cache keys", async () => {
		const adapter = new MemoryCacheAdapter<unknown>();
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60 });

		await cache.set("fork:token", "id", { ledger: "fork:token" }, 60);
		expect(await cache.get("fork", "token:id")).toBeUndefined();
		expect(await cache.get("fork:token", "id")).toEqual({ ledger: "fork:token" });
	});

	it("detaches values on both sides of the network-scoped cache boundary", async () => {
		const adapter = new MemoryCacheAdapter<unknown>();
		const cache = createNetworkScopedCache<{ nested: { name: string } }>(adapter, { enabled: true, ttlSeconds: 60 });
		const fresh = { nested: { name: "original" } };

		await cache.set("testnet", "token:0.0.1", fresh, 60);
		fresh.nested.name = "fresh mutation";
		const firstHit = await cache.get("testnet", "token:0.0.1");
		expect(firstHit).toEqual({ nested: { name: "original" } });

		firstHit!.nested.name = "hit mutation";
		const secondHit = await cache.get("testnet", "token:0.0.1");
		expect(secondHit).toEqual({ nested: { name: "original" } });
		expect(secondHit).not.toBe(firstHit);
	});

	it("accepts a finite fractional expiration returned by a custom adapter", async () => {
		const adapter = {
			get: vi.fn().mockResolvedValue({ value: { ok: true }, expiresAt: Date.now() + 60_000.5 }),
			set: vi.fn(),
		};
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60 });

		await expect(cache.get("testnet", "token:0.0.1")).resolves.toEqual({ ok: true });
	});

	it("supports network names containing unpaired UTF-16 surrogates", async () => {
		const adapter = new MemoryCacheAdapter<unknown>();
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60 });
		const network = "fork\uD800";

		await expect(cache.set(network, "token:id", { network }, 60)).resolves.toBeUndefined();
		await expect(cache.get(network, "token:id")).resolves.toEqual({ network });
	});

	it("keeps lone-surrogate and replacement-character networks distinct after UTF-8 encoding", async () => {
		const records = new Map<string, { value: unknown; expiresAt: number }>();
		const wireKey = (key: string) => Buffer.from(key, "utf8").toString("hex");
		const adapter = {
			async get(key: string) {
				return records.get(wireKey(key));
			},
			async set(key: string, value: unknown, ttlSeconds: number) {
				records.set(wireKey(key), { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
			},
		};
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60 });

		await cache.set("fork\uD800", "token:id", "surrogate", 60);
		await cache.set("fork\uFFFD", "token:id", "replacement", 60);
		await expect(cache.get("fork\uD800", "token:id")).resolves.toBe("surrogate");
		await expect(cache.get("fork\uFFFD", "token:id")).resolves.toBe("replacement");
		expect(records.size).toBe(2);
	});

	it("never reads ambiguous cache keys from the previous schema version", async () => {
		const adapter = new MemoryCacheAdapter<unknown>();
		await adapter.set("hedera-rest-client:1:a%3Ab:token:id", "old encoded ledger", 60);
		await adapter.set("hedera-rest-client:1:a:b:token:id", "old raw ledger", 60);
		const cache = createNetworkScopedCache(adapter, { enabled: true, ttlSeconds: 60 });

		await expect(cache.get("a:b", "token:id")).resolves.toBeUndefined();
	});

	it.each([
		["missing expiry", { value: "stale" }],
		["string expiry", { value: "stale", expiresAt: String(Date.now() + 60_000) }],
		["NaN expiry", { value: "stale", expiresAt: Number.NaN }],
		["unsafe finite expiry", { value: "stale", expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
		["expired record", { value: "stale", expiresAt: Date.now() - 1 }],
	])("rejects a custom-adapter record with %s", async (_label, record) => {
		const adapter = {
			get: vi.fn().mockResolvedValue(record),
			set: vi.fn(),
			delete: vi.fn().mockResolvedValue(undefined),
		};
		const cache = createNetworkScopedCache(adapter as any, { enabled: true, ttlSeconds: 60 });

		await expect(cache.get("testnet", "token:0.0.1")).resolves.toBeUndefined();
		expect(adapter.delete).not.toHaveBeenCalled();
	});

	it.each([
		["missing", { v: "stale" }],
		["non-numeric", { v: "stale", e: "tomorrow" }],
		["non-finite", { v: "stale", e: null }],
		["unsafe finite", { v: "stale", e: Number.MAX_SAFE_INTEGER + 1 }],
		["expired", { v: "stale", e: Date.now() - 1 }],
	])("rejects a Redis record with a %s expiry", async (_label, payload) => {
		const client = {
			get: vi.fn().mockResolvedValue(JSON.stringify(payload)),
			set: vi.fn(),
			del: vi.fn().mockResolvedValue(1),
			pExpire: vi.fn(),
		};
		const cache = new RedisCacheAdapter({ client });

		await expect(cache.get("key")).resolves.toBeUndefined();
		expect(client.del).not.toHaveBeenCalled();
	});

	it.each([
		["missing", { v: "stale" }],
		["non-numeric", { v: "stale", e: "tomorrow" }],
		["non-finite", { v: "stale", e: Number.NaN }],
		["unsafe finite", { v: "stale", e: Number.MAX_SAFE_INTEGER + 1 }],
		["expired", { v: "stale", e: Date.now() - 1 }],
	])("rejects an IndexedDB record with a %s expiry", async (_label, record) => {
		const deleteRecord = vi.fn();
		const db = {
			transaction: vi.fn((_storeName: string, mode: "readonly" | "readwrite") => {
				const transaction: any = {};
				const store = {
					get: () => {
						const request: any = {};
						queueMicrotask(() => {
							request.result = record;
							request.onsuccess();
							if (mode === "readwrite") queueMicrotask(() => transaction.oncomplete());
						});
						return request;
					},
					delete: deleteRecord,
				};
				transaction.objectStore = () => store;
				return transaction;
			}),
		};
		const cache = new IndexedDbCacheAdapter({ db });

		await expect(cache.get("key")).resolves.toBeUndefined();
		expect(deleteRecord).toHaveBeenCalledWith("key");
		expect(db.transaction).toHaveBeenNthCalledWith(1, "cache", "readonly");
		expect(db.transaction).toHaveBeenNthCalledWith(2, "cache", "readwrite");
	});

	it("does not delete a newer IndexedDB record while cleaning a stale read", async () => {
		const stale = { k: "key", v: "stale", e: Date.now() - 1 };
		const fresh = { k: "key", v: "fresh", e: Date.now() + 60_000 };
		const deleteRecord = vi.fn();
		const db = {
			transaction: vi.fn((_storeName: string, mode: "readonly" | "readwrite") => {
				const transaction: any = {};
				const store = {
					get: () => {
						const request: any = {};
						queueMicrotask(() => {
							request.result = mode === "readonly" ? stale : fresh;
							request.onsuccess();
							if (mode === "readwrite") queueMicrotask(() => transaction.oncomplete());
						});
						return request;
					},
					delete: deleteRecord,
				};
				transaction.objectStore = () => store;
				return transaction;
			}),
		};
		const cache = new IndexedDbCacheAdapter({ db });

		await expect(cache.get("key")).resolves.toBeUndefined();
		expect(deleteRecord).not.toHaveBeenCalled();
	});

	it("accepts a finite fractional IndexedDB expiration timestamp", async () => {
		const expiresAt = Date.now() + 60_000.5;
		const db = {
			transaction: vi.fn(() => ({
				objectStore: () => ({
					get: () => {
						const request: any = {};
						queueMicrotask(() => {
							request.result = { k: "key", v: "value", e: expiresAt };
							request.onsuccess();
						});
						return request;
					},
				}),
			})),
		};
		const cache = new IndexedDbCacheAdapter({ db });

		await expect(cache.get("key")).resolves.toEqual({ value: "value", expiresAt });
	});

	it("clears only the configured IndexedDB key prefix", async () => {
		const keys = ["owned:first", "other:first", "owned:second"];
		const deleted: string[] = [];
		const clear = vi.fn();
		const transaction: any = {};
		const store = {
			clear,
			openCursor: () => {
				const request: any = {};
				let index = 0;
				const advance = () => {
					if (index >= keys.length) {
						request.result = null;
						request.onsuccess();
						queueMicrotask(() => transaction.oncomplete());
						return;
					}
					const key = keys[index];
					request.result = {
						key,
						delete: () => deleted.push(key),
						continue: () => {
							index += 1;
							queueMicrotask(advance);
						},
					};
					request.onsuccess();
				};
				queueMicrotask(advance);
				return request;
			},
		};
		transaction.objectStore = () => store;
		const db = { transaction: vi.fn(() => transaction) };
		const cache = new IndexedDbCacheAdapter({ db, keyPrefix: "owned:" });

		await cache.clear();
		expect(deleted).toEqual(["owned:first", "owned:second"]);
		expect(clear).not.toHaveBeenCalled();
	});

	it("reclaims persisted IndexedDB entries in bounded write-time batches", async () => {
		type Entry = { key: string; value: any; deleted?: boolean };
		const entries: Entry[] = Array.from({ length: 20 }, (_, index) => ({
			key: `owned:stale:${String(index).padStart(2, "0")}`,
			value: { e: 0 },
		}));
		const deleted: string[] = [];
		const inspectedPerTransaction: number[] = [];
		vi.stubGlobal("IDBKeyRange", {
			lowerBound: (lower: string, open: boolean) => ({ lower, open }),
		});

		const db = {
			transaction: vi.fn(() => {
				const transaction: any = {};
				let inspected = 0;
				const store = {
					put: (value: any) => {
						const existing = entries.find((entry) => entry.key === value.k);
						if (existing) {
							existing.value = value;
							existing.deleted = false;
						} else {
							entries.push({ key: value.k, value });
						}
					},
					openCursor: (range?: { lower: string; open: boolean }) => {
						const request: any = {};
						const candidates = entries
							.filter((entry) => !entry.deleted && (!range || entry.key > range.lower))
							.sort((a, b) => a.key.localeCompare(b.key));
						let index = 0;
						const advance = () => {
							const entry = candidates[index];
							if (!entry) {
								request.result = null;
								request.onsuccess();
								inspectedPerTransaction.push(inspected);
								queueMicrotask(() => transaction.oncomplete());
								return;
							}
							let continued = false;
							inspected += 1;
							request.result = {
								key: entry.key,
								value: entry.value,
								delete: () => {
									entry.deleted = true;
									deleted.push(entry.key);
								},
								continue: () => {
									continued = true;
									index += 1;
									queueMicrotask(advance);
								},
							};
							request.onsuccess();
							if (!continued) {
								inspectedPerTransaction.push(inspected);
								queueMicrotask(() => transaction.oncomplete());
							}
						};
						queueMicrotask(advance);
						return request;
					},
				};
				transaction.objectStore = () => store;
				return transaction;
			}),
		};
		const cache = new IndexedDbCacheAdapter({ db, keyPrefix: "owned:" });

		await cache.set("fresh:first", "value", 60);
		await cache.set("fresh:second", "value", 60);

		expect(deleted).toHaveLength(20);
		expect(inspectedPerTransaction.every((count) => count <= 16)).toBe(true);
	});

	it("starts concurrent IndexedDB write sweeps only when each serialized put executes", async () => {
		const contexts: Array<{ tx: any; putRequest: any; store: any }> = [];
		const db = {
			transaction: vi.fn(() => {
				const tx: any = {};
				const putRequest: any = {};
				const store = { put: () => putRequest, openCursor: vi.fn() };
				contexts.push({ tx, putRequest, store });
				tx.objectStore = () => store;
				return tx;
			}),
		};
		const cache = new IndexedDbCacheAdapter({ db });
		const checkpoints: unknown[] = [];
		vi.spyOn(cache as any, "sweepExpiredRecords").mockImplementation(function (this: any) {
			checkpoints.push(this.sweepAfterKey);
			this.sweepAfterKey = `checkpoint:${checkpoints.length}`;
		});

		const first = cache.set("first", 1, 60);
		const second = cache.set("second", 2, 60);
		await vi.waitFor(() => expect(contexts).toHaveLength(2));
		expect(checkpoints).toEqual([]);

		contexts[0].putRequest.onsuccess();
		contexts[0].tx.oncomplete();
		await first;
		contexts[1].putRequest.onsuccess();
		contexts[1].tx.oncomplete();
		await second;

		expect(checkpoints).toEqual([undefined, "checkpoint:1"]);
	});

	it("uses the IndexedDB store's native clear when no prefix is configured", async () => {
		const transaction: any = {};
		const clear = vi.fn(() => queueMicrotask(() => transaction.oncomplete()));
		transaction.objectStore = () => ({ clear });
		const cache = new IndexedDbCacheAdapter({ db: { transaction: () => transaction } });

		await cache.clear();
		expect(clear).toHaveBeenCalledOnce();
	});

	it("strictly validates IndexedDB adapter options and an injected database", () => {
		expect(() => new IndexedDbCacheAdapter([] as any)).toThrow(/options must be an object/);
		expect(() => new IndexedDbCacheAdapter(new (class Options {})() as any)).toThrow(/options must be an object/);
		expect(() => new IndexedDbCacheAdapter({ typo: true } as any)).toThrow(/typo/);
		const marker = Symbol("typo");
		const options: any = {};
		options[marker] = true;
		expect(() => new IndexedDbCacheAdapter(options)).toThrow(/Symbol\(typo\)/);
		expect(() => new IndexedDbCacheAdapter({ db: {} } as any)).toThrow(/opened IDBDatabase/);
		expect(() => new IndexedDbCacheAdapter({ db: [] } as any)).toThrow(/opened IDBDatabase/);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1])("rejects an invalid scoped-cache duration (%s)", (ttlSeconds) => {
		expect(() =>
			createNetworkScopedCache(
				{ get: vi.fn(), set: vi.fn() },
				{ enabled: true, ttlSeconds }
			)
		).toThrow(ValidationError);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])("rejects an invalid configured duration (%s)", (duration) => {
		expect(() => snapshotCacheConfig({ duration })).toThrow(ConfigError);
		expect(() => snapshotCacheConfig({ resources: { tokens: { duration } } })).toThrow(ConfigError);
	});

	it("rejects an explicitly null cache duration", () => {
		expect(() => snapshotCacheConfig({ duration: null } as any)).toThrow(ConfigError);
	});

	it("snapshots nested cache policy without cloning the caller-owned adapter", () => {
		const adapter = { get: vi.fn(), set: vi.fn() };
		const input = {
			isEnabled: true,
			duration: 120,
			resources: { tokens: { isEnabled: true, duration: 30 } },
			adapter,
		};
		const snapshot = snapshotCacheConfig(input);

		input.duration = 999;
		input.resources.tokens.duration = 999;
		expect(snapshot.duration).toBe(120);
		expect(snapshot.resources?.tokens?.duration).toBe(30);
		expect(snapshot.adapter).toBe(adapter);
	});

	it("rejects malformed cache policy and adapter shapes", () => {
		expect(() => snapshotCacheConfig({ isEnabled: "yes" } as any)).toThrow(ConfigError);
		expect(() => snapshotCacheConfig({ resources: { tokens: 30 } } as any)).toThrow(ConfigError);
		expect(() => snapshotCacheConfig({ adapter: {} } as any)).toThrow(ConfigError);
		expect(() => snapshotCacheConfig({ enabled: true } as any)).toThrow(/cache\.enabled/);
		expect(() => snapshotCacheConfig({ resources: { toknes: { isEnabled: true } } } as any)).toThrow(/toknes/);
		expect(() => snapshotCacheConfig({ resources: { tokens: { ttl: 60 } } } as any)).toThrow(/tokens\.ttl/);
	});
});
