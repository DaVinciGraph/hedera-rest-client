// src/core/cache-indexeddb.ts
import type { CacheAdapter, CacheRecord } from "../types";
import { cacheExpiresAt, isValidCacheExpiration } from "./cache-ttl";
import { ConfigError } from "./errors";

/** Dependency-free structural surface required from an already opened IndexedDB database. */
export interface IndexedDbDatabase {
	transaction: (...args: never[]) => unknown;
}

/**
 * Configuration options for {@link IndexedDbCacheAdapter}.
 *
 * @typeParam V - The value type exposed by the cache.
 * @typeParam Stored - The serialized value written to IndexedDB.
 */
export interface IndexedDbCacheOptions<V = unknown, Stored = V> {
	/**
	 * A pre‑opened `IDBDatabase` instance.
	 *
	 * Use this if your application already manages the IndexedDB lifecycle
	 * (opening, versioning, handling upgrades). When supplied, the adapter will
	 * use it directly and will not attempt to open its own database.
	 *
	 * @remarks
	 * This is typed without DOM-library dependencies so Node projects can import
	 * the adapter types without enabling `lib.dom`.
	 */
	db?: IndexedDbDatabase;

	/**
	 * Database name to open lazily when {@link db} is not provided.
	 * @defaultValue `"hedera-rest-cache"`
	 */
	dbName?: string;

	/**
	 * Object store name created/accessed within the database.
	 * @defaultValue `"cache"`
	 */
	storeName?: string;

	/**
	 * Database version used when lazily opening the database.
	 * If the DB does not exist or the version is higher, an upgrade is performed
	 * to create the object store (if missing).
	 * @defaultValue `1`
	 */
	version?: number;

	/**
	 * Optional logical prefix added to every application key before it is stored
	 * as the IndexedDB primary key.
	 *
	 * @example
	 * If `keyPrefix = "mainnet:"` and your key is `"account:0.0.1001"`,
	 * the actual record key becomes `"mainnet:account:0.0.1001"`.
	 *
	 * @defaultValue `""` (no prefix)
	 */
	keyPrefix?: string;

	/**
	 * Optional custom serializer for values.
	 *
	 * @remarks
	 * - The object store stores a **structured‑clone** of whatever you pass to
	 *   `serialize`. By default, the adapter stores values directly (identity),
	 *   which means your values **must** be structured‑cloneable (no functions,
	 *   DOM nodes, etc.).
	 * - Provide a serializer (e.g. to JSON) if you wish to normalize values or
	 *   store non‑cloneable shapes.
	 */
	serialize?: (v: V) => Stored;

	/**
	 * Optional custom deserializer that reconstructs values on reads.
	 * Defaults to identity cast.
	 */
	deserialize?: (raw: Stored) => V;
}

/**
 * A browser‑friendly cache adapter backed by **IndexedDB**.
 *
 * @typeParam V — The value type stored in the cache.
 *
 * @overview
 * - Stores one record per key in a dedicated object store (default: `"cache"`).
 * - Each record has shape `{ k, v, e }` where:
 *   - `k` — full key (with optional prefix),
 *   - `v` — serialized value (via {@link IndexedDbCacheOptions.serialize}),
 *   - `e` — absolute expiration time in **milliseconds since epoch**.
 * - Expired records are treated as cache misses and are cleaned up best‑effort.
 *
 * @environment
 * - Works in browsers and Web Workers whenever `globalThis.indexedDB` is
 *   available, or with an already opened `IDBDatabase` supplied through
 *   {@link IndexedDbCacheOptions.db}. Otherwise the first access will throw.
 *
 * @lifecycle
 * - If you do not pass {@link IndexedDbCacheOptions.db}, the adapter lazily opens
 *   (and creates if needed) an IndexedDB database using {@link IndexedDbCacheOptions.dbName},
 *   {@link IndexedDbCacheOptions.version}, and {@link IndexedDbCacheOptions.storeName}.
 * - The database is opened once and cached internally.
 *
 * @expiration
 * - TTL is enforced by comparing the current time with `e` on reads.
 * - There is no background cleanup; expired records are removed opportunistically.
 *
 * @clear behavior
 * - Without a `keyPrefix`, {@link clear} removes all records in the configured
 *   object store.
 * - With a `keyPrefix`, it cursor-deletes only keys in that namespace, so other
 *   adapters and application data sharing the store remain untouched.
 */
