// src/dsl/transactions.ts

import { AllComparatorOps, ComparatorApi, createComparator } from "./core";
import {
	LimitValue,
	Order,
	TransactionTypes,
	TransactionsListQuery,
	TransactionByIdQuery,
	HederaTimestamp,
	TransactionResultFilter,
	TransferTypeFilter,
} from "../types";
import {
	validateBoolean,
	validateEntityIdOrEvmFilter,
	validateEntityIdOrEvmFilters,
	validateNonNegativeInt32,
	validateOrder,
	validateRepeatedValues,
	validateString,
	validateTransactionIdOrHederaHash,
	validateTimestampFilters,
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

function validateNonceValues(values: number | readonly number[]): number[] {
	return validateRepeatedValues(
		values,
		"nonce",
		(value) => {
			if (typeof value !== "number") throw new ValidationError("nonce must be supplied as a number");
			validateNonNegativeInt32(value, "nonce");
		},
		100
	);
}

function validateBooleanValues(values: boolean | readonly boolean[], name: string): boolean[] {
	return validateRepeatedValues(
		values,
		name,
		(value) => {
			if (typeof value !== "boolean") throw new ValidationError(`${name} must be a boolean`);
		},
		100
	);
}

/**
 * Transactions DSL
 * =================
 * Strongly‑typed, fluent builders for /api/v1/transactions endpoints.
 *
 * Goals
 * -----
 * - Provide a discoverable chainable API that mirrors the REST surface.
 * - Validate common mistakes early with clear error messages.
 * - Support **two ways to express comparators** for query fields:
 *   1) **Comparator-as-string** — e.g. `"gt:100"`, `"lte:200"`.
 *   2) **Fluent comparator** — call a method without arguments to receive a
 *      typed comparator object, then chain (e.g. `.greaterThan(100)`).
 *
 * Quick examples
 * --------------
 * ```ts
 * // List transactions for an account within a time window:
 * const q1 = new TransactionsListQueryBuilder()
 *   .accountId("0.0.1001")
 *   .timestamp("gte:1700000000.0")
 *   .timestamp("lt:1700000900.0")
 *   .order("desc")
 *   .limit("default")
 *   .build();
 *
 * // Same window built with the fluent comparator:
 * const q2 = new TransactionsListQueryBuilder()
 *   .accountId().notEqualTo("0.0.3")
 *   .timestamp().greaterThanOrEqualTo("1700000000.0")
 *   .timestamp().lessThan("1700000900.0")
 *   .transactionType("CRYPTOTRANSFER")
 *   .result("success")
 *   .build();
 *
 * // Fetch a single transaction:
 * const q3 = new TransactionByIdQueryBuilder()
 *   .transactionId("0.0.7-1700000000-000000123")
 *   .nonce(1)
 *   .scheduled(false)
 *   .useCache(true)
 *   .build();
 * ```
 */

/* ========================================================================== */
/* /api/v1/transactions (LIST)                                                */
/*   - accountId: EntityId OR comparator (eq|ne|gt|gte|lt|lte)                 */
/*   - timestamp: single or multiple (exact or comparator)                     */
/*   - transactiontype: TransactionTypes                                       */
/*   - result: 'success' | 'fail'                                              */
/*   - type: 'credit' | 'debit'                                                */
/*   - order, limit                                                            */
/* ========================================================================== */

/**
 * Builder for **GET `/api/v1/transactions`** (list).
 *
 * Supported filters
 * -----------------
 * - `accountId` — request entity ID (`"num"`, `"realm.num"`, or `"shard.realm.num"`),
 *   EVM address, or comparator string (e.g. `"gt:0.0.1000"`). When called without a value, it returns a fluent
 *   comparator restricted to **eq|ne|gt|gte|lt|lte**.
 * - `timestamp` — exact `"s.ns"` or comparator(s) (`"op:s.ns"`). You may call
 *   `.timestamp(...)` multiple times to append filters, or use `.timestamp()`
 *   for a fluent comparator builder.
 * - `transactionType` — `TransactionTypes` enum value or a pass‑through string.
 * - `result` — case-insensitive `"success"` or `"fail"` (input casing preserved).
 * - `transferType` — case-insensitive `"credit"` or `"debit"` (input casing preserved).
 * - `order` — `"asc"` or `"desc"`.
 * - `limit` — number, or `"default"` / `"max"` (resolved per provider later).
 */
export class TransactionsListQueryBuilder {
	private _accountIds: string[] = [];
	private _timestamps: Array<HederaTimestamp> = [];
	private _transactionType?: TransactionTypes;
	private _result?: TransactionResultFilter;
	private _transferType?: TransferTypeFilter;
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * `account.id` filter.
	 *
	 * Overloads
	 * ---------
	 * - **Direct**: `.accountId("0.0.1001")` or `.accountId("gte:0.0.3000")`
	 * - **Fluent**: `.accountId().greaterThanOrEqualTo("0.0.3000")`
	 *
	 * Examples
	 * --------
	 * ```ts
	 * .accountId("0.0.1001")
	 * .accountId().notEqualTo("0.0.2")
	 * ```
	 *
	 * @returns `this` when a value is provided; otherwise a typed comparator API.
	 * @throws ValidationError if the provided value is neither a valid EntityId
	 *         nor a valid comparator string.
	 */
	accountId(value: string | readonly string[]): this;
	accountId(): ComparatorApi<string, this, AllComparatorOps>;
	accountId(value?: string | readonly string[]) {
		if (value !== undefined) {
			const next = appendValues(this._accountIds, value);
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateEntityIdOrEvmFilter(v, "account.id");
			const filter = `${op}:${String(v)}`;
			const next = [...this._accountIds, filter];
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
		});
	}

	/**
	 * Fluent comparator builder for `timestamp`.
	 *
	 * Example
	 * -------
	 * ```ts
	 * .timestamp().greaterThanOrEqualTo("1700000000")
	 * .timestamp().lessThan("1700000900.5")
	 * ```
	 *
	 * @returns a typed comparator API (`eq|ne|gt|gte|lt|lte`). Chain, then control
	 *         returns to the parent builder.
	 */
	timestamp(value: HederaTimestamp): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, AllComparatorOps>;
	timestamp(value?: HederaTimestamp): ComparatorApi<string | number, this, AllComparatorOps> | this {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value]);
			return this;
		}

		return createComparator<string | number, this, AllComparatorOps>(this, (op, v) => {
			this._timestamps = validateTimestampFilters([...this._timestamps, `${op}:${String(v)}`]);
		});
	}

	/**
	 * Transaction type filter.
	 *
	 * @param t `TransactionTypes` enum value or a pass-through string.
	 * @returns this
	 */
	transactionType(t: TransactionTypes) {
		validateString(t, "transactiontype");
		this._transactionType = t;
		return this;
	}

	/**
	 * Result filter.
	 *
	 * @param v Case-insensitive `"success"` or `"fail"` (input casing is preserved).
	 * @returns this
	 */
	result(v: TransactionResultFilter) {
		if (typeof v !== "string" || (v.toLowerCase() !== "success" && v.toLowerCase() !== "fail")) {
			throw new ValidationError("result must be 'success' or 'fail'");
		}
		this._result = v;
		return this;
	}

	/**
	 * Transfer type filter.
	 *
	 * @param v Case-insensitive `"credit"` or `"debit"` (input casing is preserved).
	 * @returns this
	 */
	transferType(v: TransferTypeFilter) {
		if (typeof v !== "string" || (v.toLowerCase() !== "credit" && v.toLowerCase() !== "debit")) {
			throw new ValidationError("type must be 'credit' or 'debit'");
		}
		this._transferType = v;
		return this;
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
	 * @param v Number, or `"default"` / `"max"` (clamped later per provider).
	 * @returns this
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the list query.
	 *
	 * @returns a `TransactionsListQuery` object consumable by the resource layer.
	 *
	 * Notes
	 * -----
	 * - If more than one timestamp was provided, they are emitted as an array
	 *   (the mapper preserves order).
	 */
	build(): TransactionsListQuery {
		let ts: TransactionsListQuery["timestamp"];
		if (this._timestamps.length === 1) ts = this._timestamps[0];
		else if (this._timestamps.length > 1) ts = this._timestamps.slice();

		return {
			accountId: oneOrArray(this._accountIds),
			timestamp: ts,
			transactiontype: this._transactionType,
			result: this._result,
			type: this._transferType,
			order: this._order,
			limit: this._limit,
		};
	}
}

