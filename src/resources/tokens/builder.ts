// src/resources/tokens/builder.ts

import type {
	TokensListQuery,
	TokenOneQuery,
	TokenBalancesQuery,
	TokenNftsListQuery,
	TokenNftOneQuery,
	TokenNftTransactionsQuery,
	TokensResponse,
	TokenInfo,
	TokenBalancesResponse,
	Nfts,
	Nft,
	NftTransactionHistory,
	NetworkName,
	TokensPage,
	TokenNftsPage,
	NftTransactionsPage,
	TokenBalancesPage,
	RequestOptions,
} from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import { TokenBalancesQueryBuilder, TokenNftOneQueryBuilder, TokenNftsListQueryBuilder, TokenNftTransactionsQueryBuilder, TokenOneQueryBuilder, TokensListQueryBuilder } from "../../dsl/tokens";

import { TokensMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * High‑level client for the **Tokens** resource family.
 *
 * What this class does
 * --------------------
 * - Accepts queries in **two styles**:
 *   1) Plain object (`TokensListQuery`, etc.), or
 *   2) **DSL builder** callbacks (typed, fluent).
 * - Delegates **all** validation and query‑param shaping to {@link TokensMapper}.
 * - Resolves `"default" | "max"` limits per network via {@link resolveLimitValue}.
 * - Performs HTTP via the shared {@link ProviderRegistry}, respecting retry and
 *   failover settings, and wraps list responses with {@link wrapPaged}.
 * - Supports explicit cached reads and write-through storage for token and NFT items.
 *
 * What it does **not** do
 * -----------------------
 * - It never mutates the mapper logic.
 * - It does not hold global state beyond constructor‑provided caches.
 *
 * Typical usage
 * -------------
 * ```ts
 * // 1) List tokens (object style)
 * const page = await client.tokens().list({
 *   name: "HBAR",
 *   order: "desc",
 *   limit: 25
 * }).get();
 *
 * // 2) List tokens (DSL style)
 * const page2 = await client.tokens().list(q =>
 *   q.type("FUNGIBLE_COMMON").order("desc").limit(10)
 * ).get();
 *
 * // 3) Token info with cache
 * const token = await client.tokens().one(q =>
 *   q.tokenId("0.0.1234").timestamp().lessThanOrEqualTo("1700000000.000000001").useCache(true)
 * ).get();
 * ```
 */
