// src/dsl/topics.ts

import { ComparatorApi, createComparator, NoNeComparatorOps } from "./core";
import { ExactTimestamp, IntegerFilter, IntegerValue, LimitValue, NoNeTimestampFilter, Order, TopicMessageEncoding, TopicOneQuery, TopicMessagesListQuery, TopicMessageBySequenceQuery, TopicMessageByTimestampQuery } from "../types";
import {
	NO_NE_COMPARATOR_OPERATORS,
	validateBoolean,
	validateIntegerFilters,
	validateOrder,
	validatePositiveInt64,
	validateTimestampFilters,
	validateTimestampValue,
	validateTopicId,
} from "../core/utils";
import { ValidationError } from "../core/errors";

function appendValues<T>(current: readonly T[], value: T | readonly T[]): T[] {
	if (Array.isArray(value) && value.length === 0) throw new ValidationError("Filter arrays must contain at least one value");
	return [...current, ...(Array.isArray(value) ? (value as readonly T[]) : [value as T])];
}

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

function validateEncoding(value: unknown): asserts value is TopicMessageEncoding {
	if (typeof value !== "string" || !["base64", "utf8", "utf-8"].includes(value.toLowerCase())) {
		throw new ValidationError(`Invalid encoding: ${String(value)}. Allowed: 'base64' | 'utf8' | 'utf-8' (case-insensitive)`);
	}
}

/**
 * Topics DSL
 * ==========
 * Strongly‑typed, fluent builders for /api/v1/topics endpoints.
 *
 * Why a DSL?
 * ----------
 * - Gives a discoverable, chainable API that mirrors the REST endpoints.
 * - Performs early validation with readable error messages.
 * - Supports two ways to express comparators:
 *   1) **Comparator-as-string** — pass a string such as `"gt:100"`, `"lte:200"`.
 *   2) **Fluent comparator** — call a method without arguments to get a typed
 *      comparator object, then chain e.g. `.greaterThan(100)`.
 *
 * Example
 * -------
 * ```ts
 * // List topic messages with sequenceNumber >= 10 and a timestamp window:
 * const q = new TopicMessagesListQueryBuilder()
 *   .topicId("0.0.1234")
 *   .sequenceNumber().greaterThanOrEqualTo(10)
 *   .timestamp("gte:1700000000.0")
 *   .timestamp("lt:1700000100.0")
 *   .order("asc")
 *   .limit(25)
 *   .build();
 * ```
 */

/* =========================================================
 * /api/v1/topics/{topicId}  (ONE)
 *   - topicId (request EntityId)
 *   - useCache
 * ========================================================= */

/**
 * Builder for **GET `/api/v1/topics/{topicId}`** (single topic).
 *
 * Features
 * --------
 * - Requires a `topicId` in a Mirror Node request-ID form (`"num"`, `"realm.num"`, or `"shard.realm.num"`).
 * - Optional `useCache` flag permitting the resource layer to return a cached response.
 */
export class TopicOneQueryBuilder {
	private _topicId?: string;
	private _useCache?: boolean;

	/**
	 * Set the required `topicId` path parameter.
	 *
	 * @param id Hedera request EntityId (e.g. `"1234"`, `"0.1234"`, or `"0.0.1234"`).
	 * @returns this
	 * @throws ValidationError if the value is not a valid EntityId.
	 */
	topicId(id: string) {
		validateTopicId(id);
		this._topicId = id;
		return this;
	}

	/**
	 * Hint that the result may be served from cache (if supported downstream).
	 *
	 * @param flag Enable/disable cached reads for this request.
	 * @returns this
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the query for **topics.one**.
	 *
	 * @returns a `TopicOneQuery` object consumable by the resource layer.
	 * @throws ValidationError if `topicId` was not provided.
	 */
	build(): TopicOneQuery {
		if (!this._topicId) throw new ValidationError("topicId is required for topics.one()");
		return { topicId: this._topicId, useCache: this._useCache };
	}
}

/* =========================================================
 * /api/v1/topics/{topicId}/messages  (LIST)
 *   - topicId (request EntityId)
 *   - encoding: case-insensitive 'base64' | 'utf8' | 'utf-8'
 *   - sequenceNumber: int or comparator (eq|gt|gte|lt|lte)
 *   - timestamp: single or multiple (eq|gt|gte|lt|lte or exact)
 *   - order, limit
 * ========================================================= */