/* ========================================================================== */
/* /api/v1/transactions/{transactionId} (ONE)                                 */
/*   - transactionId: required, TransactionIdStr or 48-byte transaction hash */
/*   - nonce: non-negative int32                                               */
/*   - scheduled: one to 100 repeated booleans                                */
/*   - useCache: boolean                                                       */
/* ========================================================================== */

/**
 * Builder for **GET `/api/v1/transactions/{transactionId}`** (single transaction).
 *
 * Rules
 * -----
	 * - `transactionId` is **required** and accepts a valid `TransactionIdStr`
	 *   (`"0.0.x-<seconds>-<nanos>"`) or a 48-byte hex/Base64/Base64URL hash.
 * - `nonce` is optional and must be a non-negative 32-bit integer if provided.
 * - `scheduled` accepts one to 100 `true`/`false` occurrences.
 * - `useCache` optionally permits the resource layer to return a cached response.
 */
export class TransactionByIdQueryBuilder {
	private _transactionId?: string;
	private _nonces: number[] = [];
	private _scheduled: boolean[] = [];
	private _useCache?: boolean;

	/**
	 * Set the required `transactionId` path parameter.
	 *
	 * @param id Transaction ID, or its 48-byte hex/Base64/Base64URL hash.
	 * @returns this
	 * @throws ValidationError if the format is invalid.
	 */
	transactionId(id: string) {
		validateTransactionIdOrHederaHash(id);
		this._transactionId = id;
		return this;
	}

	/**
	 * Set the `nonce` filter.
	 *
	 * @param v Non-negative 32-bit integer.
	 * @returns this
	 * @throws ValidationError if outside the non-negative int32 range.
	 */
	nonce(v: number | readonly number[]) {
		const next = appendValues(this._nonces, v);
		validateNonceValues(next);
		this._nonces = next;
		return this;
	}

	/**
	 * Filter by scheduled status.
	 *
	 * Repeated calls and arrays append occurrences in request order.
	 *
	 * @param flag One or more boolean flags (up to 100 occurrences).
	 * @returns this
	 */
	scheduled(flag: boolean | readonly boolean[]) {
		const next = appendValues(this._scheduled, flag);
		this._scheduled = validateBooleanValues(next, "scheduled");
		return this;
	}

	/**
	 * Hint that the result may be served from cache (if supported).
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
	 * Finalize the single-transaction query.
	 *
	 * @returns a `TransactionByIdQuery` for the resource layer.
	 * @throws ValidationError if `transactionId` was not provided.
	 */
	build(): TransactionByIdQuery {
		if (!this._transactionId) throw new ValidationError("transactionId is required for transactions.byId()");
		return {
			transactionId: this._transactionId,
			nonce: oneOrArray(this._nonces),
			scheduled: oneOrArray(this._scheduled),
			useCache: this._useCache,
		};
	}
}
