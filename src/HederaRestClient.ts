// src/HederaRestClient.ts

import { ProviderRegistry, validateName } from "./core/provider";
import { Logger } from "./core/logger";
import { MemoryCacheAdapter } from "./core/cache";
import { createNetworkScopedCache } from "./core/network-cache";
import { snapshotCacheConfig } from "./core/cache-config";
import { ConfigError } from "./core/errors";
import type { AccountBalanceTransactions, Block, CacheAdapter, CacheConfig, HederaRestClientConfig, ResourceCacheConfig, Schedule } from "./types";

import { AccountsBuilder } from "./resources/accounts/builder";
import { BalancesBuilder } from "./resources/balances/builder";
import { BlocksBuilder } from "./resources/blocks/builder";
import { SchedulesBuilder } from "./resources/schedules/builder";
import { TokensBuilder } from "./resources/tokens/builder";
import { TopicsBuilder } from "./resources/topics/builder";
import { TransactionsBuilder } from "./resources/transactions/builder";
import { ContractsBuilder } from "./resources/contracts/builder";
import { NetworkBuilder } from "./resources/network/builder";
import type {
	AccountsResource,
	BalancesResource,
	BlocksResource,
	ContractsResource,
	NetworkResource,
	PageLimits,
	SchedulesResource,
	TokensResource,
	TopicsResource,
	TransactionsResource,
} from "./public";

const CLIENT_CONFIG_KEYS = new Set([
	"provider",
	"switchProviderWhenOverflow",
	"switchProviderOnFailure",
	"cache",
	"log",
	"defaultProvider",
	"defaultNetwork",
]);

/**
 * Resolve whether caching is enabled for a specific resource.
 *
 * The global setting is the master switch. When it is enabled, an explicit
 * per-resource `false` can opt that resource out; otherwise it inherits the
 * enabled global policy.
 */
function resolveResourceCacheEnabled(cache: CacheConfig | undefined, key: keyof NonNullable<CacheConfig["resources"]>, globalEnabled: boolean): boolean {
	if (!globalEnabled) return false;
	const per = cache?.resources?.[key] as ResourceCacheConfig | undefined;
	return per?.isEnabled !== false;
}

/**
 * Resolve the effective TTL (seconds) for a *resource‑level* cache entry.
 *
 * Resolution order:
 * 1) If a per‑resource override exists (e.g. `cache.resources.tokens.duration`) use it.
 * 2) Else, if a global cache duration is set (`cache.duration`), use that.
 * 3) Else, fall back to `fallback`.
 *
 * This function does not perform any I/O; it only reads the config object.
 *
 * @param cache     The optional cache configuration provided to the client.
 * @param key       The resource key within `cache.resources` (e.g. `"tokens"`, `"contracts"`).
 * @param fallback  A hard fallback (in seconds) used when no config is present.
 * @returns The TTL (in seconds) to apply for the resource’s cached responses.
 */
function resolveResourceTtl(cache: CacheConfig | undefined, key: keyof NonNullable<CacheConfig["resources"]>, fallback: number): number {
	const globalTtl = cache?.duration ?? fallback;
	const per = cache?.resources?.[key] as ResourceCacheConfig | undefined;
	return per?.duration ?? globalTtl;
}

/**
 * A fluent, *lightweight* view of the client that remembers optional
 * provider/network overrides and exposes resource builders bound to that scope.
 *
 * You obtain a `ScopedClient` by calling {@link HederaRestClient.useProvider}
 * and/or {@link HederaRestClient.useNetwork}. You can chain these in any order:
 *
 * ```ts
 * const scoped = client
 *   .useProvider("public")
 *   .useNetwork("mainnet");
 *
 * const tokens = await scoped.tokens().list({ limit: 5 }).get();
 * ```
 */
