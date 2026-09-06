// src/core/cache-redis.ts
import type { CacheAdapter, CacheRecord } from "../types";
import { cacheExpiresAt, isValidCacheExpiration } from "./cache-ttl";
import { ConfigError } from "./errors";

type RedisClientMethod = (...args: never[]) => unknown;

/**
 * Friendly-only adapters that share a client also share their per-key queues.
 * The weak key lets both the client and its empty queue be collected normally.
 */
const friendlyMutationTailsByClient = new WeakMap<object, Map<string, Promise<void>>>();

/** Dependency-free structural surface accepted from node-redis, ioredis, or a compatible client. */
export interface RedisCacheClient {
	get?: RedisClientMethod;
	set?: RedisClientMethod;
	del?: RedisClientMethod;
	expire?: RedisClientMethod;
	pExpire?: RedisClientMethod;
	pexpire?: RedisClientMethod;
	call?: RedisClientMethod;
	sendCommand?: RedisClientMethod;
	scan?: RedisClientMethod;
}

/**
 * Configuration options for {@link RedisCacheAdapter}.
 *
 * @typeParam V - The value type exposed by the cache.
 * @typeParam Stored - The serialized value embedded in the Redis payload.
 */
export interface RedisCacheAdapterOptions<V = unknown, Stored = V> {
	/**
	 * A pre‑initialized Redis client.
	 *
	 * Supports:
	 * - **node-redis v4** (`createClient`) — methods like `get`, `set`, `expire`, `del`, `scan`.
	 * - **ioredis** — methods are similar; when unavailable, a raw `sendCommand` path is used.
	 *
	 * This adapter does not create or manage the connection; you own the lifecycle.
	 */
	client: RedisCacheClient;

	/**
	 * Optional fixed prefix added to every key sent to Redis, e.g. `"hedera:"`.
	 *
	 * @remarks
	 * - Using a prefix is recommended so {@link clear} can safely remove only this
	 *   adapter’s keys.
	 * - If omitted, {@link clear} becomes a no‑op to avoid flushing unrelated keys.
	 */
	keyPrefix?: string;

	/**
	 * Optional custom serialization function.
	 * Defaults to an identity function that expects JSON‑serializable values.
	 *
	 * @example
	 * ```ts
	 * serialize: (value) => JSON.stringify(value)
	 * ```
	 */
	serialize?: (v: V) => Stored;

	/**
	 * Optional custom deserialization function for values read from Redis.
	 * Defaults to a simple cast.
	 *
	 * @example
	 * ```ts
	 * deserialize: (raw) => JSON.parse(raw)
	 * ```
	 */
	deserialize?: (raw: Stored) => V;

	/**
	 * If `true`, sets a Redis TTL on the key in addition to embedding `expiresAt`
	 * inside the stored payload. Defaults to `true` and is recommended.
	 *
	 * @remarks
	 * - Redis TTL provides server‑side eviction even if the key is never read again.
	 * - The adapter *always* embeds the `expiresAt` timestamp and honors it on `get`
	 *   as an extra check.
	 */
	useRedisExpire?: boolean;

	/**
	 * Hint for Redis `SCAN` during {@link clear}. Defaults to `500`.
	 * Larger values walk the keyspace faster at the cost of burstier memory/CPU.
	 */
	scanCount?: number;
}

/**
 * Redis‑backed cache adapter implementing the {@link CacheAdapter} interface.
 *
 * @typeParam V - The type of values to be stored in the cache.
 *
 * @remarks
 * **Storage format**
 * Values are stored as a JSON string under the Redis key:
 * ```json
 * { "v": <serializedValue>, "e": <expiresAtEpochMs> }
 * ```
 * where:
 * - `v` is the result of your `serialize` function (identity by default).
 * - `e` is the absolute expiration time in **milliseconds since epoch**.
 *
 * **Expiration behavior**
 * - On `set`, if {@link RedisCacheAdapterOptions.useRedisExpire} is `true`,
 *   an atomic millisecond Redis TTL is applied when a raw command API is available.
 *   The payload also embeds the same `expiresAt`.
 * - On `get`, the adapter checks `expiresAt` and treats expired entries as misses.
 *
 * **Client compatibility**
 * - Works with **node-redis v4** and **ioredis**.
 * - If a high‑level method (e.g. `get`, `set`) is missing or throws, the adapter
 *   falls back to `sendCommand` where possible.
 *
 * **Safety notes**
 * - {@link clear} only operates when a {@link RedisCacheAdapterOptions.keyPrefix}
 *   is set. If no prefix is provided, `clear` is a no‑op to avoid accidental mass deletion.
 */