/**
 * Builder for **GET `/api/v1/topics/{topicId}/messages`** (list of messages).
 *
 * Supported filters
 * -----------------
 * - `topicId` — required (request EntityId shorthand or full form).
 * - `encoding` — case-insensitive `"base64"`, `"utf8"`, or `"utf-8"`; spelling is preserved.
 * - `sequenceNumber` — positive integer or comparator (except `ne`):
 *   - **Direct**: `.sequenceNumber(100)` or `.sequenceNumber("gte:100")`
 *   - **Fluent**: `.sequenceNumber().greaterThanOrEqualTo(100)`
 * - `timestamp` — exact `"s.ns"` or comparator(s) `"op:s.ns"`, appended via
 *   `.timestamp(...)` calls; to build comparator strings, use `.timestamp()`.
 * - `order` — `"asc"` or `"desc"`.
 * - `limit` — number or `"default"` / `"max"`.
 *
 * Notes
 * -----
 * - Multiple `timestamp` calls append multiple filters; the mapper keeps them in order.
 */
export class TopicMessagesListQueryBuilder {
	private _topicId?: string;
	private _encoding?: TopicMessageEncoding;
	private _sequenceNumbers: IntegerFilter[] = [];
	private _timestamps: NoNeTimestampFilter[] = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Set the required `topicId` path parameter.
	 *
	 * @param id Hedera request EntityId.
	 * @returns this
	 * @throws ValidationError if not a valid EntityId.
	 */
	topicId(id: string) {
		validateTopicId(id);
		this._topicId = id;
		return this;
	}

	/**
	 * Select message encoding for the payload returned by the Mirror Node.
	 *
	 * @param enc `"base64"`, `"utf8"`, or `"utf-8"`, case-insensitively.
	 * @returns this
	 * @throws ValidationError if the encoding is unsupported.
	 */
	encoding(enc: TopicMessageEncoding) {
		validateEncoding(enc);
		this._encoding = enc;
		return this;
	}

