// src/resources/topics/mapper.ts

import type { TopicOneQuery, TopicMessagesListQuery, TopicMessageBySequenceQuery, TopicMessageByTimestampQuery, TopicMessageEncoding } from "../../types";

import {
	NO_NE_COMPARATOR_OPERATORS,
	assertAllowedObjectKeys,
	validateIntegerFilters,
	validateOptionalBoolean,
	validateOrder,
	validatePositiveInt64,
	validateTimestampFilters,
	validateTimestampExact,
	validateTopicId,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";

/**
 * TopicsMapper
 * ------------
 * A small, focused module that converts **typed, high‑level queries** into
 * the exact parameter shapes the Hedera Mirror Node expects for *Topics* endpoints.
 *
 * Scope and guarantees
 * --------------------
 * - **Pure mapping + validation** only: no HTTP, no paging, no caching.
 * - Produces the **same params and errors** whether the input came from a
 *   plain object (`{ ... }`) or from a strongly‑typed DSL builder.
 * - Throws {@link ValidationError} with clear, caller‑friendly messages on
 *   invalid input. Callers should let these bubble to surface helpful feedback.
 *
 * Parameter naming (REST)
 * -----------------------
 * | Field (high-level) | REST param/key     | Notes                                            |
 * |--------------------|--------------------|--------------------------------------------------|
 * | topicId            | — (path segment)   | Request EntityId (`"x"`, `"0.x"`, or `"0.0.x"`). |
 * | encoding           | `encoding`         | Case-insensitive `"base64"` \| `"utf8"` \| `"utf-8"`. |
 * | sequenceNumber     | `sequencenumber`   | Positive int or comparator string.               |
 * | timestamp          | `timestamp`        | Exact or comparator; single value or array.      |
 * | order              | `order`            | Server default applies if omitted.               |
 * | limit              | `limit`            | May be symbolic (`"default"`, `"max"`) upstream. |
 *
 * Comparator strings
 * ------------------
 * Where comparators are accepted, the **Mirror Node** supports:
 * `eq`, `ne`, `gt`, `gte`, `lt`, `lte` — written as `"op:value"`.
 * Example: `"gte:1700000000.000000001"`, `"lt:42"`.
 *
 * Examples
 * --------
 * ```ts
 * // Single topic (with cache performed by builder):
 * const { id, cacheKey } = TopicsMapper.topicOne({ topicId: "0.0.1001", useCache: true });
 *
 * // List messages for a topic:
 * const { id, params } = TopicsMapper.messagesList({
 *   topicId: "0.0.1001",
 *   encoding: "utf-8",
 *   sequenceNumber: "gte:10",
 *   timestamp: ["gte:1700000000.000000000", "lt:1700003600.000000000"],
 *   order: "asc",
 *   limit: 25
 * });
 * // params → { encoding: "utf-8", sequencenumber: "gte:10", timestamp: [...], order: "asc", limit: 25 }
 * ```
 */
export class TopicsMapper {
	/* -----------------------------
     Validators (narrow, local)
     ----------------------------- */

	/**
	 * Ensure an encoding is one of the allowed values, case-insensitively.
	 * @param enc Encoding value.
	 * @throws {ValidationError} If `enc` is not `"base64"`, `"utf8"`, or `"utf-8"`, ignoring case.
	 */
	private static validateEncoding(enc: unknown): asserts enc is TopicMessageEncoding {
		if (typeof enc !== "string" || !["base64", "utf8", "utf-8"].includes(enc.toLowerCase())) {
			throw new ValidationError(`Invalid encoding: ${String(enc)}. Allowed: 'base64' | 'utf8' | 'utf-8' (case-insensitive)`);
		}
	}

	/* -----------------------------
     Query mappers (1:1 REST mapping)
     ----------------------------- */

	/**
	 * Map **GET `/api/v1/topics/{topicId}`** (single topic).
	 *
	 * Validation
	 * ----------
	 * - `topicId` accepts the Mirror Node request-ID forms (e.g., `"1001"` or `"0.0.1001"`).
	 *
	 * Returns
	 * -------
	 * - `id`: path‑safe topic id.
	 * - `cacheKey`: a stable key builders can use for read‑through caching.
	 *
	 * @example
	 * ```ts
	 * const { id, cacheKey } = TopicsMapper.topicOne({ topicId: "0.0.1001", useCache: true });
	 * // id → "0.0.1001", cacheKey → "topic:0.0.1001"
	 * ```
	 */
	static topicOne(q: TopicOneQuery) {
		assertAllowedObjectKeys(q, ["topicId", "useCache"], "topic query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTopicId(q.topicId);
		const cacheKey = `topic:${q.topicId}`;
		return { id: q.topicId, cacheKey };
	}

	/**
	 * Map **GET `/api/v1/topics/{topicId}/messages`** (list messages under a topic).
	 *
	 * Rules & mapping
	 * ---------------
	 * - `topicId` → path segment (request EntityId shorthand or full form).
	 * - `encoding` → `"encoding"` (optional; case-insensitive `"base64"` \| `"utf8"` \| `"utf-8"`).
	 * - `sequenceNumber` → `"sequencenumber"`:
	 *   - Accepts a **positive integer** or comparator string (`eq|gt|gte|lt|lte:<int>`).
	 * - `timestamp` → `"timestamp"`:
	 *   - Accepts a **single value** or an **array**; each element can be an exact timestamp
	 *     (`"seconds.nanos"`) or an `eq|gt|gte|lt|lte` comparator string.
	 * - `order`, `limit` → forwarded as provided (limit clamped upstream by the builder).
	 *
	 * @returns `{ id, params }` where `id` is the path id and `params` is the REST query object.
	 *
	 * @example
	 * ```ts
	 * const { id, params } = TopicsMapper.messagesList({
	 *   topicId: "0.0.2002",
	 *   encoding: "utf-8",
	 *   sequenceNumber: "gt:100",
	 *   timestamp: ["gte:1700000000.000000000", "lt:1700000600.000000000"],
	 *   order: "asc",
	 *   limit: 10
	 * });
	 * ```
	 */
	static messagesList(q: TopicMessagesListQuery) {
		assertAllowedObjectKeys(q, ["topicId", "encoding", "sequenceNumber", "timestamp", "limit", "order"], "topic messages query");
		validateTopicId(q.topicId);
		const params: Record<string, any> = {};

		if (q.encoding !== undefined) {
			TopicsMapper.validateEncoding(q.encoding);
			params["encoding"] = q.encoding;
		}

		if (q.sequenceNumber !== undefined) {
			const values = validateIntegerFilters(q.sequenceNumber, "sequenceNumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }, 100);
			params["sequencenumber"] = values.length === 1 ? values[0] : values;
		}

		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp, NO_NE_COMPARATOR_OPERATORS);
			params["timestamp"] = arr;
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}

		return { id: q.topicId, params };
	}

	/**
	 * Map **GET `/api/v1/topics/{topicId}/messages/{sequenceNumber}`** (single message by sequence).
	 *
	 * Validation
	 * ----------
	 * - `topicId`: request EntityId shorthand or full form.
	 * - `sequenceNumber`: positive integer (number or numeric string).
	 *
	 * Returns
	 * -------
	 * - `id`: topic id (path segment).
	 * - `seq`: sequence number as a string (path segment).
	 * - `params`: currently empty (reserved for future use).
	 * - `cacheKey`: stable cache key for read‑through caches.
	 */
	static messageBySequence(q: TopicMessageBySequenceQuery) {
		assertAllowedObjectKeys(q, ["topicId", "sequenceNumber", "useCache"], "topic message-by-sequence query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTopicId(q.topicId);
		validatePositiveInt64(q.sequenceNumber, "sequenceNumber");
		const params: Record<string, any> = {};
		const cacheKey = `topicmsg:${q.topicId}:${q.sequenceNumber}`;
		return { id: q.topicId, seq: String(q.sequenceNumber), params, cacheKey };
	}

	/**
	 * Map **GET `/api/v1/topics/messages/{timestamp}`** (single message by *exact* timestamp).
	 *
	 * Validation
	 * ----------
	 * - `timestamp` must be exact (no comparators), e.g. `"1700000000.000000123"`.
	 *
	 * Returns
	 * -------
	 * - `ts`: timestamp string used in the path.
	 * - `params`: currently empty (reserved).
	 * - `cacheKey`: stable cache key for read‑through caches.
	 */
	static messageByTimestamp(q: TopicMessageByTimestampQuery) {
		assertAllowedObjectKeys(q, ["timestamp", "useCache"], "topic message-by-timestamp query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTimestampExact(q.timestamp); // path param requires exact ts
		const params: Record<string, any> = {};
		const cacheKey = `topicmsgts:${q.timestamp}`;
		return { ts: String(q.timestamp), params, cacheKey };
	}
}