export class RedisCacheAdapter<V = unknown, Stored = V> implements CacheAdapter<V> {
	/** Underlying Redis client supplied by the user. */
	private client: any;
	/** Fixed key prefix (namespace). May be empty. */
	private prefix: string;
	/** Serializer to store values as part of the JSON payload. */
	private serialize: (v: V) => Stored;
	/** Deserializer to reconstruct values from the JSON payload. */
	private deserialize: (raw: Stored) => V;
	/** Whether to also set Redis TTL on keys. */
	private useExpire: boolean;
	/** COUNT hint for SCAN during {@link clear}. */
	private scanCount: number;
	/**
	 * Per-key mutation tails for friendly-only clients whose SET and expiry must
	 * be issued as two commands. Entries are removed as soon as the final queued
	 * mutation settles.
	 */
	private friendlyMutationTails: Map<string, Promise<void>>;

	/**
	 * Create a new Redis cache adapter.
	 *
	 * @param opts - Adapter configuration and a connected Redis client.
	 * @throws If `opts` or `opts.client` is missing.
	 */
	constructor(opts: RedisCacheAdapterOptions<V, Stored>) {
		if (
			!opts ||
			typeof opts !== "object" ||
			Array.isArray(opts) ||
			(Object.getPrototypeOf(opts) !== Object.prototype && Object.getPrototypeOf(opts) !== null)
		) {
			throw new ConfigError("RedisCacheAdapter options must be an object");
		}
		const allowedOptions = new Set(["client", "keyPrefix", "serialize", "deserialize", "useRedisExpire", "scanCount"]);
		for (const key of Reflect.ownKeys(opts)) {
			if (typeof key !== "string" || !allowedOptions.has(key)) {
				throw new ConfigError(`RedisCacheAdapter received an unknown option: ${String(key)}`);
			}
		}
		if (!opts.client || typeof opts.client !== "object" || Array.isArray(opts.client)) {
			throw new ConfigError("RedisCacheAdapter requires { client } with a Redis client object");
		}
		if (opts.keyPrefix !== undefined && typeof opts.keyPrefix !== "string") {
			throw new ConfigError("RedisCacheAdapter keyPrefix must be a string");
		}
		if (opts.serialize !== undefined && typeof opts.serialize !== "function") {
			throw new ConfigError("RedisCacheAdapter serialize must be a function");
		}
		if (opts.deserialize !== undefined && typeof opts.deserialize !== "function") {
			throw new ConfigError("RedisCacheAdapter deserialize must be a function");
		}
		if (opts.useRedisExpire !== undefined && typeof opts.useRedisExpire !== "boolean") {
			throw new ConfigError("RedisCacheAdapter useRedisExpire must be a boolean");
		}
		if (opts.scanCount !== undefined && (!Number.isSafeInteger(opts.scanCount) || opts.scanCount < 1)) {
			throw new ConfigError("RedisCacheAdapter scanCount must be a positive safe integer");
		}
		const client = opts.client as any;
		const prefix = opts.keyPrefix ?? "";
		const useExpire = opts.useRedisExpire !== false;
		const hasRawCommands = typeof client.call === "function" || typeof client.sendCommand === "function";
		if (typeof client.get !== "function" && !hasRawCommands) {
			throw new ConfigError("RedisCacheAdapter client must expose get(), call(), or sendCommand()");
		}
		if (typeof client.set !== "function" && !hasRawCommands) {
			throw new ConfigError("RedisCacheAdapter client must expose set(), call(), or sendCommand()");
		}
		if (typeof client.del !== "function" && !hasRawCommands) {
			throw new ConfigError("RedisCacheAdapter client must expose del(), call(), or sendCommand()");
		}
		if (
			useExpire &&
			!hasRawCommands &&
			typeof client.pExpire !== "function" &&
			typeof client.pexpire !== "function" &&
			typeof client.expire !== "function"
		) {
			throw new ConfigError("RedisCacheAdapter client must expose pExpire(), pexpire(), expire(), or a raw command API");
		}
		this.client = client;
		let friendlyMutationTails = friendlyMutationTailsByClient.get(client);
		if (!friendlyMutationTails) {
			friendlyMutationTails = new Map<string, Promise<void>>();
			friendlyMutationTailsByClient.set(client, friendlyMutationTails);
		}
		this.friendlyMutationTails = friendlyMutationTails;
		this.prefix = prefix;
		this.serialize = opts.serialize ?? ((v) => v as unknown as Stored);
		this.deserialize = opts.deserialize ?? ((raw) => raw as unknown as V);
		this.useExpire = useExpire;
		this.scanCount = opts.scanCount ?? 500;
	}