export class TokensBuilder extends ResourceBuilder<TokensBuilder> {
	/**
	 * @param registry Shared {@link ProviderRegistry} provided by the top‑level client.
	 * @param provider Optional provider override (falls back to client default).
	 * @param network  Optional network override (falls back to client default).
	 * @param caches   Optional caches:
	 *  - `token`: used by {@link TokensBuilder.one}.
	 *  - `nft`:   used by {@link TokensBuilder.nft}.
	 *
	 * Each cache must implement `{ get, set, ttlSeconds, enabled }`.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: NetworkName,
		private caches?: {
			token?: NetworkScopedCache<TokenInfo>;
			nft?: NetworkScopedCache<Nft>;
		}
	) {
		super(registry, provider, network);
	}

	/**
	 * **GET `/api/v1/tokens`** — list tokens.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokensListQuery}
	 * - DSL: `(q: TokensListQueryBuilder) => void | TokensListQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Normalizes the query via {@link TokensMapper.list}.
	 * - Resolves `limit` using {@link resolveLimitValue} for the active provider/network.
	 * - Wraps the raw response with {@link wrapPaged} so callers can use `page.next()`.
	 * - If registry failover is enabled, automatically retries on alternate providers.
	 *
	 * @param query Optional object form or DSL initializer.
	 * @returns An object exposing `get()` that resolves to {@link TokensPage}.
	 *
	 * @example
	 * ```ts
	 * const page = await tokens.list({ tokenId: "ne:0.0.2", order: "desc", limit: 10 }).get();
	 * const page2 = await tokens.list(q => q.tokenId().notEqualTo("0.0.2").limit(10)).get();
	 * ```
	 */
	list(query?: TokensListQuery | ((q: TokensListQueryBuilder) => void | TokensListQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokensListQuery | undefined;
		if (typeof query === "function") {
			const b = new TokensListQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokensListQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const params = TokensMapper.list(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TokensPage> {
				const target = self.resolve();
				const path = "/api/v1/tokens";

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<TokensResponse>(routed.response);
			return wrapPaged<TokensPage, TokensResponse>(self.registry, routed, raw, (r) => ({ tokens: r.tokens ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/tokens/{tokenId}`** — single token (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokenOneQuery}
	 * - DSL: `(q: TokenOneQueryBuilder) => void | TokenOneQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and shapes the query with {@link TokensMapper.one}, which also
	 *   returns a stable `cacheKey`.
	 * - `useCache` allows a lookup before the network call. Successful fresh
	 *   responses are stored whenever caching is enabled.
	 * - Returns `null` on HTTP 404.
	 * - Respects registry failover settings.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TokenInfo} or `null`.
	 */
	one(query: TokenOneQuery | ((q: TokenOneQueryBuilder) => void | TokenOneQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokenOneQuery;
		if (typeof query === "function") {
			const b = new TokenOneQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokenOneQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, params, cacheKey } = TokensMapper.one(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TokenInfo | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/tokens/${encodeURIComponent(id)}`;

				if (useCache && self.caches?.token?.enabled) {
					const hit = await self.caches.token.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<TokenInfo>(res);
					if (self.caches?.token?.enabled) {
						await self.caches.token.set(target.network, cacheKey, data, self.caches.token.ttlSeconds);
					}
					return data;
			} catch (e: any) {
				if (e instanceof HttpError && e.status === 404) {
					return null;
				}
				throw e;
			}
			},
		};
	}

	/**
	 * **GET `/api/v1/tokens/{tokenId}/balances`** — token balance snapshots.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokenBalancesQuery}
	 * - DSL: `(q: TokenBalancesQueryBuilder) => void | TokenBalancesQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validated and mapped with {@link TokensMapper.balances}.
	 * - Resolves `limit` according to provider defaults.
	 * - Wraps response to expose `next()` when more pages are available.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TokenBalancesPage}.
	 */
	balances(query: TokenBalancesQuery | ((q: TokenBalancesQueryBuilder) => void | TokenBalancesQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokenBalancesQuery;
		if (typeof query === "function") {
			const b = new TokenBalancesQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokenBalancesQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, params } = TokensMapper.balances(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TokenBalancesPage> {
				const target = self.resolve();
				const path = `/api/v1/tokens/${encodeURIComponent(id)}/balances`;

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<TokenBalancesResponse>(routed.response);
			return wrapPaged<TokenBalancesPage, TokenBalancesResponse>(self.registry, routed, raw, (r) => ({ balances: r.balances ?? [], timestamp: r.timestamp }));
			},
		};
	}

	/**
	 * **GET `/api/v1/tokens/{tokenId}/nfts`** — list NFTs for a token.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokenNftsListQuery}
	 * - DSL: `(q: TokenNftsListQueryBuilder) => void | TokenNftsListQueryBuilder`
	 *
	 * Rules
	 * -----
	 * - `accountId` accepts an EntityId or a standard EntityId comparator.
	 * - `serialNumber` accepts a positive integer or any standard comparator, including `'ne'`.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TokenNftsPage}.
	 */
	nfts(query: TokenNftsListQuery | ((q: TokenNftsListQueryBuilder) => void | TokenNftsListQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokenNftsListQuery;
		if (typeof query === "function") {
			const b = new TokenNftsListQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokenNftsListQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, params } = TokensMapper.nftsList(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TokenNftsPage> {
				const target = self.resolve();
				const path = `/api/v1/tokens/${encodeURIComponent(id)}/nfts`;

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<Nfts>(routed.response);
			return wrapPaged<TokenNftsPage, Nfts>(self.registry, routed, raw, (r) => ({ nfts: r.nfts ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}`** — single NFT (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokenNftOneQuery}
	 * - DSL: `(q: TokenNftOneQueryBuilder) => void | TokenNftOneQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and normalizes via {@link TokensMapper.nftOne}, which returns a
	 *   stable `cacheKey`.
	 * - `useCache` allows a lookup before the network fetch. Successful fresh
	 *   responses are stored whenever caching is enabled.
	 * - Returns `null` on HTTP 404.
	 *
	 * @returns An object exposing `get()` that resolves to {@link Nft} or `null`.
	 */
	nft(query: TokenNftOneQuery | ((q: TokenNftOneQueryBuilder) => void | TokenNftOneQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokenNftOneQuery;
		if (typeof query === "function") {
			const b = new TokenNftOneQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokenNftOneQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, serial, cacheKey } = TokensMapper.nftOne(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<Nft | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/tokens/${encodeURIComponent(id)}/nfts/${encodeURIComponent(serial)}`;

				if (useCache && self.caches?.nft?.enabled) {
					const hit = await self.caches.nft.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, undefined, ...requestArgs);
					const data = await readJsonResponse<Nft>(res);
					if (self.caches?.nft?.enabled) {
						await self.caches.nft.set(target.network, cacheKey, data, self.caches.nft.ttlSeconds);
					}
					return data;
			} catch (e: any) {
				if (e instanceof HttpError && e.status === 404) {
					return null;
				}
				throw e;
			}
			},
		};
	}

	/**
	 * **GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}/transactions`** — NFT transfer history.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TokenNftTransactionsQuery}
	 * - DSL: `(q: TokenNftTransactionsQueryBuilder) => void | TokenNftTransactionsQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and shapes the query with {@link TokensMapper.nftTx}.
	 * - Resolves `limit` according to the provider.
	 * - Wraps the response to expose `next()` when more pages exist.
	 *
	 * @returns An object exposing `get()` that resolves to {@link NftTransactionsPage}.
	 */
	nftTransactions(query: TokenNftTransactionsQuery | ((q: TokenNftTransactionsQueryBuilder) => void | TokenNftTransactionsQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TokenNftTransactionsQuery;
		if (typeof query === "function") {
			const b = new TokenNftTransactionsQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TokenNftTransactionsQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, serial, params } = TokensMapper.nftTx(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<NftTransactionsPage> {
				const target = self.resolve();
				const path = `/api/v1/tokens/${encodeURIComponent(id)}/nfts/${encodeURIComponent(serial)}/transactions`;

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<NftTransactionHistory>(routed.response);
			return wrapPaged<NftTransactionsPage, NftTransactionHistory>(self.registry, routed, raw, (r) => ({ transactions: r.transactions }));
			},
		};
	}
}
