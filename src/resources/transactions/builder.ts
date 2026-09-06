// src/resources/transactions/builder.ts

import type { TransactionsListQuery, TransactionByIdQuery, TransactionsResponse, TransactionByIdResponse, TransactionsPage, RequestOptions } from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import { TransactionByIdQueryBuilder, TransactionsListQueryBuilder } from "../../dsl/transactions";

import { TransactionsMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * TransactionsBuilder
 * -------------------
 * High‑level client for **Transactions** endpoints. Responsibilities:
 *
 * - Accepts queries in **two styles**:
 *   1) **Object style**: plain `{ ... }` typed objects.
 *   2) **DSL style**: `(q) => { q.accountId().ne('0.0.2').limit(10) }`.
 * - Delegates **validation + REST parameter shaping** to {@link TransactionsMapper}.
 * - Resolves symbolic `limit` values per target network via {@link resolveLimitValue}.
 * - Performs HTTP using a shared {@link ProviderRegistry}, with optional **failover**.
 * - Wraps list responses with {@link wrapPaged} to expose paging helpers (e.g., `next()`).
 * - Supports explicit cached reads and write-through storage for single-item responses.
 *
 * Constructor caching options
 * ---------------------------
 * - `one`: cache for `/transactions/{id}` responses.
 *
 * Each cache is a `NetworkScopedCache`: `get` and `set` receive the resolved
 * network before the logical key, plus the resource's enabled state and TTL.
 *
 * Usage examples
 * --------------
 * ```ts
 * // 1) List (object style)
 * const page = await transactions.list({
 *   accountId: "gte:0.0.1000",
 *   result: "success",
 *   order: "asc",
 *   limit: 25
 * }).get();
 *
 * // 2) List (DSL style)
 * const page2 = await transactions.list(q =>
 *   q.accountId().greaterThanOrEqualTo("0.0.1000")
 *    .result("success")
 *    .order("asc")
 *    .limit(25)
 * ).get();
 *
 * // 3) ById (object style)
 * const tx = await transactions.byId({
 *   transactionId: "0.0.1000-1700000000-000000000",
 *   nonce: 1,
 *   scheduled: false,
 *   useCache: true
 * }).get();
 *
 * // 4) ById (DSL style)
 * const tx2 = await transactions.byId(q =>
 *   q.transactionId("0.0.1000-1700000000-000000000").nonce(1).scheduled(false).useCache(true)
 * ).get();
 * ```
 */
export class TransactionsBuilder extends ResourceBuilder<TransactionsBuilder> {
	/**
	 * @param registry Shared {@link ProviderRegistry} used to issue HTTP requests and handle failover.
	 * @param provider Optional provider override for this builder instance.
	 * @param network  Optional network override for this builder instance.
	 * @param caches   Optional caches:
	 *  - `one`: cache for single transaction responses.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private caches?: {
			one?: NetworkScopedCache<TransactionByIdResponse>;
		}
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * **GET `/api/v1/transactions`** — list transactions (paged; not cached).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TransactionsListQuery}
	 * - DSL: `(q: TransactionsListQueryBuilder) => void | TransactionsListQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and maps via {@link TransactionsMapper.list}.
	 * - Resolves symbolic `limit` per network using {@link resolveLimitValue}.
	 * - Returns a paged result (`TransactionsPage`) via {@link wrapPaged}.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TransactionsPage}.
	 */
	list(query?: TransactionsListQuery | ((q: TransactionsListQueryBuilder) => void | TransactionsListQueryBuilder)) {
		// Normalize to object form (either from DSL or as-is)
		let qobj: TransactionsListQuery | undefined = undefined;
		if (typeof query === "function") {
			const b = new TransactionsListQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TransactionsListQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const params = TransactionsMapper.list(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TransactionsPage> {
				const target = self.resolve();
				const path = "/api/v1/transactions";

				// Limit resolution (e.g., "max" → numeric per network policy)
				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TransactionsResponse>(routed.response);
				return wrapPaged<TransactionsPage, TransactionsResponse>(self.registry, routed, raw, (r) => ({
					transactions: r.transactions ?? [],
				}));
			},
		};
	}

	/**
	 * **GET `/api/v1/transactions/{transactionId}`** — fetch transactions by ID or 48-byte hash (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TransactionByIdQuery}
	 * - DSL: `(q: TransactionByIdQueryBuilder) => void | TransactionByIdQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and maps via {@link TransactionsMapper.byId}, which also supplies a stable `cacheKey`.
	 * - `useCache` allows a lookup; every successful fresh response is stored when caching is enabled.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TransactionByIdResponse}.
	 */
	byId(query: TransactionByIdQuery | ((q: TransactionByIdQueryBuilder) => void | TransactionByIdQueryBuilder)) {
		// Normalize to object form (either from DSL or as-is)
		let qobj: TransactionByIdQuery;
		if (typeof query === "function") {
			const b = new TransactionByIdQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TransactionByIdQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, params, cacheKey } = TransactionsMapper.byId(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TransactionByIdResponse> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/transactions/${encodeURIComponent(id)}`;

				// Cached reads are explicit; successful fresh responses are always written when enabled.
				if (useCache && self.caches?.one?.enabled) {
					const hit = await self.caches.one.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<TransactionByIdResponse>(res);
					if (self.caches?.one?.enabled) {
						await self.caches.one.set(target.network, cacheKey, data, self.caches.one.ttlSeconds);
					}
					return data;
				} catch (e: any) {
					// 404 → empty array (registry.get() already handles failover if enabled)
					if (e instanceof HttpError && e.status === 404) {
						return { transactions: [] };
					}
					throw e;
				}
			},
		};
	}
}
