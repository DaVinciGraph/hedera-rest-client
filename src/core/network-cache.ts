import type { CacheAdapter, NetworkName } from "../types";
import type { Logger } from "./logger";
import { assertValidCacheTtl, isValidCacheExpiration } from "./cache-ttl";

/**
 * Cache access scoped by the network that produced the response.
 *
 * Providers are deliberately absent from this interface: equivalent mirror
 * nodes for the same Hedera network may share cached responses, while
 * responses from different networks must never share a key.
 */
export interface NetworkScopedCache<V = unknown> {
	/** Whether this resource is allowed to access the cache. */
	readonly enabled: boolean;
	/** TTL used when a fetched response is written. */
	readonly ttlSeconds: number;
	get(network: NetworkName, logicalKey: string): Promise<V | undefined>;
	set(network: NetworkName, logicalKey: string, value: V, ttlSeconds: number): Promise<void>;
}

export interface NetworkScopedCacheOptions {
	enabled: boolean;
	ttlSeconds: number;
	/** Optional client logger used to report fail-open adapter failures. */
	logger?: Pick<Logger, "warn">;
}

/**
 * Cache-key schema version. Bump this only when existing entries are no longer
 * safe or compatible. Version 2 introduces a lossless JSON network segment
 * and intentionally does not read ambiguous version-1 or older keys.
 */
const CACHE_KEY_PREFIX = "hedera-rest-client:2";

function physicalKey(network: NetworkName, logicalKey: string): string {
	// JSON string encoding is self-delimiting and preserves lone UTF-16 surrogates
	// as ASCII escape sequences. Distinct JS network names therefore remain
	// distinct even after Redis or another backend encodes keys as UTF-8.
	return `${CACHE_KEY_PREFIX}:${JSON.stringify(network)}:${logicalKey}`;
}

/**
 * Detach JSON-derived Mirror Node data at the cache boundary.
 *
 * The default in-memory adapter intentionally accepts arbitrary application
 * values and therefore has reference semantics when used directly. Client
 * responses, however, must not let a caller mutate the cached snapshot (or let
 * a custom adapter mutate the fresh response it is given).
 */
function cloneCachedValue<V>(value: V): V {
	return structuredClone(value);
}

/** Wrap a public cache adapter with a resource policy and network-safe keys. */
export function createNetworkScopedCache<V>(adapter: CacheAdapter<unknown>, options: NetworkScopedCacheOptions): NetworkScopedCache<V> {
	const enabled = options.enabled;
	const defaultTtlSeconds = options.ttlSeconds;
	assertValidCacheTtl(defaultTtlSeconds, "cache duration");

	const warn = (operation: "read" | "write", network: NetworkName, logicalKey: string, error: unknown) => {
		options.logger?.warn(`Cache ${operation} failed; continuing without cache`, {
			network,
			key: logicalKey,
			error,
		});
	};

	return {
		enabled,
		ttlSeconds: defaultTtlSeconds,
		async get(network, logicalKey) {
			if (!enabled) return undefined;
			const key = physicalKey(network, logicalKey);
			try {
				const record = await adapter.get(key);
				if (record === undefined) return undefined;
				if (
					typeof record !== "object" ||
					record === null ||
					!isValidCacheExpiration(record.expiresAt) ||
					Date.now() >= record.expiresAt
				) {
					// A generic CacheAdapter has no compare-and-delete operation. Deleting
					// this observed snapshot after an await could remove a newer value that
					// another request wrote under the same key, so cleanup belongs to an
					// adapter that can perform it atomically.
					return undefined;
				}
				return cloneCachedValue(record.value as V);
			} catch (error) {
				warn("read", network, logicalKey, error);
				return undefined;
			}
		},
		async set(network, logicalKey, value, ttlSeconds) {
			if (!enabled) return Promise.resolve();
			assertValidCacheTtl(ttlSeconds, "cache duration");
			try {
				await adapter.set(physicalKey(network, logicalKey), cloneCachedValue(value), ttlSeconds);
			} catch (error) {
				warn("write", network, logicalKey, error);
			}
		},
	};
}
