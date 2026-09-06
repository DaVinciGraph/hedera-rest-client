// src/resources/network/builder.ts

import type {
	NetworkSupplyQuery,
	NetworkSupplyResult,
	NetworkSupplyType,
	NetworkFeesQuery,
	NetworkFeeEstimateRequest,
	NetworkExchangeRateQuery,
	NetworkNodesQuery,
	NetworkRegisteredNodesQuery,
	NetworkStakeQuery,
	NetworkSupplyResponse,
	NetworkFeesResponse,
	FeeEstimateResponse,
	NetworkExchangeRateSetResponse,
	NetworkNodesPage,
	NetworkNodesResponse,
	RegisteredNodesPage,
	RegisteredNodesResponse,
	NetworkStakeResponse,
	RequestOptions,
} from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import {
	NetworkExchangeRateQueryBuilder,
	NetworkFeeEstimateRequestBuilder,
	NetworkFeesQueryBuilder,
	NetworkNodesQueryBuilder,
	NetworkRegisteredNodesQueryBuilder,
	NetworkStakeQueryBuilder,
	type NetworkSupplyBuilderResult,
	NetworkSupplyQueryBuilder,
} from "../../dsl/network";

import { NetworkMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

type NetworkSupplyHandle<Result> = {
	get(options?: RequestOptions): Promise<Result>;
};

/**
 * Fluent client for **Network** endpoints.
 *
 * Capabilities
 * ------------
 * - Accepts **either** legacy object queries **or** a typed **DSL builder** for each endpoint.
 * - Delegates all validation and parameter mapping to {@link NetworkMapper}.
 * - Resolves symbolic limits (`"default"`, `"max"`) and clamps them according to
 *   the active provider/network via {@link resolveLimitValue}.
 * - Integrates with the shared {@link ProviderRegistry} for:
 *   - request execution,
 *   - logging,
 *   - retry policy & rate limiting,
 *   - optional failover across providers.
 * - For selected single endpoints, supports explicit cached reads and write-through storage.
 *
 * Usage overview
 * --------------
 * ```ts
 * // Object form
 * const fees = await client.network().fees({ timestamp: ["gte:1700000000", "lt:1700003600"], order: "desc" }).get();
 *
 * // DSL form
 * const nodes = await client.network().nodes(q =>
	 *   q.fileId("0.0.102")         // request ID; shorthand such as "102" also works
 *    .nodeId().greaterThan(3)   // comparator
 *    .order("desc")
 *    .limit("default")
 * ).get();
 * ```
 */
export class NetworkBuilder extends ResourceBuilder<NetworkBuilder> {
	/**
	 * @param registry Shared {@link ProviderRegistry} (transport, retries, logging, failover).
	 * @param provider Optional provider name to scope this resource (overrides client default).
	 * @param network  Optional network name to scope this resource (overrides client default).
	 * @param cache    Optional cache used by `supply`, `exchangeRate`, and `stake`.
	 *                 `useCache: true` permits reads; enabled caches receive fresh writes.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private cache?: NetworkScopedCache<unknown>
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * **GET `/api/v1/network/supply`** — single, cacheable endpoint.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link NetworkSupplyQuery}
	 * - DSL: `(q: NetworkSupplyQueryBuilder) => void`
	 *
	 * Caching
	 * -------
	 * - `useCache` allows a cached read. Successful fresh responses are stored
	 *   whenever caching is enabled.
	 */
	supply(): NetworkSupplyHandle<NetworkSupplyResponse>;
	supply<Query extends NetworkSupplyQuery>(query: Query): NetworkSupplyHandle<NetworkSupplyResult<Query>>;
	supply<Result extends void | NetworkSupplyQueryBuilder<NetworkSupplyType | undefined>>(
		query: (q: NetworkSupplyQueryBuilder) => Result
	): NetworkSupplyHandle<NetworkSupplyBuilderResult<Result>>;
	supply(
		query?: NetworkSupplyQuery | ((q: NetworkSupplyQueryBuilder) => void | NetworkSupplyQueryBuilder<NetworkSupplyType | undefined>)
	): NetworkSupplyHandle<NetworkSupplyResponse | string> {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NetworkSupplyResponse | string> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/network/supply`;

				let qobj: NetworkSupplyQuery | undefined;
				if (typeof query === "function") {
					const b = new NetworkSupplyQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof NetworkSupplyQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { params, cacheKey } = NetworkMapper.supply(qobj);

				if (qobj?.useCache === true && self.cache?.enabled) {
					const hit = (await self.cache.get(target.network, cacheKey)) as NetworkSupplyResponse | string | undefined;
					if (hit !== undefined) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				const res = await self.registry.get(target, path, params, ...requestArgs);
				const data = qobj?.q === undefined ? await readJsonResponse<NetworkSupplyResponse>(res) : await res.text();
				if (self.cache?.enabled) {
					await self.cache.set(target.network, cacheKey, data, self.cache.ttlSeconds);
				}
				return data;
			},
		};
	}

	/**
	 * **GET `/api/v1/network/fees`** — list; never cached.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link NetworkFeesQuery}
	 * - DSL: `(q: NetworkFeesQueryBuilder) => void`
	 *
	 * Response
	 * --------
	 * Returns the raw {@link NetworkFeesResponse}. This endpoint is not paged by Mirror Node.
	 */
	fees(query?: NetworkFeesQuery | ((q: NetworkFeesQueryBuilder) => void | NetworkFeesQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NetworkFeesResponse> {
				const target = self.resolve();
				const path = `/api/v1/network/fees`;

				let qobj: NetworkFeesQuery | undefined;
				if (typeof query === "function") {
					const b = new NetworkFeesQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof NetworkFeesQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const params = NetworkMapper.fees(qobj);

				const res = await self.registry.get(target, path, params, ...requestOptionArgs(options));
				return readJsonResponse<NetworkFeesResponse>(res);
			},
		};
	}

	/**
	 * **GET `/api/v1/network/exchangerate`** — single, cacheable endpoint.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link NetworkExchangeRateQuery}
	 * - DSL: `(q: NetworkExchangeRateQueryBuilder) => void`
	 *
	 * Caching
	 * -------
	 * Uses a cache key that incorporates the timestamp filter, if present.
	 */
	exchangeRate(query?: NetworkExchangeRateQuery | ((q: NetworkExchangeRateQueryBuilder) => void | NetworkExchangeRateQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NetworkExchangeRateSetResponse> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/network/exchangerate`;

				let qobj: NetworkExchangeRateQuery | undefined;
				if (typeof query === "function") {
					const b = new NetworkExchangeRateQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof NetworkExchangeRateQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { params, cacheKey } = NetworkMapper.exchangeRate(qobj);

				if (qobj?.useCache === true && self.cache?.enabled) {
					const hit = (await self.cache.get(target.network, cacheKey)) as NetworkExchangeRateSetResponse | undefined;
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				const res = await self.registry.get(target, path, params, ...requestArgs);
				const data = await readJsonResponse<NetworkExchangeRateSetResponse>(res);
				if (self.cache?.enabled) {
					await self.cache.set(target.network, cacheKey, data, self.cache.ttlSeconds);
				}
				return data;
			},
		};
	}

	/**
	 * **GET `/api/v1/network/nodes`** — list; never cached.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link NetworkNodesQuery}
	 * - DSL: `(q: NetworkNodesQueryBuilder) => void`
	 *
	 * Limits
	 * ------
	 * The numeric `limit` is resolved/clamped based on the active provider/network.
	 *
	 * Response
	 * --------
	 * Returns a {@link NetworkNodesPage}; its `next()` helper follows the
	 * Mirror Node's `links.next` cursor when another page exists.
	 */
	nodes(query?: NetworkNodesQuery | ((q: NetworkNodesQueryBuilder) => void | NetworkNodesQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NetworkNodesPage> {
				const target = self.resolve();
				const path = `/api/v1/network/nodes`;

				let qobj: NetworkNodesQuery | undefined;
				if (typeof query === "function") {
					const b = new NetworkNodesQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof NetworkNodesQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const params = NetworkMapper.nodes(qobj);
				prepareQueryLimit(target, params, undefined, "network.nodes");
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<NetworkNodesResponse>(routed.response);
				return wrapPaged<NetworkNodesPage, NetworkNodesResponse>(self.registry, routed, raw, (page) => ({
					...page,
					nodes: page.nodes,
				}));
			},
		};
	}

	/**
	 * **POST `/api/v1/network/fees`** - estimate fees for one protobuf HAPI transaction.
	 *
	 * The singular `proto.Transaction` body is sent byte-for-byte with one of the two media types
	 * accepted by Mirror Node. `mode` and `highVolumeThrottle` are encoded as
	 * query parameters. This operation is never cached.
	 */
	estimateFees(query: NetworkFeeEstimateRequest | ((q: NetworkFeeEstimateRequestBuilder) => void | NetworkFeeEstimateRequestBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<FeeEstimateResponse> {
				const target = self.resolve();
				const path = "/api/v1/network/fees";

				let request: NetworkFeeEstimateRequest;
				if (typeof query === "function") {
					const builder = new NetworkFeeEstimateRequestBuilder();
					const returned = query(builder) || builder;
					request = (returned instanceof NetworkFeeEstimateRequestBuilder ? returned : builder).build();
				} else {
					request = query;
				}

				const { body, params, contentType } = NetworkMapper.estimateFees(request);
				const [signal, timeoutMs] = requestOptionArgs(options);
				const response = await self.registry.post(target, path, body, {
					query: params,
					headers: { "content-type": contentType },
					...(signal !== undefined ? { signal } : {}),
					...(timeoutMs !== undefined ? { timeoutMs } : {}),
				});
				return readJsonResponse<FeeEstimateResponse>(response);
			},
		};
	}

	/**
	 * **GET `/api/v1/network/registered-nodes`** - paged registered-node list.
	 *
	 * Supports filtering by registered-node id and registered service type. The
	 * numeric page limit is resolved against the active provider/network, and
	 * `next()` follows the Mirror Node `links.next` cursor on the same target.
	 */
	registeredNodes(query?: NetworkRegisteredNodesQuery | ((q: NetworkRegisteredNodesQueryBuilder) => void | NetworkRegisteredNodesQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<RegisteredNodesPage> {
				const target = self.resolve();
				const path = "/api/v1/network/registered-nodes";

				let qobj: NetworkRegisteredNodesQuery | undefined;
				if (typeof query === "function") {
					const builder = new NetworkRegisteredNodesQueryBuilder();
					const returned = query(builder) || builder;
					qobj = (returned instanceof NetworkRegisteredNodesQueryBuilder ? returned : builder).build();
				} else {
					qobj = query;
				}

				const params = NetworkMapper.registeredNodes(qobj);
				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<RegisteredNodesResponse>(routed.response);
				return wrapPaged<RegisteredNodesPage, RegisteredNodesResponse>(self.registry, routed, raw, (page) => ({
					registered_nodes: page.registered_nodes,
				}));
			},
		};
	}

	/**
	 * **GET `/api/v1/network/stake`** — single, cacheable endpoint.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link NetworkStakeQuery}
	 * - DSL: `(q: NetworkStakeQueryBuilder) => void`
	 *
	 * Caching
	 * -------
	 * Uses a fixed cache key (`network:stake`) as this endpoint has no filters.
	 */
	stake(query?: NetworkStakeQuery | ((q: NetworkStakeQueryBuilder) => void | NetworkStakeQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<NetworkStakeResponse> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/network/stake`;

				let qobj: NetworkStakeQuery | undefined;
				if (typeof query === "function") {
					const b = new NetworkStakeQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof NetworkStakeQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}
				const { cacheKey } = NetworkMapper.stake(qobj);

				if (qobj?.useCache === true && self.cache?.enabled) {
					const hit = (await self.cache.get(target.network, cacheKey)) as NetworkStakeResponse | undefined;
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				const res = await self.registry.get(target, path, undefined, ...requestArgs);
				const data = await readJsonResponse<NetworkStakeResponse>(res);
				if (self.cache?.enabled) {
					await self.cache.set(target.network, cacheKey, data, self.cache.ttlSeconds);
				}
				return data;
			},
		};
	}
}
