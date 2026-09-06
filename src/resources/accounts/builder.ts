// src/resources/accounts/builder.ts

import type {
	AccountsListQuery,
	AccountOneQuery,
	AccountHooksQuery,
	AccountHookStorageQuery,
	AccountsResponse,
	AccountInfo,
	AccountBalanceTransactions,
	AccountBalanceTransactionsPage,
	HooksResponse,
	HooksStorageResponse,
	AccountCryptoAllowancesQuery,
	AccountTokenAllowancesQuery,
	AccountNftAllowancesQuery,
	AccountTokensQuery,
	AccountRewardsQuery,
	AccountOutstandingAirdropsQuery,
	AccountPendingAirdropsQuery,
	CryptoAllowancesResponse,
	TokenAllowancesResponse,
	NftAllowancesResponse,
	TokenRelationshipResponse,
	StakingRewardsResponse,
	TokenAirdropsResponse,
	AccountNftsOwnedQuery,
	Nfts,
	AccountsPage,
	AccountHooksPage,
	AccountHookStoragePage,
	CryptoAllowancesPage,
	TokenAllowancesPage,
	NFTAllowancesPage,
	AccountTokensPage,
	AccountNFTsPage,
	AccountRewardsPage,
	AccountAirdropsPage,
	LimitValue,
	RequestOptions,
} from "../../types";
import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged, type PageRequestContext } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit, resolveLimitValue } from "../../core/limits";
import { buildQuery } from "../../core/utils";
import { resolveMirrorNodeUrl } from "../../core/url";
import type { NetworkScopedCache } from "../../core/network-cache";
import { requestOptionArgs } from "../../core/request-options";
import {
	AccountCryptoAllowancesDSL,
	AccountCryptoAllowancesInit,
	AccountNftAllowancesDSL,
	AccountNftAllowancesInit,
	AccountNftsOwnedDSL,
	AccountNftsOwnedInit,
	AccountHooksDSL,
	AccountHooksInit,
	AccountHookStorageDSL,
	AccountHookStorageInit,
	AccountOneInit,
	AccountOneQueryDSL,
	AccountOutstandingAirdropsDSL,
	AccountOutstandingAirdropsInit,
	AccountPendingAirdropsDSL,
	AccountPendingAirdropsInit,
	AccountRewardsDSL,
	AccountRewardsInit,
	AccountsListInit,
	AccountsListQueryDSL,
	AccountTokenAllowancesDSL,
	AccountTokenAllowancesInit,
	AccountTokensDSL,
	AccountTokensInit,
} from "../../dsl/accounts";
import { AccountsMapper } from "./mapper";

/**
 * AccountsBuilder
 * ===============
 * Fluent entry point for /api/v1/accounts endpoints.
 *
 * This builder supports **two calling styles** for every method:
 *
 * - **Object form** — Pass a plain `*Query` object. It will be validated and
 *   normalized by the corresponding `AccountsMapper.*` function.
 * - **DSL form** — Pass a function that receives a fluent DSL instance and
 *   configures it (e.g. `(q) => q.limit('default').order('desc')`). The builder
 *   converts the DSL to the same normalized shape the mapper would produce.
 *
 * All list methods return an object with an async `get()` function. The result
 * for list endpoints is wrapped with {@link wrapPaged}, which:
 *
 * - Returns a page containing the relevant array (e.g. `accounts`, `tokens`…)
 * - Adds a `next()` function to fetch the next page (or `null` if exhausted)
 * - Exposes `next.url()` so you can inspect the absolute “next” URL
 *
 * Caching
 * -------
 * Some endpoints can be cached depending on your client configuration:
 * - When a per-resource cache is **enabled**, every successful fresh response is
 *   stored with the configured TTL. Setting `useCache: true` additionally allows
 *   a lookup before issuing the request.
 *
 * Failover
 * --------
 * If failover is enabled on the {@link ProviderRegistry}, HTTP errors are
 * retried across providers of the same network according to the registry
 * policy. `404 Not Found` is treated as a terminal result for *single* lookups
 * and is returned as `null` where applicable.
 *
 * Limit resolution
 * ----------------
 * Methods accept a `limit` value as a number or `"default" | "max"`. The
 * resolved numeric value is clamped to the provider/network maximum by
 * {@link resolveLimitValue} just before the request is performed.
 */
