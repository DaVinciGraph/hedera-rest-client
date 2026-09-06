// src/resources/transactions/mapper.ts

import type { TransactionsListQuery, TransactionByIdQuery } from "../../types";

import {
	assertAllowedObjectKeys,
	validateEntityIdOrEvmFilters,
	validateOptionalBoolean,
	validateOrder,
	validateTimestampFilters,
	validateTransactionIdOrHederaHash,
	validateNonNegativeInt32,
	validateRepeatedValues,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";

/**
 * TransactionsMapper
 * ------------------
 * Converts **typed high‑level queries** for the Transactions resource into the
 * exact REST query parameters expected by the Hedera Mirror Node.
 *
 * Design
 * ------
 * - Performs **validation** early (entity IDs, comparator strings, timestamps, etc.).
 * - Produces **stable, predictable param objects**.
 * - Keeps **all I/O out** of this layer; networking and caching are handled by the builder.
 *
 * REST parameter mapping (summary)
 * --------------------------------
 * | Query field        | REST key         | Accepted forms                                                                          |
 * |--------------------|------------------|------------------------------------------------------------------------------------------|
 * | accountId          | `account.id`     | `"0.0.x"` or comparator string (`eq|ne|gt|gte|lt|lte:0.0.x`)                            |
 * | timestamp          | `timestamp`      | Exact `"seconds.nanos"` or comparator; single value or array                            |
 * | transactiontype    | `transactiontype`| Pass‑through (enum/string)                                                               |
 * | result             | `result`         | Case-insensitive `"success"` \| `"fail"` (input casing preserved)                       |
 * | type               | `type`           | Case-insensitive `"credit"` \| `"debit"` (input casing preserved)                       |
 * | order              | `order`          | `"asc"` \| `"desc"`                                                                       |
 * | limit              | `limit`          | Number or symbolic upstream value (resolved by builder)                                   *
 *
 * *Limit values such as `"default"` or `"max"` are resolved per‑network by the builder.
 *
 * Error surface
 * -------------
 * Throws {@link ValidationError} with clear messages when input is malformed.
 *
 * Examples
 * --------
 * ```ts
 * // Build params for listing transactions:
 * const params = TransactionsMapper.list({
 *   accountId: "gte:0.0.1000",
 *   timestamp: ["gte:1700000000.000000000", "lt:1700003600.000000000"],
 *   result: "success",
 *   order: "asc",
 *   limit: 25
 * });
 * // → { "account.id": "gte:0.0.1000", timestamp: [...], result: "success", order: "asc", limit: 25 }
 *
 * // Build path + params for a single transaction:
 * const { id, params, cacheKey } = TransactionsMapper.one({
 *   transactionId: "0.0.1000-1700000000-000000000",
 *   nonce: 1,
 *   scheduled: false,
 *   useCache: true
 * });
 * // id → "0.0.1000-1700000000-000000000"
 * // params → { nonce: 1, scheduled: false }
 * // cacheKey → "tx:0.0.1000-1700000000-000000000:1:false"
 * ```
 */
export class TransactionsMapper {
	/* -----------------------------
     /api/v1/transactions (list)
     ----------------------------- */

	/**
	 * Map an object‑style list query to REST parameters.
	 *
	 * @param q Optional list query.
	 * @returns A plain object of REST query parameters (safe to pass to the HTTP layer).
	 * @throws {ValidationError} If any field is invalid.
	 */
	static list(q?: TransactionsListQuery) {
		const p: Record<string, any> = {};
		if (q === undefined) return p;
		assertAllowedObjectKeys(q, ["accountId", "timestamp", "transactiontype", "result", "type", "limit", "order"], "transactions list query");

		// account.id: plain entity id or comparator string
		if (q.accountId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.accountId, "account.id");
			p["account.id"] = values.length === 1 ? values[0] : values;
		}

		// timestamp: single value or array; each validated
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			p["timestamp"] = arr;
		}

		// transactiontype: pass‑through (enum or string)
		if (q.transactiontype !== undefined) {
			if (typeof q.transactiontype !== "string") throw new ValidationError("transactiontype must be a string");
			p["transactiontype"] = q.transactiontype;
		}

		// result: case-insensitive "success" | "fail"; preserve caller casing
		if (q.result !== undefined) {
			const ok = typeof q.result === "string" && (q.result.toLowerCase() === "success" || q.result.toLowerCase() === "fail");
			if (!ok) throw new ValidationError(`result must be 'success' or 'fail'`);
			p["result"] = q.result;
		}

		// type: case-insensitive "credit" | "debit"; preserve caller casing
		if (q.type !== undefined) {
			const ok = typeof q.type === "string" && (q.type.toLowerCase() === "credit" || q.type.toLowerCase() === "debit");
			if (!ok) throw new ValidationError(`type must be 'credit' or 'debit'`);
			p["type"] = q.type;
		}

		// order/limit: forwarded; limit may be symbolic and is resolved by the builder
		if (q.limit !== undefined) p["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			p["order"] = q.order;
		}

		return p;
	}

	/* -----------------------------------------------
     /api/v1/transactions/{transactionId} (single)
     ----------------------------------------------- */

	/**
	 * Map a single‑transaction query to `{ id, params, cacheKey }`.
	 *
	 * Validation
	 * ----------
	 * - `transactionId` must be a valid Mirror Node transaction id string.
	 * - Every `nonce` (if present) must be a non-negative int32.
	 * - Every `scheduled` occurrence (if present) must be boolean.
	 *
	 * @param q Single transaction query.
	 * @returns `{ id, params, cacheKey }` where:
	 *  - `id` is the path segment,
	 *  - `params` contains `nonce` and/or `scheduled` if provided,
	 *  - `cacheKey` is a stable key suitable for read‑through caches.
	 * @throws {ValidationError} If any field is invalid.
	 */
	static byId(q: TransactionByIdQuery) {
		assertAllowedObjectKeys(q, ["transactionId", "nonce", "scheduled", "useCache"], "transaction query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTransactionIdOrHederaHash(q.transactionId);

		const p: Record<string, any> = {};

		let nonce: number | undefined;

		// The legacy parser validates every occurrence, then uses the last nonce.
		if (q.nonce !== undefined) {
			const values = validateRepeatedValues(
				q.nonce,
				"nonce",
				(value) => {
					if (typeof value !== "number") throw new ValidationError("nonce must be supplied as a number");
					validateNonNegativeInt32(value, "nonce");
				},
				100
			);
			nonce = values[values.length - 1];
			p["nonce"] = nonce;
		}

		let scheduled: boolean | undefined;

		// The legacy parser validates every occurrence, then uses the last flag.
		// Preserve the complete sequence for the transport while deriving cache
		// identity from the effective final value.
		if (q.scheduled !== undefined) {
			const values = validateRepeatedValues(
				q.scheduled,
				"scheduled",
				(value) => {
					if (typeof value !== "boolean") throw new ValidationError("scheduled must be a boolean");
				},
				100
			);
			scheduled = values[values.length - 1];
			p["scheduled"] = Array.isArray(q.scheduled) ? values : values[0];
		}

		const cacheKey = `tx:${q.transactionId}:${nonce ?? ""}:${scheduled ?? ""}`;
		return { id: q.transactionId, params: p, cacheKey };
	}
}
