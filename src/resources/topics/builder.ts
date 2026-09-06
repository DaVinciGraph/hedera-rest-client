// src/resources/topics/builder.ts

import type { Topic, TopicMessage, TopicMessagesResponse, TopicOneQuery, TopicMessagesListQuery, TopicMessageBySequenceQuery, TopicMessageByTimestampQuery, TopicMessagesPage, RequestOptions } from "../../types";

import { ResourceBuilder } from "../base";
import { ProviderRegistry } from "../../core/provider";
import { HttpError } from "../../core/errors";
import { wrapPaged } from "../../core/paging";
import { readJsonResponse } from "../../core/json";
import { prepareQueryLimit } from "../../core/limits";
import type { NetworkScopedCache } from "../../core/network-cache";

import { TopicMessageBySequenceQueryBuilder, TopicMessageByTimestampQueryBuilder, TopicMessagesListQueryBuilder, TopicOneQueryBuilder } from "../../dsl/topics";

import { TopicsMapper } from "./mapper";
import { requestOptionArgs } from "../../core/request-options";

/**
 * TopicsBuilder
 * -------------
 * A thin, ergonomic client for **Topics** endpoints that:
 * - Accepts both **object style** and **DSL builder** style queries.
 * - Delegates **all validation + param shaping** to {@link TopicsMapper}.
 * - Resolves symbolic `limit` values per network via {@link resolveLimitValue}.
 * - Performs HTTP via a shared {@link ProviderRegistry}, honoring its
 *   failover strategy.
 * - Wraps list responses with {@link wrapPaged} to expose paging helpers.
 * - Supports explicit cached reads and write-through storage for single-item endpoints.
 *
 * Caching
 * -------
 * Pass `useCache: true` (or `.useCache(true)` in the DSL) to allow a cached read.
 * If caching is enabled, every successful fresh response is written regardless
 * of that per-request read choice.
 *
 * Error handling
 * --------------
 * - 404 responses are normalized to `null` for single‑item reads.
 * - All other HTTP errors are rethrown.
 * - Validation errors are thrown by the mapper before network calls.
 *
 * Usage overview
 * --------------
 * ```ts
 * // Single topic (with optional cache)
 * const t = await topics.one(q => q.topicId("0.0.1001").useCache(true)).get();
 *
 * // Messages list (object style)
 * const page = await topics.messages({
 *   topicId: "0.0.1001",
 *   encoding: "utf-8",
 *   sequenceNumber: "gte:10",
 *   order: "asc",
 *   limit: 25
 * }).get();
 * ```
 */
export class TopicsBuilder extends ResourceBuilder<TopicsBuilder> {
	/**
	 * @param registry Shared {@link ProviderRegistry} instance (handles base URL, auth, retries, failover).
	 * @param provider Optional provider override for this resource instance.
	 * @param network  Optional network override for this resource instance.
	 * @param caches   Optional caches configuration for single‑item endpoints:
	 *  - `topic`: cache for `/topics/{topicId}` responses.
	 *  - `message`: cache for `/topics/{topicId}/messages/{sequenceNumber}` and `/topics/messages/{timestamp}`.
	 *
	 * Each cache object supports `{ get, set, ttlSeconds, enabled }`.
	 */
	constructor(
		registry: ProviderRegistry,
		provider?: string,
		network?: string,
		private caches?: {
			topic?: NetworkScopedCache<Topic>;
			message?: NetworkScopedCache<TopicMessage>;
		}
	) {
		super(registry, provider as any, network as any);
	}