export class AccountsBuilder extends ResourceBuilder<AccountsBuilder> {
	/**
	 * @param registry Provider registry used to resolve base URLs, retry/limiters, and failover.
	 * @param provider Optional provider name override for this builder instance.
	 * @param network Optional network name override for this builder instance.
	 * @param cache Optional cache hooks for endpoints that support caching.
	 *        Keys are automatically namespaced by the network resolved at request time.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private cache?: NetworkScopedCache<AccountBalanceTransactions>
	) {
		super(registry, provider as any, network as any);
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts
	// ---------------------------------------------------------------------

	/**
	 * List accounts.
	 *
	 * **Object form**
	 * ```ts
	 * client.accounts().list({ order: "desc", limit: "default" }).get();
	 * ```
	 *
	 * **DSL form**
	 * ```ts
	 * client.accounts().list(q => q.order("desc").limit("default")).get();
	 * ```
	 *
	 * @param query Either an `AccountsListQuery` object or a DSL initializer.
	 * @returns An object exposing `get(): Promise<AccountsPage>`.
	 */
	list(query?: AccountsListQuery | AccountsListInit) {
		// Support both the legacy object and the new fluent DSL callback
		let params: Record<string, any> = {};
		let requestedLimit: LimitValue | undefined = undefined;

		if (typeof query === "function") {
			const dsl = new AccountsListQueryDSL();
			const ret = query(dsl);
			const built = (ret instanceof AccountsListQueryDSL ? ret : dsl)._build();
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			params = AccountsMapper.list(query);
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			/**
			 * Execute the request and return a paged result.
			 *
			 * The returned page contains:
			 * - `accounts: AccountInfo[]`
			 * - `next(): Promise<AccountsPage | null>`
			 * - `next.url(): string | null`
			 */
			async get(options: RequestOptions = {}): Promise<AccountsPage> {
				const target = self.resolve();
				const path = "/api/v1/accounts";

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<AccountsResponse>(routed.response);
				return wrapPaged<AccountsPage, AccountsResponse>(self.registry, routed, raw, (r) => ({ accounts: r.accounts }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{idOrAliasOrEvmAddress}
	// ---------------------------------------------------------------------

	/**
	 * Fetch a single account by **EntityId**, **alias**, or **EVM address**.
	 *
	 * **Object form**
	 * ```ts
	 * client.accounts().one({ idOrAliasOrEvmAddress: "0.0.1001", useCache: true }).get();
	 * ```
	 *
	 * **DSL form**
	 * ```ts
	 * client.accounts().one(q =>
	 *   q.idOrAliasOrEvmAddress("0.0.1001").useCache(true)
	 * ).get();
	 * ```
	 *
	 * @returns `{ get(): Promise<AccountBalanceTransactionsPage | null> }` — returns `null` for 404.
	 */
	one(query: AccountOneQuery | AccountOneInit) {
		let id: string,
			params: Record<string, any>,
			cacheKey: string,
			requestedLimit: LimitValue | undefined,
			useCache = false;
		if (typeof query === "function") {
			const dsl = new AccountOneQueryDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			cacheKey = built.cacheKey;
			requestedLimit = built.requestedLimit;
			useCache = built.useCache;
		} else {
			const mapped = AccountsMapper.one(query);
			id = mapped.id;
			params = mapped.query;
			cacheKey = mapped.cacheKey;
			requestedLimit = query?.limit;
			useCache = query.useCache ?? false;
		}
		const self = this;
		return {
			/**
			 * Execute the request.
			 *
			 * Reads cache only when caching is enabled and `useCache` is set.
			 * Successful fresh responses are written whenever caching is enabled.
			 * For convenience, `404` responses are returned as `null`.
			 */
			async get(options: RequestOptions = {}): Promise<AccountBalanceTransactionsPage | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}`;
				const requestParams = { ...params };
				prepareQueryLimit(target, requestParams, requestedLimit);

				const eff = resolveLimitValue(target, requestedLimit);
				const initialCacheParams = { ...requestParams };
				if (eff !== undefined) initialCacheParams["limit"] = eff;
				// The cache identity must describe the actual HTTP request. Symbolic or
				// clamped limits can resolve differently across providers on one network.
				const effectiveCacheKey = requestedLimit === undefined ? cacheKey : `accounts:${id}:${JSON.stringify(initialCacheParams)}`;
				const requestUrl = resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(initialCacheParams));
				const toPage = (raw: AccountBalanceTransactions, context: PageRequestContext) =>
					wrapPaged<AccountBalanceTransactionsPage, AccountBalanceTransactions>(self.registry, context, raw, (account) => ({ ...account }));

				// useCache controls reads; enabled caching writes every successful fresh response.
				if (useCache && self.cache?.enabled) {
					const hit = await self.cache.get(target.network, effectiveCacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", effectiveCacheKey);
						return toPage(hit, { target, requestUrl });
					}
				}

				try {
					const routed = await self.registry.getWithTarget(target, path, requestParams, ...requestArgs);
					const data = await readJsonResponse<AccountBalanceTransactions>(routed.response);

					if (self.cache?.enabled) {
						const routedCacheParams = { ...requestParams };
						const routedLimit = resolveLimitValue(routed.target, requestedLimit);
						if (routedLimit !== undefined) routedCacheParams["limit"] = routedLimit;
						const routedCacheKey = requestedLimit === undefined ? cacheKey : `accounts:${id}:${JSON.stringify(routedCacheParams)}`;
						await self.cache.set(routed.target.network, routedCacheKey, data, self.cache.ttlSeconds);
					}
					return toPage(data, routed);
				} catch (e: any) {
					// 404 => return null (getWithTarget() already handles failover if enabled)
					if (e instanceof HttpError && e.status === 404) {
						return null;
					}
					throw e;
				}
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks
	// ---------------------------------------------------------------------

	/** List hooks owned by an account. */
	hooks(query: AccountHooksQuery | AccountHooksInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountHooksDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.hooks(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query.limit;
		}

		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountHooksPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/hooks`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<HooksResponse>(routed.response);
				return wrapPaged<AccountHooksPage, HooksResponse>(self.registry, routed, raw, (response) => ({ hooks: response.hooks }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks/{hookId}/storage
	// ---------------------------------------------------------------------

	/** List current or historical storage slots for an account hook. */
	hookStorage(query: AccountHookStorageQuery | AccountHookStorageInit) {
		let id: string, hookId: number | string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountHookStorageDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			hookId = built.hookId;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.hookStorage(query);
			id = mapped.id;
			hookId = mapped.hookId;
			params = mapped.params;
			requestedLimit = query.limit;
		}

		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountHookStoragePage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/hooks/${encodeURIComponent(String(hookId))}/storage`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<HooksStorageResponse>(routed.response);
				return wrapPaged<AccountHookStoragePage, HooksStorageResponse>(self.registry, routed, raw, (response) => ({
					hook_id: response.hook_id,
					owner_id: response.owner_id,
					storage: response.storage,
				}));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{id}/allowances/crypto
	// ---------------------------------------------------------------------

	/**
	 * List HBAR (crypto) allowances for an account.
	 *
	 * @returns `{ get(): Promise<CryptoAllowancesPage> }` — paged result with `allowances[]`.
	 */
	hbarAllowances(query: AccountCryptoAllowancesQuery | AccountCryptoAllowancesInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountCryptoAllowancesDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.cryptoAllowances(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<CryptoAllowancesPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/allowances/crypto`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<CryptoAllowancesResponse>(routed.response);
				return wrapPaged<CryptoAllowancesPage, CryptoAllowancesResponse>(self.registry, routed, raw, (r) => ({ allowances: r.allowances ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{accountId}/allowances/tokens
	// ---------------------------------------------------------------------

	/**
	 * List **token** allowances for an account.
	 *
	 * @returns `{ get(): Promise<TokenAllowancesPage> }` — paged result with `allowances[]`.
	 */
	tokenAllowances(query: AccountTokenAllowancesQuery | AccountTokenAllowancesInit) {
		let pathId: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountTokenAllowancesDSL();
			const built = (query(dsl) ?? dsl)._build();
			pathId = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.tokenAllowances(query);
			pathId = mapped.pathId;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<TokenAllowancesPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(pathId)}/allowances/tokens`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TokenAllowancesResponse>(routed.response);
				return wrapPaged<TokenAllowancesPage, TokenAllowancesResponse>(self.registry, routed, raw, (r) => ({ allowances: r.allowances ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{accountId}/allowances/nfts
	// ---------------------------------------------------------------------

	/**
	 * List **NFT** allowances for an account.
	 *
	 * @returns `{ get(): Promise<NFTAllowancesPage> }` — paged result with `allowances[]`.
	 */
	nftAllowances(query: AccountNftAllowancesQuery | AccountNftAllowancesInit) {
		let pathId: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountNftAllowancesDSL();
			const built = (query(dsl) ?? dsl)._build();
			pathId = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.nftAllowances(query);
			pathId = mapped.pathId;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NFTAllowancesPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(pathId)}/allowances/nfts`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<NftAllowancesResponse>(routed.response);
				return wrapPaged<NFTAllowancesPage, NftAllowancesResponse>(self.registry, routed, raw, (r) => ({ allowances: r.allowances ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{id}/tokens
	// ---------------------------------------------------------------------

	/**
	 * List token relationships for an account.
	 *
	 * @returns `{ get(): Promise<AccountTokensPage> }` — paged result with `tokens[]`.
	 */
	tokens(query: AccountTokensQuery | AccountTokensInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountTokensDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.accountTokens(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountTokensPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/tokens`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TokenRelationshipResponse>(routed.response);
				return wrapPaged<AccountTokensPage, TokenRelationshipResponse>(self.registry, routed, raw, (r) => ({ tokens: r.tokens ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{idOrAliasOrEvmAddress}/nfts
	// ---------------------------------------------------------------------

	/**
	 * List NFTs owned by an account.
	 *
	 * @returns `{ get(): Promise<AccountNFTsPage> }` — paged result with `nfts[]`.
	 */
	nfts(query: AccountNftsOwnedQuery | AccountNftsOwnedInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountNftsOwnedDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.accountNftsOwned(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountNFTsPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/nfts`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<Nfts>(routed.response);
				return wrapPaged<AccountNFTsPage, Nfts>(self.registry, routed, raw, (r) => ({ nfts: r.nfts ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{id}/rewards
	// ---------------------------------------------------------------------

	/**
	 * List staking rewards for an account.
	 *
	 * @returns `{ get(): Promise<AccountRewardsPage> }` — paged result with `rewards[]`.
	 */
	rewards(query: AccountRewardsQuery | AccountRewardsInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountRewardsDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.rewards(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountRewardsPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/rewards`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<StakingRewardsResponse>(routed.response);
				return wrapPaged<AccountRewardsPage, StakingRewardsResponse>(self.registry, routed, raw, (r) => ({ rewards: r.rewards ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{id}/airdrops/outstanding
	// ---------------------------------------------------------------------

	/**
	 * List **outstanding** token airdrops for an account.
	 *
	 * @returns `{ get(): Promise<AccountAirdropsPage> }` — paged result with `airdrops[]`.
	 */
	outstandingAirdrops(query: AccountOutstandingAirdropsQuery | AccountOutstandingAirdropsInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountOutstandingAirdropsDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.outstandingAirdrops(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountAirdropsPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/airdrops/outstanding`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TokenAirdropsResponse>(routed.response);
				return wrapPaged<AccountAirdropsPage, TokenAirdropsResponse>(self.registry, routed, raw, (r) => ({ airdrops: r.airdrops ?? [] }));
			},
		};
	}

	// ---------------------------------------------------------------------
	// GET /api/v1/accounts/{id}/airdrops/pending
	// ---------------------------------------------------------------------

	/**
	 * List **pending** token airdrops for an account.
	 *
	 * @returns `{ get(): Promise<AccountAirdropsPage> }` — paged result with `airdrops[]`.
	 */
	pendingAirdrops(query: AccountPendingAirdropsQuery | AccountPendingAirdropsInit) {
		let id: string, params: Record<string, any>, requestedLimit: LimitValue | undefined;
		if (typeof query === "function") {
			const dsl = new AccountPendingAirdropsDSL();
			const built = (query(dsl) ?? dsl)._build();
			id = built.id;
			params = built.params;
			requestedLimit = built.requestedLimit;
		} else {
			const mapped = AccountsMapper.pendingAirdrops(query);
			id = mapped.id;
			params = mapped.params;
			requestedLimit = query?.limit;
		}
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<AccountAirdropsPage> {
				const target = self.resolve();
				const path = `/api/v1/accounts/${encodeURIComponent(id)}/airdrops/pending`;

				prepareQueryLimit(target, params, requestedLimit);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TokenAirdropsResponse>(routed.response);
				return wrapPaged<AccountAirdropsPage, TokenAirdropsResponse>(self.registry, routed, raw, (r) => ({ airdrops: r.airdrops ?? [] }));
			},
		};
	}
}
