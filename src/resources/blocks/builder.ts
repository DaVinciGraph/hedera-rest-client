// src/resources/blocks/builder.ts

import type { BlocksListQuery, BlocksOneQuery, BlocksResponse, Block, BlocksPage, RequestOptions } from "../../types";
import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";
import { BlocksListQueryBuilder, BlocksOneQueryBuilder } from "../../dsl/blocks";
import { BlocksMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * High‑level, fluent client for the **Blocks** resource.
 *
 * What this builder provides
 * --------------------------
 * - Two authoring styles:
 *   1) **Legacy object** (`BlocksListQuery` / `BlocksOneQuery`)
 *   2) **Type‑safe DSL** (`BlocksListQueryBuilder` / `BlocksOneQueryBuilder`)
 * - **Validation & mapping** via {@link BlocksMapper}.
 * - **Limit resolution** using provider/network settings
 *   (see {@link resolveLimitValue}).
 * - **Paging** for list endpoints via {@link wrapPaged}.
 * - **Failover** and **rate limiting** via {@link ProviderRegistry}.
 * - Explicit cached reads and write-through storage for `one()` when caching is enabled.
 *
 * Typical usage
 * -------------
 * ```ts
 * // List blocks (DSL)
 * const page = await client.blocks().list(q =>
 *   q.blockNumber().greaterThan(100).order("desc").limit(5)
 * ).get();
 *
 * // Follow pagination
 * const next = await page.next();
 *
 * // Fetch a single block (object form)
 * const b = await client.blocks().one({ hashOrNumber: "0xabc...", useCache: true }).get();
 * ```
 */
export class BlocksBuilder extends ResourceBuilder<BlocksBuilder> {
	/**
	 * @param registry Shared registry that provides provider/network resolution,
	 *                 logging, retry policy, and rate limiting.
	 * @param provider Optional provider name to scope this builder (overrides default).
	 * @param network  Optional network name to scope this builder (overrides default).
	 * @param cache    Optional cache contract used by `one()`.
	 *                 Implementations must expose `get`, `set`, `ttlSeconds`, and `enabled`.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private cache?: NetworkScopedCache<Block>
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * Build a **GET `/api/v1/blocks`** request.
	 *
	 * Authoring styles
	 * ----------------
	 * - **Object form**
	 *   ```ts
	 *   .list({ blockNumber: "gt:100", order: "desc", limit: 5 })
	 *   ```
	 * - **DSL form**
	 *   ```ts
	 *   .list(q => q.blockNumber().greaterThan(100).order("desc").limit(5))
	 *   ```
	 *
	 * Result
	 * ------
	 * Returns a tiny executor with a single method:
	 * - `get(): Promise<BlocksPage>` — performs the HTTP request and wraps the
	 *   response into a paged object with `next()` and `next.url()`.
	 *
	 * Limit handling
	 * --------------
	 * The supplied `limit` can be a number or a symbolic value (`"default"`, `"max"`).
	 * The effective numeric limit is computed for the selected provider/network
	 * via {@link resolveLimitValue} and then clamped to `[1, maxLimit]`.
	 *
	 * Failover
	 * --------
	 * If the client was configured with failover, transient errors are retried
	 * on alternate providers transparently. Otherwise, the original error is thrown.
	 *
	 * @param query Legacy object or a function that configures a {@link BlocksListQueryBuilder}.
	 * @returns An object exposing `get(): Promise<BlocksPage>`.
	 */
	list(query?: BlocksListQuery | ((q: BlocksListQueryBuilder) => void | BlocksListQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<BlocksPage> {
				const target = self.resolve();
				const path = "/api/v1/blocks";

				let params: Record<string, any>;

				if (typeof query === "function") {
					const builder = new BlocksListQueryBuilder();
					const ret = query(builder) || builder;
					const built = (ret instanceof BlocksListQueryBuilder ? ret : builder).build();
					params = built.params;
				} else {
					params = BlocksMapper.list(query);
				}

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<BlocksResponse>(routed.response);
			return wrapPaged<BlocksPage, BlocksResponse>(self.registry, routed, raw, (r) => ({ blocks: r.blocks ?? [] }));
			},
		};
	}

	/**
	 * Build a **GET `/api/v1/blocks/{hashOrNumber}`** request.
	 *
	 * Authoring styles
	 * ----------------
	 * - **Object form**
	 *   ```ts
	 *   .one({ hashOrNumber: "0xabc...", useCache: true })
	 *   ```
	 * - **DSL form**
	 *   ```ts
	 *   .one(q => q.hashOrNumber("0xabc...").useCache(true))
	 *   ```
	 *
	 * Behavior
	 * --------
	 * - `useCache: true` allows a cached response to be returned. Successful
	 *   fresh responses are written whenever caching is enabled.
	 * - A `404` from the API resolves to `null`.
	 * - If failover is enabled and the initial request fails (non‑404),
	 *   the builder retries on alternate providers.
	 *
	 * @param query Legacy object or a function that configures a {@link BlocksOneQueryBuilder}.
	 * @returns An object exposing `get(): Promise<Block | null>`.
	 */
	one(query: BlocksOneQuery | ((q: BlocksOneQueryBuilder) => void | BlocksOneQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<Block | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();

				let qobj: BlocksOneQuery;
				if (typeof query === "function") {
					const builder = new BlocksOneQueryBuilder();
					const ret = query(builder) || builder;
					const built = (ret instanceof BlocksOneQueryBuilder ? ret : builder).build();
					qobj = { hashOrNumber: built.id, useCache: built.useCache };
				} else {
					qobj = query;
				}

				const { id, cacheKey } = BlocksMapper.one(qobj);
				const useCache = qobj.useCache ?? false;
				const path = `/api/v1/blocks/${encodeURIComponent(id)}`;

				if (useCache && self.cache?.enabled) {
					const hit = await self.cache.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, undefined, ...requestArgs);
					const data = await readJsonResponse<Block>(res);
					if (self.cache?.enabled) {
						await self.cache.set(target.network, cacheKey, data, self.cache.ttlSeconds);
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
}