export type ScopedClient = {
	/**
	 * Return a new scoped view bound to the specified provider.
	 * The previous scoping (including network) is preserved.
	 *
	 * @example
	 * ```ts
	 * client.useNetwork("testnet").useProvider("public").accounts();
	 * ```
	 */
	useProvider(provider: string): ScopedClient;

	/**
	 * Return a new scoped view bound to the specified network.
	 * The previous scoping (including provider) is preserved.
	 *
	 * @example
	 * ```ts
	 * client.useProvider("arkhia").useNetwork("mainnet").transactions();
	 * ```
	 */
	useNetwork(network: string): ScopedClient;

	/**
	 * Return the provider/network‑specific default and max page limits
	 * as currently resolved by the registry for this scope.
	 *
	 * Useful for building UIs that want to present safe pagination defaults.
	 */
	limits(): PageLimits;

	/** Hedera Accounts resource builder (bound to this scope). */
	accounts(): AccountsResource;

	/** Hedera Balances resource builder (bound to this scope). */
	balances(): BalancesResource;

	/** Hedera Blocks resource builder (bound to this scope). */
	blocks(): BlocksResource;

	/** Hedera Schedules resource builder (bound to this scope). */
	schedules(): SchedulesResource;

	/** Hedera Tokens resource builder (bound to this scope). */
	tokens(): TokensResource;

	/** Hedera Topics resource builder (bound to this scope). */
	topics(): TopicsResource;

	/** Hedera Transactions resource builder (bound to this scope). */
	transactions(): TransactionsResource;

	/** Hedera Contracts resource builder (bound to this scope). */
	contracts(): ContractsResource;

	/**
	 * Hedera Network resource builder (bound to this scope).
	 * Note: this produces the **network API** builder; it does not change scoping.
	 */
	network(): NetworkResource;
};

/**
 * # HederaRestClient
 *
 * Central entry point for the SDK. It wires together:
 * - internal provider routing, failover, logging, and per-network limits,
 * - a global cache adapter (optional; for selected endpoints),
 * - and typed **resource builders** (accounts, tokens, contracts, …).
 *
 * ## Key ideas
 * - **Fluent scoping**: `useProvider()` / `useNetwork()` return a *scoped* view that you can chain,
 *   so you can do `client.useProvider('public').useNetwork('testnet').tokens().one(...).get()`.
 * - **Two query styles**: Each resource supports both a **legacy object** and a **typed DSL**:
 *   ```ts
 *   // Legacy object
 *   await client.tokens().list({ limit: 10, order: "desc" }).get();
 *
 *   // Typed DSL
 *   await client.tokens().list(q => q.limit(10).order("desc")).get();
 *   ```
 * - **Selective caching**: Successful fresh responses from supported endpoints are
 *   stored when caching is enabled; `useCache` explicitly allows a cached read.
 *
 * ## Thread‑safety & reuse
 * - The client is designed to be instantiated **once** and reused. Resource builders
 *   created from it are cheap and stateless (except for per‑builder scoping you apply).
 * - Builders produced by `useProvider`/`useNetwork` are independent of each other.
 */
export class HederaRestClient {
	private registry: ProviderRegistry;
	private logger: Logger;
	private cacheEnabled: boolean;
	private cacheAdapter: CacheAdapter<unknown>;

	/**
	 * Normalized configuration that the client will use internally.
	 * This includes defaults for provider/network, logging, failover, and cache.
	 */
	private cfg: Required<Omit<HederaRestClientConfig, "provider">> & { provider: any };

	/**
	 * Create a client instance.
	 *
	 * @param cfg Configuration for defaults (provider/network), logging, failover,
	 *            and caching. Any omitted values are filled with safe defaults:
	 *            - `defaultProvider`: `"public"`
	 *            - `defaultNetwork`: `"testnet"`
	 *            - `log`: `false`
	 *            - `switchProviderWhenOverflow`: `false`
	 *            - `switchProviderOnFailure`: `false`
	 *            - `cache`: `{ isEnabled: false, duration: 600 }`
	 *
	 * @example Basic usage
	 * ```ts
	 * const client = new HederaRestClient({
	 *   defaultProvider: "public",
	 *   defaultNetwork: "testnet",
	 *   log: true,
	 *   cache: { isEnabled: true, duration: 300 } // 5 minutes
	 * });
	 *
	 * const page = await client
	 *   .tokens()
	 *   .list(q => q.limit(5).order("desc"))
	 *   .get();
	 * ```
	 */
	constructor(cfg: HederaRestClientConfig) {
		let isPlainConfig = false;
		if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
			try {
				const prototype = Object.getPrototypeOf(cfg);
				isPlainConfig = prototype === Object.prototype || prototype === null;
			} catch {
				// A proxy that cannot expose its prototype is not a usable config record.
			}
		}
		if (!isPlainConfig) {
			throw new ConfigError("HederaRestClient configuration must be an object");
		}
		for (const key of Reflect.ownKeys(cfg)) {
			if (typeof key !== "string" || !CLIENT_CONFIG_KEYS.has(key)) {
				throw new ConfigError(`config.${String(key)} is not a supported option`);
			}
		}
		for (const key of ["log", "switchProviderWhenOverflow", "switchProviderOnFailure"] as const) {
			const value = cfg[key];
			if (value !== undefined && typeof value !== "boolean") {
				throw new ConfigError(`${key} must be a boolean`);
			}
		}