	/**
	 * **GET `/api/v1/topics/{topicId}`** — fetch a single topic.
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TopicOneQuery}
	 * - DSL: `(q: TopicOneQueryBuilder) => void | TopicOneQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and shapes input via {@link TopicsMapper.topicOne}, which also
	 *   provides a stable `cacheKey`.
	 * - `useCache` allows a read before the network request. Successful fresh
	 *   responses are stored whenever caching is enabled.
	 * - Returns `null` on HTTP 404. Other errors are rethrown (with optional failover).
	 *
	 * @returns An object exposing `get()` that resolves to {@link Topic} or `null`.
	 */
	one(query: TopicOneQuery | ((q: TopicOneQueryBuilder) => void | TopicOneQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TopicOneQuery;
		if (typeof query === "function") {
			const b = new TopicOneQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TopicOneQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, cacheKey } = TopicsMapper.topicOne(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<Topic | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/topics/${encodeURIComponent(id)}`;

				if (useCache && self.caches?.topic?.enabled) {
					const hit = await self.caches.topic.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, undefined, ...requestArgs);
					const data = await readJsonResponse<Topic>(res);
					if (self.caches?.topic?.enabled) {
						await self.caches.topic.set(target.network, cacheKey, data, self.caches.topic.ttlSeconds);
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
	 * **GET `/api/v1/topics/{topicId}/messages`** — list messages under a topic (paged).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TopicMessagesListQuery}
	 * - DSL: `(q: TopicMessagesListQueryBuilder) => void | TopicMessagesListQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Uses {@link TopicsMapper.messagesList} for validation and REST param mapping.
	 * - Resolves symbolic `limit` (`"default"`, `"max"`) per network via {@link resolveLimitValue}.
	 * - Wraps the response with {@link wrapPaged} so you can call `page.next()` seamlessly.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TopicMessagesPage}.
	 *
	 * @example
	 * ```ts
	 * const page = await topics.messages(q =>
	 *   q.topicId("0.0.1001")
	 *    .encoding("utf-8")
	 *    .sequenceNumber().greaterThanOrEqualTo(10)
	 *    .timestamp().greaterThanOrEqualTo("1700000000.000000000")
	 *    .order("asc")
	 *    .limit(25)
	 * ).get();
	 * ```
	 */
	messages(query: TopicMessagesListQuery | ((q: TopicMessagesListQueryBuilder) => void | TopicMessagesListQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TopicMessagesListQuery;
		if (typeof query === "function") {
			const b = new TopicMessagesListQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TopicMessagesListQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, params } = TopicsMapper.messagesList(qobj);
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TopicMessagesPage> {
				const target = self.resolve();
				const path = `/api/v1/topics/${encodeURIComponent(id)}/messages`;

				prepareQueryLimit(target, params);
				const routed = await self.registry.getWithTarget(target, path, params, ...requestOptionArgs(options));
				const raw = await readJsonResponse<TopicMessagesResponse>(routed.response);
				return wrapPaged<TopicMessagesPage, TopicMessagesResponse>(self.registry, routed, raw, (r) => ({ messages: r.messages ?? [] }));
			},
		};
	}

	/**
	 * **GET `/api/v1/topics/{topicId}/messages/{sequenceNumber}`** — single message by sequence (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TopicMessageBySequenceQuery}
	 * - DSL: `(q: TopicMessageBySequenceQueryBuilder) => void | TopicMessageBySequenceQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and maps using {@link TopicsMapper.messageBySequence}, which
	 *   supplies a stable cache key for read‑through caching.
	 * - Returns `null` on HTTP 404.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TopicMessage} or `null`.
	 */
	messageBySequence(query: TopicMessageBySequenceQuery | ((q: TopicMessageBySequenceQueryBuilder) => void | TopicMessageBySequenceQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TopicMessageBySequenceQuery;
		if (typeof query === "function") {
			const b = new TopicMessageBySequenceQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TopicMessageBySequenceQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { id, seq, params, cacheKey } = TopicsMapper.messageBySequence(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TopicMessage | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/topics/${encodeURIComponent(id)}/messages/${encodeURIComponent(seq)}`;

				if (useCache && self.caches?.message?.enabled) {
					const hit = await self.caches.message.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<TopicMessage>(res);
					if (self.caches?.message?.enabled) {
						await self.caches.message.set(target.network, cacheKey, data, self.caches.message.ttlSeconds);
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
	 * **GET `/api/v1/topics/messages/{timestamp}`** — single message by exact timestamp (cacheable).
	 *
	 * Query styles
	 * ------------
	 * - Object: {@link TopicMessageByTimestampQuery}
	 * - DSL: `(q: TopicMessageByTimestampQueryBuilder) => void | TopicMessageByTimestampQueryBuilder`
	 *
	 * Behavior
	 * --------
	 * - Validates and maps using {@link TopicsMapper.messageByTimestamp}, which
	 *   supplies a stable cache key for read‑through caching.
	 * - Returns `null` on HTTP 404.
	 *
	 * @returns An object exposing `get()` that resolves to {@link TopicMessage} or `null`.
	 */
	messageByTimestamp(query: TopicMessageByTimestampQuery | ((q: TopicMessageByTimestampQueryBuilder) => void | TopicMessageByTimestampQueryBuilder)) {
		// Build typed query object (DSL or legacy object)
		let qobj: TopicMessageByTimestampQuery;
		if (typeof query === "function") {
			const b = new TopicMessageByTimestampQueryBuilder();
			const ret = query(b) || b;
			qobj = (ret instanceof TopicMessageByTimestampQueryBuilder ? ret : b).build();
		} else {
			qobj = query;
		}

		const { ts, params, cacheKey } = TopicsMapper.messageByTimestamp(qobj);
		const useCache = qobj.useCache ?? false;
		const self = this;

		return {
			async get(options: RequestOptions = {}): Promise<TopicMessage | null> {
				const requestArgs = requestOptionArgs(options);
				const target = self.resolve();
				const path = `/api/v1/topics/messages/${encodeURIComponent(ts)}`;

				if (useCache && self.caches?.message?.enabled) {
					const hit = await self.caches.message.get(target.network, cacheKey);
					if (hit) {
						self.registry.getLogger().debug("cache hit", cacheKey);
						return hit;
					}
				}

				try {
					const res = await self.registry.get(target, path, params, ...requestArgs);
					const data = await readJsonResponse<TopicMessage>(res);
					if (self.caches?.message?.enabled) {
						await self.caches.message.set(target.network, cacheKey, data, self.caches.message.ttlSeconds);
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
