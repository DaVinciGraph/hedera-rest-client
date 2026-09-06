// src/resources/contracts/builder.ts

import type {
	// queries
	ContractsListQuery,
	ContractOneQuery,
	ContractResultsListQuery,
	ContractResultsByContractQuery,
	ContractResultByTransactionQuery,
	ContractResultByTimestampQuery,
	ContractLogsListQuery,
	ContractLogsByContractQuery,
	ContractStateQuery,
	ContractCallRequest,
	ContractOpcodesQuery,
	ContractResultActionsQuery,
	// responses
	ContractsResponse,
	ContractResponse,
	ContractResultsResponse,
	ContractResultDetails,
	ContractLogsResponse,
	ContractStateResponse,
	ContractCallResponse,
	ContractActionsResponse,
	OpcodesResponse,
	ContractsPage,
	ContractsResultsPage,
	ContractLogsPage,
	ContractActionsPage,
	ContractStatePage,
	RequestOptions,
} from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import {
	ContractActionsQueryBuilder,
	ContractCallRequestBuilder,
	ContractLogsByContractQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractOneQueryBuilder,
	ContractOpcodesQueryBuilder,
	ContractResultByTimestampQueryBuilder,
	ContractResultByTransactionQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractsListQueryBuilder,
	ContractStateQueryBuilder,
} from "../../dsl/contracts";

import { ContractsMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * Fluent client for **Contracts** endpoints.
 *
 * What this builder does
 * ----------------------
 * - Accepts **either** a legacy object query **or** a type‑safe **DSL builder**.
 * - Validates & maps inputs via {@link ContractsMapper}.
 * - Resolves limits against provider/network defaults via {@link resolveLimitValue}.
 * - Wraps list responses into pageable objects via {@link wrapPaged}.
 * - Honors the registry’s retry/failover/limiting configuration.
 * - Supports explicit cached reads and write-through storage for selected single-item endpoints.
 *
 * Typical usage
 * -------------
 * ```ts
 * // List contracts (DSL)
 * const page = await client.contracts().list(q =>
 *   q.contractId().greaterThan("0.0.1000").order("desc").limit("default")
 * ).get();
 *
 * // Get next page (if any)
 * const next = await page.next();
 *
 * // Fetch one contract (object form) with caching
 * const one = await client.contracts().one({
 *   idOrAddress: "0.0.1001",
 *   timestamp: "lte:1700000000.123",
 *   useCache: true,
 * }).get();
 * ```
 */
export class ContractsBuilder extends ResourceBuilder<ContractsBuilder> {
	/**
	 * @param registry A shared {@link ProviderRegistry} that provides:
	 *                 - provider/network resolution,
	 *                 - logging,
	 *                 - HTTP retry policy,
	 *                 - rate limiting & optional failover.
	 * @param provider Optional provider name to scope this builder (overrides client default).
	 * @param network  Optional network name to scope this builder (overrides client default).
	 * @param caches   Optional caches used by specific single‑item endpoints:
	 *                 - `one`    → `/contracts/{id}`
	 *                 - `result` → `/contracts/{id}/results/{ts}` and `/contracts/results/{txIdOrHash}`
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private caches?: {
			one?: NetworkScopedCache<ContractResponse>;
			result?: NetworkScopedCache<ContractResultDetails>;
		}
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * **GET `/api/v1/contracts`** — list contracts (never cached).
	 *
	 * Authoring styles
	 * ----------------
	 * - Object: {@link ContractsListQuery}
	 * - DSL: `(q: ContractsListQueryBuilder) => void`
	 *
	 * Paging
	 * ------
	 * Returns a `ContractsPage` with `next()` and `next.url()`.
	 *
	 * Limit handling
	 * --------------
	 * Symbolic limits (`"default"`, `"max"`) are resolved to numbers and then
	 * clamped to provider/network constraints.
	 */
	list(query?: ContractsListQuery | ((q: ContractsListQueryBuilder) => void | ContractsListQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractsPage> {
				const target = self.resolve();
				const path = "/api/v1/contracts";

				let qobj: ContractsListQuery | undefined;
				if (typeof query === "function") {
					const b = new ContractsListQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractsListQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const params = ContractsMapper.list(qobj);
				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractsResponse>(routed.response);
				return wrapPaged<ContractsPage, ContractsResponse>(self.registry, routed, raw, (r) => ({ contracts: r.contracts ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/{idOrAddress}`** — single contract (cacheable).
	 *
	 * Caching
	 * -------
	 * `useCache` allows an existing entry to be returned. Every successful fresh
	 * response is written with the cache's TTL when caching is enabled.
	 *
	 * 404 handling
	 * ------------
	 * A 404 response is returned as `null`.
	 */
	one(query: ContractOneQuery | ((q: ContractOneQueryBuilder) => void | ContractOneQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractResponse | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();

				let qobj: ContractOneQuery;
				if (typeof query === "function") {
					const b = new ContractOneQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractOneQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params, cacheKey } = ContractsMapper.one(qobj);
				const path = `/api/v1/contracts/${encodeURIComponent(id)}`;

				if (qobj.useCache === true && self.caches?.one?.enabled) {
					const hit = await self.caches.one.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<ContractResponse>(res);
					if (self.caches?.one?.enabled) await self.caches.one.set(target.network, cacheKey, data, self.caches.one.ttlSeconds);
					return data;
				} catch (e: any) {
					if (e instanceof HttpError && e.status === 404) return null;
					throw e;
				}
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/{id}/results`** — results for a single contract (never cached).
	 *
	 * Notes
	 * -----
	 * - If `transactionIndex` is supplied, the mapper enforces that either
	 *   `blockHash` or `blockNumber` is also present.
	 * - Returns a pageable `ContractsResultsPage`.
	 */
	results(query: ContractResultsByContractQuery | ((q: ContractResultsByContractQueryBuilder) => void | ContractResultsByContractQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractsResultsPage> {
				const target = self.resolve();

				let qobj: ContractResultsByContractQuery;
				if (typeof query === "function") {
					const b = new ContractResultsByContractQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractResultsByContractQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params } = ContractsMapper.resultsByContract(qobj);
				const path = `/api/v1/contracts/${encodeURIComponent(id)}/results`;

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractResultsResponse>(routed.response);
				return wrapPaged<ContractsResultsPage, ContractResultsResponse>(self.registry, routed, raw, (r) => ({ results: r.results ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/{id}/results/{timestamp}`** — single result (cacheable).
	 *
	 * Behavior
	 * --------
	 * - Requires an **exact** `timestamp` (no comparator).
	 * - `hbar` selects tinybars (`true`, the server default) or weibars (`false`).
	 * - `useCache` permits a cached read; fresh responses are stored when enabled.
	 * - `404` is returned as `null`.
	 */
	resultByTimestamp(query: ContractResultByTimestampQuery | ((q: ContractResultByTimestampQueryBuilder) => void | ContractResultByTimestampQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractResultDetails | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();

				let qobj: ContractResultByTimestampQuery;
				if (typeof query === "function") {
					const b = new ContractResultByTimestampQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractResultByTimestampQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, ts, params, cacheKey } = ContractsMapper.resultByTimestamp(qobj);
				const path = `/api/v1/contracts/${encodeURIComponent(id)}/results/${encodeURIComponent(ts)}`;

				if (qobj.useCache === true && self.caches?.result?.enabled) {
					const hit = await self.caches.result.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, Object.keys(params).length ? params : undefined, ...requestArgs);
					const data = await readJsonResponse<ContractResultDetails>(res);
					if (self.caches?.result?.enabled) await self.caches.result.set(target.network, cacheKey, data, self.caches.result.ttlSeconds);
					return data;
				} catch (e: any) {
					if (e instanceof HttpError && e.status === 404) return null;
					throw e;
				}
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/results`** — global results list (never cached).
	 *
	 * - Accepts object or DSL form.
	 * - `hbar` selects tinybars (`true`, the server default) or weibars (`false`).
	 * - Returns a pageable `ContractsResultsPage`.
	 */
	globalResults(query?: ContractResultsListQuery | ((q: ContractResultsListQueryBuilder) => void | ContractResultsListQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractsResultsPage> {
				const target = self.resolve();
				const path = "/api/v1/contracts/results";

				let qobj: ContractResultsListQuery | undefined;
				if (typeof query === "function") {
					const b = new ContractResultsListQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractResultsListQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const params = ContractsMapper.resultsList(qobj);
				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractResultsResponse>(routed.response);
				return wrapPaged<ContractsResultsPage, ContractResultsResponse>(self.registry, routed, raw, (r) => ({ results: r.results ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/results/{transactionIdOrHash}`** — single result (cacheable).
	 *
	 * - Accepts TransactionId (`0.0.x-<s>-<ns>`) or 32‑byte tx hash.
	 * - Optional `nonce` refines the lookup.
	 * - `hbar` selects tinybars (`true`, the server default) or weibars (`false`).
	 * - `useCache` permits a cached read; fresh responses are stored when enabled.
	 * - `404` is returned as `null`.
	 */
	resultByTransaction(query: ContractResultByTransactionQuery | ((q: ContractResultByTransactionQueryBuilder) => void | ContractResultByTransactionQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractResultDetails | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();

				let qobj: ContractResultByTransactionQuery;
				if (typeof query === "function") {
					const b = new ContractResultByTransactionQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractResultByTransactionQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params, cacheKey } = ContractsMapper.resultByTransaction(qobj);
				const path = `/api/v1/contracts/results/${encodeURIComponent(id)}`;

				if (qobj.useCache === true && self.caches?.result?.enabled) {
					const hit = await self.caches.result.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<ContractResultDetails>(res);
					if (self.caches?.result?.enabled) await self.caches.result.set(target.network, cacheKey, data, self.caches.result.ttlSeconds);
					return data;
				} catch (e: any) {
					if (e instanceof HttpError && e.status === 404) return null;
					throw e;
				}
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/results/logs`** — global logs list (never cached).
	 *
	 * Rules enforced by the mapper
	 * ----------------------------
	 * - Topic values are 1–64 hex digits with an optional `0x` prefix.
	 * - If any topic is set, `timestamp` is required and must span ≤ 7 days.
	 * - `index` requires `timestamp` and supports eq|gt|gte|lt|lte.
	 */
	globalLogs(query?: ContractLogsListQuery | ((q: ContractLogsListQueryBuilder) => void | ContractLogsListQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractLogsPage> {
				const target = self.resolve();
				const path = "/api/v1/contracts/results/logs";

				let qobj: ContractLogsListQuery | undefined;
				if (typeof query === "function") {
					const b = new ContractLogsListQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractLogsListQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const params = ContractsMapper.logsList(qobj);
				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractLogsResponse>(routed.response);
				return wrapPaged<ContractLogsPage, ContractLogsResponse>(self.registry, routed, raw, (r) => ({ logs: r.logs ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/{id}/results/logs`** — contract‑scoped logs list (never cached).
	 *
	 * Notes
	 * -----
	 * - Validates the contract id/address.
	 * - Enforces the same topic/timestamp/index rules as the global logs endpoint.
	 */
	logs(query: ContractLogsByContractQuery | ((q: ContractLogsByContractQueryBuilder) => void | ContractLogsByContractQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractLogsPage> {
				const target = self.resolve();

				let qobj: ContractLogsByContractQuery;
				if (typeof query === "function") {
					const b = new ContractLogsByContractQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractLogsByContractQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params } = ContractsMapper.logsByContract(qobj);
				const path = `/api/v1/contracts/${encodeURIComponent(id)}/results/logs`;

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractLogsResponse>(routed.response);
				return wrapPaged<ContractLogsPage, ContractLogsResponse>(self.registry, routed, raw, (r) => ({ logs: r.logs ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/{id}/state`** — contract state (never cached).
	 *
	 * - `slot` accepts one or more hex keys.
	 * - Returns a page whose `next()` helper follows `links.next`.
	 */
	state(query: ContractStateQuery | ((q: ContractStateQueryBuilder) => void | ContractStateQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractStatePage> {
				const target = self.resolve();

				let qobj: ContractStateQuery;
				if (typeof query === "function") {
					const b = new ContractStateQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractStateQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params } = ContractsMapper.stateQuery(qobj);
				const path = `/api/v1/contracts/${encodeURIComponent(id)}/state`;

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractStateResponse>(routed.response);
				return wrapPaged<ContractStatePage, ContractStateResponse>(self.registry, routed, raw, (page) => ({
					...page,
					state: page.state ?? [],
				}));
			},
		};
	}

	/**
	 * **POST `/api/v1/contracts/call`** — EVM call/estimate (no caching).
	 *
	 * - Body is validated and normalized by {@link ContractsMapper.callQuery}.
	 * - When `switchProviderOnFailure` is enabled, a failed POST is retried on other
	 *   providers transparently (handled internally by {@link ProviderRegistry.post}).
	 */
	call(query: ContractCallRequest | ((q: ContractCallRequestBuilder) => void | ContractCallRequestBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractCallResponse> {
				const target = self.resolve();
				const path = `/api/v1/contracts/call`;

				let bodyRaw: ContractCallRequest;
				if (typeof query === "function") {
					const b = new ContractCallRequestBuilder();
					const ret = query(b) || b;
					bodyRaw = (ret instanceof ContractCallRequestBuilder ? ret : b).build();
				} else {
					bodyRaw = query;
				}

				const body = ContractsMapper.callQuery(bodyRaw);
				const [signal, timeoutMs] = requestOptionArgs(options);
				const postOptions = {
					...(signal !== undefined ? { signal } : {}),
					...(timeoutMs !== undefined ? { timeoutMs } : {}),
				};

				const res = await self.registry.post(target, path, body, postOptions);
				return readJsonResponse<ContractCallResponse>(res);
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/results/{transactionIdOrHash}/actions`** — list actions (never cached).
	 *
	 * - Supports `index` comparator for paging across large result sets.
	 * - Returns a pageable `ContractActionsPage`.
	 */
	actions(query: ContractResultActionsQuery | ((q: ContractActionsQueryBuilder) => void | ContractActionsQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<ContractActionsPage> {
				const target = self.resolve();

				let qobj: ContractResultActionsQuery;
				if (typeof query === "function") {
					const b = new ContractActionsQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractActionsQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params } = ContractsMapper.actionsByResult(qobj);
				const path = `/api/v1/contracts/results/${encodeURIComponent(id)}/actions`;

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<ContractActionsResponse>(routed.response);
				return wrapPaged<ContractActionsPage, ContractActionsResponse>(self.registry, routed, raw, (r) => ({ actions: r.actions ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/contracts/results/{transactionIdOrHash}/opcodes`** — EVM opcodes trace (no paging).
	 *
	 * - Optional flags:
	 *   - `stack`, `memory`, `storage`
	 * - Returns raw `OpcodesResponse`.
	 */
	opcodes(query: ContractOpcodesQuery | ((q: ContractOpcodesQueryBuilder) => void | ContractOpcodesQueryBuilder)) {
		const self = this;
		return {
			async get(options: RequestOptions = {}): Promise<OpcodesResponse> {
				const target = self.resolve();

				let qobj: ContractOpcodesQuery;
				if (typeof query === "function") {
					const b = new ContractOpcodesQueryBuilder();
					const ret = query(b) || b;
					qobj = (ret instanceof ContractOpcodesQueryBuilder ? ret : b).build();
				} else {
					qobj = query;
				}

				const { id, params } = ContractsMapper.opcodes(qobj);
				const path = `/api/v1/contracts/results/${encodeURIComponent(id)}/opcodes`;

				const res = await self.registry.get(target, path, params, ...requestOptionArgs(options));
				return readJsonResponse<OpcodesResponse>(res);
			},
		};
	}
}