	/**
	 * Compute the Redis key including the configured prefix (if any).
	 * @param key - Logical application key.
	 * @returns Physical Redis key with prefix applied.
	 */
	private k(key: string): string {
		return this.prefix ? this.prefix + key : key;
	}

	/**
	 * Look up a record by key.
	 *
	 * @param key - Logical application key.
	 * @returns A {@link CacheRecord} or `undefined` if the key is missing or expired.
	 *
	 * @remarks
	 * - If the JSON payload cannot be parsed, the entry is treated as a miss.
	 * - Expired records return `undefined`; reads never perform an unsafe
	 *   non-atomic GET-then-DEL cleanup.
	 */
	async get(key: string): Promise<CacheRecord<V> | undefined> {
		const kk = this.k(key);
		const raw = await this.safeGet(kk);

		if (raw == null) return undefined;

		const s = typeof raw === "string" ? raw : typeof Buffer !== "undefined" && Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
		let parsed: any;
		try {
			parsed = JSON.parse(s);
		} catch {
			return undefined;
		}

		const expiresAt = parsed?.e as number | undefined;
		if (!isValidCacheExpiration(expiresAt) || Date.now() >= expiresAt) {
			// GET followed by DEL is not atomic and could erase a newer concurrent
			// write. Redis expiry (enabled by default) owns physical cleanup.
			return undefined;
		}

		const value = this.deserialize(parsed?.v as Stored);
		return { value, expiresAt };
	}

	/**
	 * Insert or replace a key with a TTL.
	 *
	 * @param key - Logical application key.
	 * @param value - Value to store.
	 * @param ttlSeconds - Time‑to‑live in **seconds**.
	 *
	 * @remarks
	 * - `expiresAt` is computed as `Date.now() + ttlSeconds * 1000` and embedded in the payload.
	 * - If {@link useExpire} is `true`, a Redis key expiry is also set (zero deletes immediately).
	 * - Positive TTLs use millisecond precision. A positive sub-millisecond TTL
	 *   receives a 1 ms physical lease while the embedded timestamp stays authoritative.
	 * - Negative, non-finite, and unrepresentably large TTLs are rejected.
	 */
	async set(key: string, value: V, ttlSeconds: number): Promise<void> {
		const kk = this.k(key);
		const expiresAt = cacheExpiresAt(ttlSeconds);
		const ttlMilliseconds = ttlSeconds > 0 ? Math.max(1, Math.ceil(ttlSeconds * 1_000)) : 0;
		if (ttlSeconds <= 0) {
			await this.delete(key);
			return;
		}
		const payload = JSON.stringify({ v: this.serialize(value), e: expiresAt });

		// Preserve the native command paths: a plain SET when physical expiry is
		// disabled, or one atomic SET PX when it is enabled.
		if (this.hasRawCommands()) {
			if (!this.useExpire) {
				await this.safeSet(kk, payload);
				return;
			}
			await this.executeRawCommand("SET", kk, payload, "PX", String(ttlMilliseconds));
			return;
		}

		// A small custom client may expose only friendly methods. Serialize every
		// mutation per physical key—even writes configured without Redis expiry—so
		// none can be inserted between another adapter's SET and expiry command.
		// Different keys remain fully concurrent. If expiry fails, the embedded
		// deadline still makes the record a logical miss once stale; deleting here
		// could erase a newer value.
		await this.withFriendlyMutation(kk, async () => {
			await this.client.set(kk, payload);
			if (this.useExpire) await this.applyHighLevelExpiry(kk, ttlMilliseconds);
		});
	}