		const cache = snapshotCacheConfig(cfg.cache);
		const defaulted: HederaRestClientConfig = {
			defaultProvider: cfg.defaultProvider ?? "public",
			defaultNetwork: cfg.defaultNetwork ?? "testnet",
			log: cfg.log ?? false,
			switchProviderWhenOverflow: cfg.switchProviderWhenOverflow ?? false,
			switchProviderOnFailure: cfg.switchProviderOnFailure ?? false,
			cache,
			provider: cfg.provider, // may be undefined (handled in ProviderRegistry)
		};

		this.cfg = defaulted as any;
		this.registry = new ProviderRegistry(defaulted);
		this.logger = this.registry.getLogger();
		this.cacheEnabled = cache.isEnabled;
		this.cacheAdapter = cache.adapter ?? new MemoryCacheAdapter<unknown>();

		this.logger.info("HederaRestClient initialized", {
			defaults: { provider: defaulted.defaultProvider, network: defaulted.defaultNetwork },
		});
	}

	// ------------------------------------------------
	// Fluent scoping: useProvider / useNetwork
	// ------------------------------------------------

	/**
	 * Partially scope subsequent resource calls to a specific **provider**.
	 *
	 * The selected network will remain the default (or whatever was previously
	 * chosen in the scope) until changed via {@link useNetwork}.
	 *
	 * @example
	 * ```ts
	 * const scoped = client.useProvider("public");
	 * const balances = await scoped.balances().list({ limit: 10 }).get();
	 * ```
	 */
	useProvider(provider: string): ScopedClient {
		validateName(provider, "provider");
		return this._scoped(provider, undefined);
	}

	/**
	 * Partially scope subsequent resource calls to a specific **network**.
	 *
	 * The selected provider will remain the default (or whatever was previously
	 * chosen in the scope) until changed via {@link useProvider}.
	 *
	 * @example
	 * ```ts
	 * const scoped = client.useNetwork("mainnet");
	 * const latestBlocks = await scoped.blocks().list({ limit: 5 }).get();
	 * ```
	 */
	useNetwork(network: string): ScopedClient {
		validateName(network, "network");
		return this._scoped(undefined, network);
	}

	/**
	 * Implementation detail for scoping. Returns a **pure** wrapper object
	 * that captures the chosen provider/network and exposes resource factories.
	 *
	 * Notes:
	 * - Re‑invoking `useProvider` or `useNetwork` on the returned object creates
	 *   a *new* scoped view (original is unchanged).
	 * - `limits()` consults the registry with the current scope to expose
	 *   per‑network pagination defaults.
	 */
	private _scoped(provider?: string, network?: string): ScopedClient {
		const self = this;

		const make = (p?: string, n?: string): ScopedClient => ({
			useProvider(p2: string) {
				validateName(p2, "provider");
				return make(p2, n);
			},
			useNetwork(n2: string) {
				validateName(n2, "network");
				return make(p, n2);
			},
			limits() {
				const t = self.registry.resolve(p as any, n as any);
				return { default: t.page.defaultLimit, max: t.page.maxLimit };
			},

			accounts() {
				return self._accounts(p, n);
			},
			balances() {
				return self._balances(p, n);
			},
			blocks() {
				return self._blocks(p, n);
			},
			schedules() {
				return self._schedules(p, n);
			},
			tokens() {
				return self._tokens(p, n);
			},
			topics() {
				return self._topics(p, n);
			},
			transactions() {
				return self._transactions(p, n);
			},
			contracts() {
				return self._contracts(p, n);
			},
			// Network *resource* (builder), not a scoping call:
			network() {
				return self._network(p, n);
			},
		});

		return make(provider, network);
	}

	// ------------------------------------------------
	// Default-scoped resources (use configured defaults)
	// ------------------------------------------------

	/**
	 * Accounts resource builder for the **default** provider/network.
	 * If you need different routing, use {@link useProvider}/{@link useNetwork}.
	 */
	accounts(): AccountsResource {
		return this._accounts(undefined, undefined);
	}
	/** Balances resource builder (default scope). */
	balances(): BalancesResource {
		return this._balances(undefined, undefined);
	}
	/** Blocks resource builder (default scope). */
	blocks(): BlocksResource {
		return this._blocks(undefined, undefined);
	}
	/** Schedules resource builder (default scope). */
	schedules(): SchedulesResource {
		return this._schedules(undefined, undefined);
	}
	/** Tokens resource builder (default scope). */
	tokens(): TokensResource {
		return this._tokens(undefined, undefined);
	}
	/** Topics resource builder (default scope). */
	topics(): TopicsResource {
		return this._topics(undefined, undefined);
	}
	/** Transactions resource builder (default scope). */
	transactions(): TransactionsResource {
		return this._transactions(undefined, undefined);
	}
	/** Contracts resource builder (default scope). */
	contracts(): ContractsResource {
		return this._contracts(undefined, undefined);
	}
	/**
	 * Network resource builder (default scope).
	 * This exposes network‑level endpoints (supply, fees, exchangerate, nodes, stake).
	 */
	network(): NetworkResource {
		return this._network(undefined, undefined);
	}

	/**
	 * Return the default and max page limits for the client’s **current defaults**
	 * (i.e., as defined at construction time or by registry defaults).
	 *
	 * This is equivalent to `client.useProvider(default).useNetwork(default).limits()`.
	 */
	limits(): PageLimits {
		const t = this.registry.resolve(undefined, undefined); // uses defaults
		return { default: t.page.defaultLimit, max: t.page.maxLimit };
	}

	// ------------------------------------------------
	// Resource builder factories (respect scoping & cache)
	// ------------------------------------------------
	// Each factory:
	// - honors the provided scope (provider/network) if any,
	// - wires the appropriate cache policy for endpoints that support `useCache`,
	// - returns a fresh builder instance (builders are lightweight).

	/**
	 * Accounts builder factory.
	 *
	 * Cache policy:
	 * - Successful fresh responses are written when caching is enabled; `useCache`
	 *   controls whether a request may read an existing entry.
	 * - Keys use the network resolved at request time, so changing a builder's
	 *   network cannot read or write another network's entries.
	 */
	private _accounts(provider?: string, network?: string) {
		const ttl = resolveResourceTtl(this.cfg.cache, "accounts", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "accounts", this.cacheEnabled);
		const cache = createNetworkScopedCache<AccountBalanceTransactions>(this.cacheAdapter, { enabled, ttlSeconds: ttl, logger: this.logger });

		return new AccountsBuilder(this.registry, provider as any, network as any, cache);
	}

	/** Balances builder factory (no caching at the builder level). */
	private _balances(provider?: string, network?: string) {
		return new BalancesBuilder(this.registry, provider as any, network as any);
	}

	/**
	 * Blocks builder factory.
	 *
	 * Cache policy:
	 * - Successful fresh block responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _blocks(provider?: string, network?: string) {
		const ttl = resolveResourceTtl(this.cfg.cache, "blocks", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "blocks", this.cacheEnabled);
		const cache = createNetworkScopedCache<Block>(this.cacheAdapter, { enabled, ttlSeconds: ttl, logger: this.logger });

		return new BlocksBuilder(this.registry, provider as any, network as any, cache);
	}

	/**
	 * Schedules builder factory.
	 *
	 * Cache policy:
	 * - Successful fresh schedule responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _schedules(provider?: string, network?: string) {
		const ttl = resolveResourceTtl(this.cfg.cache, "schedules", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "schedules", this.cacheEnabled);
		const cache = createNetworkScopedCache<Schedule>(this.cacheAdapter, { enabled, ttlSeconds: ttl, logger: this.logger });

		return new SchedulesBuilder(this.registry, provider as any, network as any, cache);
	}

	/**
	 * Tokens builder factory.
	 *
	 * Cache policy:
	 * - Maintains **separate** caches for token metadata (`token`) and NFT item details (`nft`).
	 * - Both caches are independently configurable via `cache.resources.tokens` / `cache.resources.nfts`.
	 * - Successful fresh responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _tokens(provider?: string, network?: string) {
		const tokenTtl = resolveResourceTtl(this.cfg.cache, "tokens", this.cfg.cache?.duration ?? 600);
		const nftTtl = resolveResourceTtl(this.cfg.cache, "nfts", this.cfg.cache?.duration ?? 600);
		const tokenEnabled = resolveResourceCacheEnabled(this.cfg.cache, "tokens", this.cacheEnabled);
		const nftEnabled = resolveResourceCacheEnabled(this.cfg.cache, "nfts", this.cacheEnabled);

		return new TokensBuilder(this.registry, provider as any, network as any, {
			token: createNetworkScopedCache(this.cacheAdapter, { enabled: tokenEnabled, ttlSeconds: tokenTtl, logger: this.logger }),
			nft: createNetworkScopedCache(this.cacheAdapter, { enabled: nftEnabled, ttlSeconds: nftTtl, logger: this.logger }),
		});
	}

	/**
	 * Topics builder factory.
	 *
	 * Cache policy:
	 * - Maintains a single TTL for both topic metadata and individual messages.
	 * - Successful fresh responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped by network, but deliberately shared across providers.
	 */
	private _topics(provider?: string, network?: string) {
		const topicsTtl = resolveResourceTtl(this.cfg.cache, "topics", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "topics", this.cacheEnabled);

		return new TopicsBuilder(this.registry, provider as any, network as any, {
			topic: createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: topicsTtl, logger: this.logger }),
			message: createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: topicsTtl, logger: this.logger }),
		});
	}

	/**
	 * Transactions builder factory.
	 *
	 * Cache policy:
	 * - Separate caches for `byId` (a transaction by ID).
	 * - Successful fresh responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _transactions(provider?: string, network?: string) {
		const txTtl = resolveResourceTtl(this.cfg.cache, "transactions", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "transactions", this.cacheEnabled);

		return new TransactionsBuilder(this.registry, provider as any, network as any, {
			one: createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: txTtl, logger: this.logger }),
		});
	}

	/**
	 * Contracts builder factory.
	 *
	 * Cache policy:
	 * - Separate caches for `one` (contract metadata) and `result` (execution result by tx/timestamp).
	 * - Successful fresh responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _contracts(provider?: string, network?: string) {
		const ttl = resolveResourceTtl(this.cfg.cache, "contracts", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "contracts", this.cacheEnabled);

		return new ContractsBuilder(this.registry, provider as any, network as any, {
			one: createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: ttl, logger: this.logger }),
			result: createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: ttl, logger: this.logger }),
		});
	}

	/**
	 * Network builder factory.
	 *
	 * Cache policy:
	 * - A single TTL is used for network‑level endpoints (supply, exchangerate, stake).
	 * - Successful fresh responses are stored when enabled; `useCache` permits reads.
	 * - Keys are scoped with the network resolved when the request executes.
	 */
	private _network(provider?: string, network?: string) {
		const netTtl = resolveResourceTtl(this.cfg.cache, "network", this.cfg.cache?.duration ?? 600);
		const enabled = resolveResourceCacheEnabled(this.cfg.cache, "network", this.cacheEnabled);
		const cache = createNetworkScopedCache(this.cacheAdapter, { enabled, ttlSeconds: netTtl, logger: this.logger });

		return new NetworkBuilder(this.registry, provider as any, network as any, cache);
	}
}
