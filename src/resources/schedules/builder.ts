// src/resources/schedules/builder.ts

import type { SchedulesListQuery, SchedulesOneQuery, SchedulesResponse, Schedule, SchedulesPage, RequestOptions } from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import { SchedulesListQueryBuilder, SchedulesOneQueryBuilder } from "../../dsl/schedules";

import { SchedulesMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * High‑level client for the **Schedules** resource.
 *
 * Responsibilities
 * ----------------
 * - Accepts queries either as:
 *   - a **plain object** (`SchedulesListQuery` / `SchedulesOneQuery`), or
 *   - a **typed DSL builder** (`SchedulesListQueryBuilder` / `SchedulesOneQueryBuilder`).
 * - Delegates input validation and parameter shaping to {@link SchedulesMapper}.
 * - Resolves symbolic page limits (`"default"`, `"max"`) using {@link resolveLimitValue}
 *   based on the active provider/network defaults.
 * - Uses the shared {@link ProviderRegistry} for transport, retry, logging, rate‑limit
 *   scheduling, and (optionally) failover to alternate providers.
 * - Supports explicit cached reads and write-through storage for `.one()`.
 *
 * Typical usage
 * -------------
 * ```ts
 * // Object form (list)
 * const page = await client.schedules().list({
 *   accountId: "gte:0.0.1000",
 *   order: "desc",
 *   limit: "default"
 * }).get();
 *
 * // DSL form (list)
 * const page2 = await client.schedules().list(q =>
 *   q.accountId().greaterThanOrEqualTo("0.0.1000")
 *    .order("desc")
 *    .limit(25)
 * ).get();
 *
 * // Single (with cache)
 * const item = await client.schedules().one(q =>
 *   q.scheduleId("0.0.12345").useCache(true)
 * ).get();
 * ```
 */
export class SchedulesBuilder extends ResourceBuilder<SchedulesBuilder> {
	/**
	 * @param registry Shared {@link ProviderRegistry} instance from the client.
	 * @param provider Optional provider name override (falls back to client default).
	 * @param network  Optional network name override (falls back to client default).
	 * @param cache    Optional cache configuration used by `.one()`.
	 *                 The cache should implement simple `{ get, set, ttlSeconds, enabled }`.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private cache?: NetworkScopedCache<Schedule>
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * **GET `/api/v1/schedules`** — list endpoint.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link SchedulesListQuery}
	 * - DSL: `(q: SchedulesListQueryBuilder) => void | SchedulesListQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - The query is normalized through {@link SchedulesMapper.list}.
	 * - `limit` is resolved/clamped per network via {@link resolveLimitValue}.
	 * - On success, the raw response is wrapped with {@link wrapPaged} to provide a
	 *   convenient `next()` function (if `links.next` is present).
	 * - If the registry is configured to allow failover, transient HTTP failures
	 *   will be retried on alternate providers.
	 *
	 * @param query Optional object query or DSL initializer.
	 * @returns An object exposing a `get()` method that resolves to {@link SchedulesPage}.
	 *
	 * @example
	 * ```ts
	 * // Object
	 * const page = await schedules.list({ accountId: "ne:0.0.2", order: "desc", limit: 10 }).get();
	 *
	 * // DSL
	 * const page2 = await schedules.list(q =>
	 *   q.accountId().notEqualTo("0.0.2").order("desc").limit(10)
	 * ).get();
	 * ```
	 */
	list(query?: SchedulesListQuery | ((q: SchedulesListQueryBuilder) => void | SchedulesListQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: SchedulesListQuery | undefined;
		if (typeof query === "function") {
			const b = new SchedulesListQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof SchedulesListQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const params = SchedulesMapper.list(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<SchedulesPage> {
				const target = self.resolve();
				const path = "/api/v1/schedules";

			prepareQueryLimit(target, params);
			const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
			const raw = await readJsonResponse<SchedulesResponse>(routed.response);
			return wrapPaged<SchedulesPage, SchedulesResponse>(self.registry, routed, raw, (r) => ({ schedules: r.schedules ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/schedules/{scheduleId}`** — single item endpoint (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link SchedulesOneQuery}
	 * - DSL: `(q: SchedulesOneQueryBuilder) => void | SchedulesOneQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Input is normalized by {@link SchedulesMapper.one}, which returns a stable
	 *   `cacheKey`. `useCache` allows a lookup before hitting the network; successful
	 *   fresh responses are stored whenever caching is enabled.
	 * - The endpoint returns `null` on HTTP 404.
	 * - If failover is enabled on the registry, transient errors trigger a retry
	 *   on alternate providers.
	 *
	 * @param query Object form or DSL initializer.
	 * @returns An object exposing `get()` that resolves to {@link Schedule} or `null`.
	 *
	 * @example
	 * ```ts
	 * // Object form with cache
	 * const s = await schedules.one({ scheduleId: "0.0.12345", useCache: true }).get();
	 *
	 * // DSL form
	 * const s2 = await schedules.one(q => q.scheduleId("0.0.12345").useCache(true)).get();
	 * ```
	 */
	one(query: SchedulesOneQuery | ((q: SchedulesOneQueryBuilder) => void | SchedulesOneQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: SchedulesOneQuery;
		if (typeof query === "function") {
			const b = new SchedulesOneQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof SchedulesOneQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		// Centralized validation and cache key
		const { id, cacheKey } = SchedulesMapper.one(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<Schedule | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/schedules/${encodeURIComponent(id)}`;

				if (useCache && self.cache?.enabled) {
					const hit = await self.cache.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, undefined, ...requestArgs);
					const data = await readJsonResponse<Schedule>(res);
					if (self.cache?.enabled) {
						await self.cache.set(target.network, cacheKey, data, self.cache.ttlSeconds);
					}
					return data;
			} catch (e: any) {
				// 404 => return null
				if (e instanceof HttpError && e.status === 404) {
					return null;
				}
				throw e;
			}
			},
		};
	}
}