	/**
	 * Remove a single key from Redis.
	 *
	 * @param key - Logical application key.
	 * @remarks
	 * If the primary command path fails, a `sendCommand` fallback is attempted.
	 */
	async delete(key: string): Promise<void> {
		const kk = this.k(key);
		if (!this.hasRawCommands()) {
			await this.withFriendlyMutation(kk, async () => {
				await this.deleteWithHighLevelMethod(kk);
			});
			return;
		}

		let primaryError: unknown;
		if (typeof this.client.del === "function") {
			try {
				await this.client.del(kk);
				return;
			} catch (error) {
				primaryError = error;
			}
		}

		if (this.hasRawCommands()) {
			try {
				await this.executeRawCommand("DEL", kk);
				return;
			} catch (error) {
				throw new Error("Redis DEL failed through both supported command paths", { cause: error });
			}
		}

		throw new Error("RedisCacheAdapter requires a `del`, `call`, or `sendCommand` method", { cause: primaryError });
	}

	/**
	 * Prefix-scoped removal of all keys for this adapter.
	 *
	 * @remarks
	 * - Requires a {@link keyPrefix} to be set; if no prefix is configured,
	 *   **this method does nothing** to prevent accidental global deletes.
	 * - Uses Redis `SCAN` to iterate keys matching the literal prefix and deletes them in chunks.
	 * - Uses ioredis `call` or node-redis v4/v5 `sendCommand`, avoiding their incompatible
	 *   high-level `SCAN` and variadic `DEL` signatures.
	 * - Rechecks every returned key locally before deletion, so an ignored or overly broad
	 *   server-side `MATCH` can never authorize deletion outside the configured prefix.
	 *
	 * @throws If the client exposes neither ioredis `call` nor node-redis `sendCommand`,
	 * or when a Redis command fails or returns an unsupported `SCAN` response.
	 */
	async clear(): Promise<void> {
		if (!this.prefix) return;

		// Redis SCAN patterns use glob syntax. Escape the configured prefix so a
		// literal `*`, `?`, `[`, `]`, or `\\` cannot broaden the deletion scope.
		const pattern = `${this.escapeScanPattern(this.prefix)}*`;
		let cursor = "0";

		do {
			const res = await this.executeRawCommand("SCAN", cursor, "MATCH", pattern, "COUNT", String(this.scanCount));

			// Normalize to { cursor, keys[] }
			let pageKeys: any[];
			if (Array.isArray(res) && res.length === 2) {
				cursor = String(res[0]);
				if (!Array.isArray(res[1])) throw new Error("Unsupported Redis SCAN response shape");
				pageKeys = res[1];
			} else if (res && typeof res === "object" && "cursor" in res && "keys" in res) {
				cursor = String(res.cursor);
				if (!Array.isArray(res.keys)) throw new Error("Unsupported Redis SCAN response shape");
				pageKeys = res.keys;
			} else {
				throw new Error("Unsupported Redis SCAN response shape");
			}

			// MATCH is a server-side optimization, not the safety boundary. Check every
			// returned key again before allowing it into a destructive command. This
			// protects callers even when a proxy or custom Redis client mishandles MATCH.
			const keys = new Set<string>();
			for (const rawKey of pageKeys) {
				const key = typeof rawKey === "string" ? rawKey : String(rawKey);
				if (key.startsWith(this.prefix)) keys.add(key);
			}

			const allKeys = [...keys];
			const chunkSize = 1000;
			for (let i = 0; i < allKeys.length; i += chunkSize) {
				const chunk = allKeys.slice(i, i + chunkSize);
				await this.executeRawCommand("DEL", ...chunk);
			}
		} while (cursor !== "0");
	}

	/** Escape a literal string for use as the non-wildcard part of a Redis glob. */
	private escapeScanPattern(value: string): string {
		return value.replace(/[\\*?\[\]]/g, "\\$&");
	}