export class IndexedDbCacheAdapter<V = unknown, Stored = V> implements CacheAdapter<V> {
	/** Optional pre‑opened database instance (if provided by the caller). */
	private db?: any;
	/** Promise used to coalesce concurrent open requests. */
	private opening?: Promise<any>;
	/** Last key visited by the bounded write-time expiration sweep. */
	private sweepAfterKey?: any;
	private static readonly SWEEP_BATCH_SIZE = 16;

	/**
	 * Resolved, default‑filled options, plus concrete (de)serializers.
	 * Wrapped to keep the class ergonomics simple and tooltips precise.
	 */
	private opts: Required<Omit<IndexedDbCacheOptions<V, Stored>, "db" | "serialize" | "deserialize">> & {
		serialize: (v: V) => Stored;
		deserialize: (raw: Stored) => V;
	};

	/**
	 * Create a new IndexedDB‑backed cache adapter.
	 *
	 * @param options - Optional configuration. If you pass an open `db`, no lazy
	 *                  opening occurs; otherwise the adapter will open/create a DB.
	 */
	constructor(options: IndexedDbCacheOptions<V, Stored> = {}) {
		if (
			!options ||
			typeof options !== "object" ||
			Array.isArray(options) ||
			(Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
		) {
			throw new ConfigError("IndexedDbCacheAdapter options must be an object");
		}
		const allowedOptions = new Set(["db", "dbName", "storeName", "version", "keyPrefix", "serialize", "deserialize"]);
		for (const key of Reflect.ownKeys(options)) {
			if (typeof key !== "string" || !allowedOptions.has(key)) {
				throw new ConfigError(`IndexedDbCacheAdapter received an unknown option: ${String(key)}`);
			}
		}
		if (
			options.db !== undefined &&
			(typeof options.db !== "object" || options.db === null || Array.isArray(options.db) || typeof (options.db as any).transaction !== "function")
		) {
			throw new ConfigError("IndexedDbCacheAdapter db must be an opened IDBDatabase object");
		}
		for (const [name, value] of [
			["dbName", options.dbName],
			["storeName", options.storeName],
			["keyPrefix", options.keyPrefix],
		] as const) {
			if (value !== undefined && typeof value !== "string") {
				throw new ConfigError(`IndexedDbCacheAdapter ${name} must be a string`);
			}
		}
		if (options.dbName !== undefined && options.dbName.length === 0) {
			throw new ConfigError("IndexedDbCacheAdapter dbName must not be empty");
		}
		if (options.storeName !== undefined && options.storeName.length === 0) {
			throw new ConfigError("IndexedDbCacheAdapter storeName must not be empty");
		}
		if (options.version !== undefined && (!Number.isSafeInteger(options.version) || options.version < 1)) {
			throw new ConfigError("IndexedDbCacheAdapter version must be a positive safe integer");
		}
		if (options.serialize !== undefined && typeof options.serialize !== "function") {
			throw new ConfigError("IndexedDbCacheAdapter serialize must be a function");
		}
		if (options.deserialize !== undefined && typeof options.deserialize !== "function") {
			throw new ConfigError("IndexedDbCacheAdapter deserialize must be a function");
		}
		this.db = options.db;
		this.opts = {
			dbName: options.dbName ?? "hedera-rest-cache",
			storeName: options.storeName ?? "cache",
			version: options.version ?? 1,
			keyPrefix: options.keyPrefix ?? "",
			serialize: options.serialize ?? ((v) => v as unknown as Stored),
			deserialize: options.deserialize ?? ((raw) => raw as unknown as V),
		};
	}

	/** Release an internally owned connection on upgrades or unexpected closes. */
	private watchOwnedDatabase(db: any): void {
		const clearIfCurrent = () => {
			if (this.db === db) this.db = undefined;
		};
		const onVersionChange = () => {
			clearIfCurrent();
			db.close?.();
		};

		if (typeof db.addEventListener === "function") {
			db.addEventListener("versionchange", onVersionChange);
			db.addEventListener("close", clearIfCurrent);
		} else {
			db.onversionchange = onVersionChange;
			db.onclose = clearIfCurrent;
		}
	}

	/**
	 * Obtain an open `IDBDatabase`.
	 *
	 * - If a pre‑opened DB was provided, returns it.
	 * - Otherwise, lazily opens the database, creating the object store on upgrade.
	 *
	 * @throws If `globalThis.indexedDB` is unavailable and no DB was provided.
	 */
	private async getDb(): Promise<any> {
		if (this.db) return this.db;

		const idb = (globalThis as any).indexedDB;
		if (!idb || typeof idb.open !== "function") {
			throw new Error("IndexedDbCacheAdapter requires globalThis.indexedDB OR an existing db instance via { db }.");
		}

		if (!this.opening) {
			const opening = new Promise<any>((resolve, reject) => {
				const req = idb.open(this.opts.dbName, this.opts.version);
				let settled = false;
				const resolveOnce = (db: any) => {
					if (settled) {
						db?.close?.();
						return;
					}
					settled = true;
					resolve(db);
				};
				const rejectOnce = (error: unknown) => {
					if (settled) return;
					settled = true;
					reject(error);
				};

				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains(this.opts.storeName)) {
						db.createObjectStore(this.opts.storeName, { keyPath: "k" });
					}
				};

				req.onsuccess = () => resolveOnce(req.result);
				req.onerror = () => rejectOnce(req.error ?? new Error("Unable to open the IndexedDB cache"));
				req.onblocked = () => rejectOnce(new Error("Opening the IndexedDB cache was blocked by another connection"));
			});
			this.opening = opening;
		}

