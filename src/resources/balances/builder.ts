// src/resources/balances/builder.ts

import type { BalancesListQuery, BalancesPage, BalancesResponse, RequestOptions } from "../../types";
import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import { BalancesListQueryBuilder } from "../../dsl/balances";
import { BalancesMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * BalancesBuilder
 * ===============
 * High‑level fluent client for the /api/v1/balances endpoints.
 *
 * How requests are built
 * ----------------------
 * You can supply filters in two equivalent ways:
 *
 * 1) **Legacy object form**
 *    ```ts
 *    client.balances().list({
 *      accountId: "gte:0.0.100",
 *      accountBalance: "gt:1000000",
 *      timestamp: ["gte:1700000000", "lt:1700003600"],
 *      order: "desc",
 *      limit: 25,
 *    }).get()
 *    ```
 *
 * 2) **Fluent DSL form** (type‑safe, autocompleted)
 *    ```ts
 *    client.balances().list(q =>
 *      q.accountId().greaterThan("0.0.100")
 *       .accountBalance().greaterThan(1_000_000)
 *       .timestamp().lessThanOrEqualTo("1700003600")
 *       .order("desc")
 *       .limit(25)
 *    ).get()
 *    ```
 *
 * Paging
 * ------
 * The `.get()` method returns a `BalancesPage` with a `next()` function:
 * - `page.next()` performs the next request and returns another `BalancesPage`
 *   or `null` if there is no next page.
 * - `page.next.url()` returns the absolute URL of the next page (or `null`).
 *
 * Limit handling
 * --------------
 * The `limit` you pass can be a number, `"default"`, or `"max"`. The final
 * numeric value is resolved **per provider/network** via {@link resolveLimitValue}
 * and then clamped to `[1, maxLimit]`.
 *
 * Failover behavior
 * -----------------
 * If the client is configured with provider failover, transient failures are
 * retried on another provider transparently. See {@link ProviderRegistry}.
 */
export class BalancesBuilder extends ResourceBuilder<BalancesBuilder> {
	/**
	 * @param registry Shared provider registry used to resolve base URL,
	 *                 retry policy, and rate limiting.
	 * @param provider Optional provider name to scope this builder.
	 * @param network  Optional network name to scope this builder.
	 */
	constructor(registry: ProviderRegistry, provider?: string, network?: string) {
		super(registry, provider as any, network as any);
	}

	/**
	 * Build a **GET `/api/v1/balances`** request.
	 *
	 * Supports both styles:
	 * - Legacy object: {@link BalancesListQuery}
	 * - Fluent DSL callback: `(q: BalancesListQueryBuilder) => void | BalancesListQueryBuilder`
	 *
	 * Returns a small executor with an async `.get()` method that:
	 * 1) Resolves the target provider/network.
	 * 2) Maps/validates the query (object path uses {@link BalancesMapper.list}).
	 * 3) Resolves the effective `limit` per target via {@link resolveLimitValue}.
	 * 4) Executes the HTTP request (with preconfigured retries/limiting).
	 * 5) Wraps the raw response into a `BalancesPage` via {@link wrapPaged}.
	 *
	 * @example Legacy object
	 * ```ts
	 * const page = await client.balances().list({
	 *   accountId: "0.0.1001",
	 *   order: "desc",
	 *   limit: 10,
	 * }).get();
	 * console.log(page.timestamp, page.balances.length);
	 * ```
	 *
	 * @example Fluent DSL
	 * ```ts
	 * const page = await client.balances().list(q =>
	 *   q.accountId().greaterThan("0.0.100")
	 *    .accountBalance().greaterThanOrEqualTo(1_000_000)
	 *    .timestamp().lessThanOrEqualTo("1700000000.123456789")
	 *    .order("desc")
	 *    .limit(10)
	 * ).get();
	 * ```
	 *
	 * @param query Optional legacy object or DSL initializer.
	 * @returns An object exposing `get(): Promise<BalancesPage>`.
	 */
	list(query?: BalancesListQuery | ((q: BalancesListQueryBuilder) => void | BalancesListQueryBuilder)) {
		const self = this;

		return {
			/**
			 * Execute the HTTP request and return a paged response. When failover
			 * is enabled on the registry, transient failures are retried using the
			 * registry’s failover policy.
			 */
			async get(options: RequestOptions = {}): Promise<BalancesPage> {
				const target = self.resolve();
				const path = "/api/v1/balances";

				let params: Record<string, any>;

				if (typeof query === "function") {
					// Fluent DSL path
					const builder = new BalancesListQueryBuilder();
					const ret = query(builder) || builder;
					const built = (ret instanceof BalancesListQueryBuilder ? ret : builder).build();
					params = built.params;
				} else {
					// Legacy object path
					params = BalancesMapper.list(query);
				}

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<BalancesResponse>(routed.response);

				// Convert to BalancesPage with a ready-to-use next()
				return wrapPaged<BalancesPage, BalancesResponse>(self.registry, routed, raw, (r) => ({
					balances: r.balances ?? [],
					timestamp: r.timestamp,
				}));
			},
		};
	}
}