	/**
	 * Execute commands used by {@link clear} without guessing between incompatible
	 * high-level method signatures.
	 *
	 * ioredis exposes `call(command, ...args)`, while node-redis v4/v5 exposes
	 * `sendCommand([command, ...args])`. Both are raw command APIs, so SCAN and DEL
	 * have the same wire-level arguments regardless of client library.
	 */
	private hasRawCommands(): boolean {
		return typeof this.client.call === "function" || typeof this.client.sendCommand === "function";
	}

	private async executeRawCommand(command: string, ...args: string[]): Promise<any> {
		if (typeof this.client.call === "function") {
			return this.client.call(command, ...args);
		}
		if (typeof this.client.sendCommand === "function") {
			return this.client.sendCommand([command, ...args]);
		}
		throw new Error("RedisCacheAdapter requires an ioredis `call` method or node-redis `sendCommand` method");
	}

	/**
	 * Run a non-atomic friendly-client mutation after earlier mutations for the
	 * same physical key. The stored tail always fulfills, so one failed mutation
	 * cannot poison the queue. Identity-checked cleanup avoids deleting a newer
	 * tail that was appended while the operation was running.
	 */
	private async withFriendlyMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.friendlyMutationTails.get(key) ?? Promise.resolve();
		const result = previous.then(operation);
		const tail = result.then(
			() => undefined,
			() => undefined
		);
		this.friendlyMutationTails.set(key, tail);

		try {
			return await result;
		} finally {
			if (this.friendlyMutationTails.get(key) === tail) {
				this.friendlyMutationTails.delete(key);
			}
		}
	}

	/** Delete through a friendly-only client while preserving the public error. */
	private async deleteWithHighLevelMethod(k: string): Promise<void> {
		if (typeof this.client.del !== "function") {
			throw new Error("RedisCacheAdapter requires a `del`, `call`, or `sendCommand` method");
		}
		try {
			await this.client.del(k);
		} catch (error) {
			throw new Error("RedisCacheAdapter requires a `del`, `call`, or `sendCommand` method", { cause: error });
		}
	}

	// ---- client compatibility helpers ----

	/**
	 * Try a friendly `SET` first; if unavailable, fall back to `sendCommand`.
	 * @internal
	 */
	private async safeSet(k: string, payload: string): Promise<void> {
		let primaryError: unknown;
		if (typeof this.client.set === "function") {
			try {
				await this.client.set(k, payload);
				return;
			} catch (error) {
				primaryError = error;
			}
		}

		if (this.hasRawCommands()) {
			try {
				await this.executeRawCommand("SET", k, payload);
				return;
			} catch (error) {
				throw new Error("Redis SET failed through both supported command paths", { cause: error });
			}
		}

		throw new Error("RedisCacheAdapter requires a `set`, `call`, or `sendCommand` method", { cause: primaryError });
	}

	/**
	 * Try a friendly GET first; if it fails, retry through a raw command API.
	 * @internal
	 */
	private async safeGet(k: string): Promise<any> {
		let primaryError: unknown;
		if (typeof this.client.get === "function") {
			try {
				return await this.client.get(k);
			} catch (error) {
				primaryError = error;
			}
		}

		if (this.hasRawCommands()) {
			try {
				return await this.executeRawCommand("GET", k);
			} catch (error) {
				throw new Error("Redis GET failed through both supported command paths", { cause: error });
			}
		}

		throw new Error("RedisCacheAdapter requires a `get`, `call`, or `sendCommand` method", { cause: primaryError });
	}

	/** Apply millisecond expiry through the compatible high-level Redis method. */
	private async applyHighLevelExpiry(k: string, ttlMilliseconds: number): Promise<void> {
		if (typeof this.client.pExpire === "function") {
			await this.client.pExpire(k, ttlMilliseconds);
			return;
		}
		if (typeof this.client.pexpire === "function") {
			await this.client.pexpire(k, ttlMilliseconds);
			return;
		}
		if (typeof this.client.expire === "function") {
			// Rounding up prevents Redis from evicting before the embedded logical
			// expiration for clients that expose only second precision.
			await this.client.expire(k, Math.ceil(ttlMilliseconds / 1_000));
			return;
		}
		throw new Error("RedisCacheAdapter client does not expose an expiry method");
	}
}