	/**
	 * Filter by `sequenceNumber`.
	 *
	 * Overloads:
	 * - **Direct**: `.sequenceNumber(100)` or `.sequenceNumber("gt:50")`
	 * - **Fluent**: `.sequenceNumber().greaterThan(50)`
	 *
	 * @returns this or a fluent comparator builder when called without arguments.
	 * @throws ValidationError if the value/comparator is invalid.
	 */
	sequenceNumber(value: IntegerFilter | readonly IntegerFilter[]): this;
	sequenceNumber(): ComparatorApi<IntegerValue, this, NoNeComparatorOps>;
	sequenceNumber(value?: IntegerFilter | readonly IntegerFilter[]) {
		if (value !== undefined) {
			const next = appendValues(this._sequenceNumbers, value);
			validateIntegerFilters(next, "sequenceNumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }, 100);
			this._sequenceNumbers = next;
			return this;
		}
		return createComparator<IntegerValue, this, NoNeComparatorOps>(this, (op, v) => {
			validatePositiveInt64(v, "sequenceNumber");
			const next = [...this._sequenceNumbers, `${op}:${String(v)}` as IntegerFilter];
			validateIntegerFilters(next, "sequenceNumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }, 100);
			this._sequenceNumbers = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Build a comparator for timestamp: `eq|gt|gte|lt|lte` (`ne` is not supported).
	 *
	 * Example:
	 * ```ts
	 * .timestamp().greaterThan("1700000000")
	 * .timestamp().lessThanOrEqualTo("1700000100.5")
	 * ```
	 *
	 * @returns a fluent comparator builder; chain then return to the parent builder.
	 */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<ExactTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter): ComparatorApi<ExactTimestamp, this, NoNeComparatorOps> | this {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value], NO_NE_COMPARATOR_OPERATORS);
			return this;
		}

		return createComparator<ExactTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			this._timestamps = validateTimestampFilters(
				[...this._timestamps, `${op}:${String(v)}` as NoNeTimestampFilter],
				NO_NE_COMPARATOR_OPERATORS
			);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Sort order.
	 *
	 * @param v `"asc"` or `"desc"`.
	 * @returns this
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint.
	 *
	 * @param v Number, or `"default"` / `"max"` (resolved later per provider).
	 * @returns this
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the message list query.
	 *
	 * @returns a `TopicMessagesListQuery` for the resource layer.
	 * @throws ValidationError if `topicId` was not provided.
	 */
	build(): TopicMessagesListQuery {
		if (!this._topicId) throw new ValidationError("topicId is required for topics.messages()");
		let ts: TopicMessagesListQuery["timestamp"];
		if (this._timestamps.length === 1) ts = this._timestamps[0];
		else if (this._timestamps.length > 1) ts = this._timestamps.slice();

		return {
			topicId: this._topicId,
			encoding: this._encoding,
			sequenceNumber: oneOrArray(this._sequenceNumbers),
			timestamp: ts,
			order: this._order,
			limit: this._limit,
		};
	}
}

/* =========================================================
 * /api/v1/topics/{topicId}/messages/{sequenceNumber}  (ONE)
 *   - topicId (request EntityId)
 *   - sequenceNumber: positive int
 *   - useCache
 * ========================================================= */

/**
 * Builder for **GET `/api/v1/topics/{topicId}/messages/{sequenceNumber}`** (single message by sequence).
 *
 * Rules
 * -----
 * - Requires both `topicId` (request EntityId) and `sequenceNumber` (positive integer).
 * - Optional `useCache` flag permitting a cached read.
 */
export class TopicMessageBySequenceQueryBuilder {
	private _topicId?: string;
	private _seq?: IntegerValue;
	private _useCache?: boolean;

	/**
	 * Set the required `topicId` path parameter.
	 * @param id Hedera request EntityId.
	 * @returns this
	 * @throws ValidationError if not a valid EntityId.
	 */
	topicId(id: string) {
		validateTopicId(id);
		this._topicId = id;
		return this;
	}

	/**
	 * Set the required `sequenceNumber`.
	 *
	 * @param v Positive integer (string or number).
	 * @returns this
	 * @throws ValidationError if not a positive integer.
	 */
	sequenceNumber(v: IntegerValue) {
		validatePositiveInt64(v, "sequenceNumber");
		this._seq = v;
		return this;
	}

	/**
	 * Hint that this request can use cache downstream.
	 *
	 * @param flag Enable/disable cached reads for this request.
	 * @returns this
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the single-message-by-sequence query.
	 *
	 * @returns a `TopicMessageBySequenceQuery` for the resource layer.
	 * @throws ValidationError if `topicId` or `sequenceNumber` were not set.
	 */
	build(): TopicMessageBySequenceQuery {
		if (!this._topicId) throw new ValidationError("topicId is required for topics.messageBySequence()");
		if (this._seq === undefined) throw new ValidationError("sequenceNumber is required for topics.messageBySequence()");
		return { topicId: this._topicId, sequenceNumber: this._seq, useCache: this._useCache };
	}
}

/* =========================================================
 * /api/v1/topics/messages/{timestamp}  (ONE)
 *   - timestamp: exact seconds with an optional fractional part (no comparator)
 *   - useCache
 * ========================================================= */

/**
 * Builder for **GET `/api/v1/topics/messages/{timestamp}`** (single message by exact timestamp).
 *
 * Rules
 * -----
 * - Requires exact seconds with an optional fractional part. No comparator prefix.
 * - Optional `useCache` flag permitting a cached read.
 *
 * Tip
 * ---
 * The exactness is enforced both here and in the mapper so invalid values fail
 * consistently for DSL and object-query callers.
 */
export class TopicMessageByTimestampQueryBuilder {
	private _timestamp?: ExactTimestamp;
	private _useCache?: boolean;

	/**
	 * Set an exact consensus timestamp (e.g. `"1700000000.000000123"`).
	 *
	 * @param ts Exact seconds as a string/number, optionally including a fractional part.
	 * @returns this
	 */
	timestamp(ts: ExactTimestamp) {
		validateTimestampValue(ts);
		this._timestamp = ts;
		return this;
	}

	/**
	 * Hint that this request may use a cache layer.
	 *
	 * @param flag Enable/disable cached reads for this request.
	 * @returns this
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the single-message-by-timestamp query.
	 *
	 * @returns a `TopicMessageByTimestampQuery` for the resource layer.
	 * @throws ValidationError if `timestamp` was not provided.
	 */
	build(): TopicMessageByTimestampQuery {
		if (this._timestamp === undefined) throw new ValidationError("timestamp is required for topics.messageByTimestamp()");
		return { timestamp: String(this._timestamp), useCache: this._useCache };
		// Exact format is verified again by the mapper (validateTimestampExact).
	}
}
