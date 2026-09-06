// src/core/cache.ts

import type { CacheAdapter, CacheRecord } from "../types";
import { cacheExpiresAt } from "./cache-ttl";

/**
 * Simple in-memory, time‑to‑live (TTL) cache.
 *
 * @remarks
 * - **Isomorphic**: works in both Node.js and browsers.
 * - **TTL‑based eviction**: entries expire after `ttlSeconds` from the time of `set`.
 * - **Opportunistic cleanup**: reads remove their own stale key and writes scan
 *   a bounded batch, so write-through workloads do not retain expired entries
 *   forever. No timer or background task is created.
 * - **Bounded operations**: each write inspects at most a small fixed number of
 *   existing entries; `get`, `delete`, and `clear` remain constant time.
 *
 * This adapter implements the {@link CacheAdapter} interface used by
 * {@link HederaRestClient} to cache selected resource reads. Keys are arbitrary
 * strings; values are application‑defined. Internally, each key maps to a
 * {@link CacheRecord} with a `value` and an `expiresAt` timestamp (epoch ms).
 *
 * @example Basic usage
 * ```ts
 * const cache = new MemoryCacheAdapter<string>();
 * await cache.set("greeting", "hello", 60); // keep for 60 seconds
 *
 * const rec = await cache.get("greeting");
 * console.log(rec?.value); // "hello"
 * ```
 *
 * @example Network‑scoped keys (as used by the client)
 * ```ts
 * const net = "testnet";
 * const key = `hedera-rest-client:2:${JSON.stringify(net)}:contract:0.0.1234`;
 * await cache.set(key, { id: "0.0.1234" }, 300);
 * const hit = await cache.get(key); // { value: {…}, expiresAt: … }
 * ```
 *
 * @example Implementing your own adapter
 * If you need persistence or distributed caching, implement the `CacheAdapter`
 * interface and swap it in through the client config:
 * ```ts
 * class RedisCache<V> implements CacheAdapter<V> {
 *   // implement get/set/delete/clear using your backend
 * }
 * // new HederaRestClient({ cache: { isEnabled: true, adapter: new RedisCache() } });
 * ```
 *
 * @notes
 * - TTL granularity is seconds (provided at `set`) but internally stored in ms.
 * - A TTL of `0` expires immediately. Negative, non-finite, and
 *   unrepresentably large TTLs are rejected with a validation error.
 * - Expired entries are reclaimed by reads, bounded write-time sweeps, or an
 *   explicit `delete`/`clear`.
 * - This cache is process‑local (per JS runtime instance). It does not
 *   synchronize across tabs, workers, or servers.
 */
export class MemoryCacheAdapter<V = unknown> implements CacheAdapter<V> {
	/** Internal storage of cache records keyed by arbitrary strings. */
	private store = new Map<string, CacheRecord<V>>();
	/** Cursor retained across bounded write-time expiration sweeps. */
	private sweepCursor?: IterableIterator<[string, CacheRecord<V>]>;
	private static readonly SWEEP_BATCH_SIZE = 16;

	/** Inspect a bounded portion of the map and remove entries stale at `now`. */
	private sweepExpired(now: number): void {
		if (this.store.size === 0) {
			this.sweepCursor = undefined;
			return;
		}
		this.sweepCursor ??= this.store.entries();
		for (let inspected = 0; inspected < MemoryCacheAdapter.SWEEP_BATCH_SIZE; inspected += 1) {
			const next = this.sweepCursor.next();
			if (next.done) {
				this.sweepCursor = undefined;
				break;
			}
			const [key, observed] = next.value;
			// Re-read before deletion so a replacement made during iteration is never
			// removed based on the older record's deadline.
			const current = this.store.get(key);
			if (current === observed && now >= current.expiresAt) this.store.delete(key);
		}
	}

	/**
	 * Retrieve a cache record if present and not expired.
	 *
	 * @param key - The cache key.
	 * @returns The {@link CacheRecord} or `undefined` if the key is absent or expired.
	 *
	 * @remarks
	 * If the record is expired at the time of access, it is removed and `undefined`
	 * is returned. Writes also perform a bounded opportunistic expiration sweep.
	 */
	async get(key: string): Promise<CacheRecord<V> | undefined> {
		const rec = this.store.get(key);
		if (!rec) return undefined;
		if (Date.now() >= rec.expiresAt) {
			this.store.delete(key);
			return undefined;
		}
		return rec;
	}

	/**
	 * Insert or replace a cache entry with a TTL.
	 *
	 * @param key - The cache key.
	 * @param value - The value to store.
	 * @param ttlSeconds - Time‑to‑live in **seconds** from now.
	 *
	 * @remarks
	 * The expiration time is computed as `Date.now() + ttlSeconds * 1000`.
	 * A zero TTL results in immediate expiration. Invalid TTLs are rejected.
	 */
	async set(key: string, value: V, ttlSeconds: number): Promise<void> {
		const expiresAt = cacheExpiresAt(ttlSeconds);
		const now = Date.now();
		this.sweepExpired(now);
		if (expiresAt <= now) {
			this.store.delete(key);
			return;
		}
		this.store.set(key, { value, expiresAt });
	}

	/**
	 * Remove a single cache entry.
	 *
	 * @param key - The cache key to delete.
	 *
	 * @remarks
	 * Deleting a non‑existent key is a no‑op.
	 */
	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	/**
	 * Remove all entries from the cache.
	 *
	 * @remarks
	 * This operation clears the entire in‑memory map and frees associated memory.
	 */
	async clear(): Promise<void> {
		this.store.clear();
		this.sweepCursor = undefined;
	}
}