		const opening = this.opening;
		try {
			const db = await opening;
			if (this.opening === opening) {
				this.db = db;
				this.opening = undefined;
				this.watchOwnedDatabase(db);
			}
			return this.db ?? db;
		} catch (error) {
			if (this.opening === opening) this.opening = undefined;
			throw error;
		}
	}

	/**
	 * Produce the physical key stored in the object store by applying
	 * the configured {@link IndexedDbCacheOptions.keyPrefix}.
	 */
	private fullKey(key: string): string {
		return this.opts.keyPrefix ? `${this.opts.keyPrefix}${key}` : key;
	}

	/**
	 * Start a transaction on the configured object store.
	 * @param db - Open `IDBDatabase` instance.
	 * @param mode - `"readonly"` or `"readwrite"`.
	 * @returns `{ tx, store }` — the transaction and its object store.
	 */
	private tx(db: any, mode: "readonly" | "readwrite") {
		const tx = db.transaction(this.opts.storeName, mode);
		const store = tx.objectStore(this.opts.storeName);
		return { tx, store };
	}

	/**
	 * Read a record by key.
	 *
	 * @param key - Logical application key (without prefix).
	 * @returns A {@link CacheRecord} or `undefined` if not found or expired.
	 *
	 * @remarks
	 * - Expired entries are treated as misses and are deleted best‑effort.
	 * - Values are passed through {@link IndexedDbCacheOptions.deserialize}.
	 */
	async get(key: string): Promise<CacheRecord<V> | undefined> {
		const db = await this.getDb();
		const k = this.fullKey(key);
		const { store } = this.tx(db, "readonly");

		const rec: any = await new Promise((resolve, reject) => {
			const req = store.get(k);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});

		if (!rec) return undefined;

		const expiresAt = rec.e as number;
		if (!isValidCacheExpiration(expiresAt) || Date.now() >= expiresAt) {
			// Re-read and conditionally delete inside one readwrite transaction. A
			// separate unconditional delete could erase a newer concurrent put.
			try {
				await this.deleteIfStillStale(db, k);
			} catch {}
			return undefined;
		}

		const value = this.opts.deserialize(rec.v as Stored);
		return { value, expiresAt };
	}

	/** Queue a bounded stale-record scan in an existing readwrite transaction. */
	private sweepExpiredRecords(store: any, now: number): void {
		if (typeof store.openCursor !== "function") return;

		const keyRangeFactory = (globalThis as any).IDBKeyRange;
		const canResume = typeof keyRangeFactory?.lowerBound === "function";
		let range: any;
		if (this.sweepAfterKey !== undefined && canResume) {
			try {
				range = keyRangeFactory.lowerBound(this.sweepAfterKey, true);
			} catch {
				this.sweepAfterKey = undefined;
			}
		} else if (this.sweepAfterKey !== undefined) {
			// Real IndexedDB environments expose IDBKeyRange. If a compatible shim
			// does not, restart and finish a complete scan so leading live records
			// cannot starve stale records later in the store.
			this.sweepAfterKey = undefined;
		}

		const request = range === undefined ? store.openCursor() : store.openCursor(range);
		let inspected = 0;
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				this.sweepAfterKey = undefined;
				return;
			}

			const key = cursor.key;
			const belongsToAdapter =
				typeof key === "string" && (!this.opts.keyPrefix || key.startsWith(this.opts.keyPrefix));
			const record = cursor.value;
			if (
				belongsToAdapter &&
				(!record || !isValidCacheExpiration(record.e) || now >= record.e)
			) {
				cursor.delete();
			}

			inspected += 1;
			if (canResume && inspected >= IndexedDbCacheAdapter.SWEEP_BATCH_SIZE) {
				this.sweepAfterKey = key;
				return;
			}
			cursor.continue();
		};
	}

	/** Remove a malformed/expired value only if it is still stale when write-locked. */
	private async deleteIfStillStale(db: any, key: string): Promise<void> {
		const { tx, store } = this.tx(db, "readwrite");
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const resolveOnce = () => {
				if (settled) return;
				settled = true;
				resolve();
			};
			const rejectOnce = (error: unknown) => {
				if (settled) return;
				settled = true;
				reject(error);
			};

			tx.oncomplete = resolveOnce;
			tx.onerror = () => rejectOnce(tx.error);
			tx.onabort = () => rejectOnce(tx.error ?? new Error("IndexedDB cache cleanup was aborted"));

			const request = store.get(key);
			request.onerror = () => rejectOnce(request.error);
			request.onsuccess = () => {
				const current = request.result;
				if (!current) return;
				const currentExpiry = current.e;
				if (!isValidCacheExpiration(currentExpiry) || Date.now() >= currentExpiry) {
					store.delete(key);
				}
			};
		});
	}

	/**
	 * Insert or update a record with a TTL.
	 *
	 * @param key - Logical application key (without prefix).
	 * @param value - Value to store (will be serialized).
	 * @param ttlSeconds - Finite, non-negative time-to-live in **seconds**, represented to millisecond precision.
	 *
	 * @remarks
	 * - The adapter computes an absolute expiration time and stores it as `e`.
	 * - Values are serialized using {@link IndexedDbCacheOptions.serialize}.
	 * - The write uses `put`, so it will add or replace the record.
	 * - Each write also scans a bounded batch of stored records for expiration;
	 *   no background timer is created.
	 */
	async set(key: string, value: V, ttlSeconds: number): Promise<void> {
		const expiresAt = cacheExpiresAt(ttlSeconds);
		const db = await this.getDb();
		const k = this.fullKey(key);
		const { tx, store } = this.tx(db, "readwrite");

		const payload = { k, v: this.opts.serialize(value), e: expiresAt };
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error ?? new Error("IndexedDB cache write was aborted"));
			const putRequest = store.put(payload);
			if (putRequest && typeof putRequest === "object") {
				// IndexedDB readwrite transactions execute serially. Starting the sweep
				// only once this transaction's put runs ensures concurrent set() calls
				// observe and advance the shared checkpoint in transaction order.
				putRequest.onsuccess = () => this.sweepExpiredRecords(store, Date.now());
			} else {
				// Retain compatibility with small test/ponyfill stores whose put method
				// does not expose an IDBRequest object.
				this.sweepExpiredRecords(store, Date.now());
			}
		});
	}

	/**
	 * Delete a record by key.
	 *
	 * @param key - Logical application key (without prefix).
	 */
	async delete(key: string): Promise<void> {
		const db = await this.getDb();
		const k = this.fullKey(key);
		const { tx, store } = this.tx(db, "readwrite");
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error ?? new Error("IndexedDB cache delete was aborted"));
			store.delete(k);
		});
	}

	/**
	 * Remove entries owned by this adapter from the configured object store.
	 *
	 * @remarks
	 * An empty prefix clears the entire store. A configured prefix limits deletion
	 * to string keys beginning with that exact prefix.
	 */
	async clear(): Promise<void> {
		const db = await this.getDb();
		const { tx, store } = this.tx(db, "readwrite");
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error ?? new Error("IndexedDB cache clear was aborted"));

			if (!this.opts.keyPrefix) {
				store.clear();
				return;
			}

			const request = store.openCursor();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const cursor = request.result;
				if (!cursor) return;
				if (typeof cursor.key === "string" && cursor.key.startsWith(this.opts.keyPrefix)) {
					cursor.delete();
				}
				cursor.continue();
			};
		});
	}
}
