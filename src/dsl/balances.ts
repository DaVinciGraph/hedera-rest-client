// src/dsl/balances.ts

import { AllComparatorOps, ComparatorApi, createComparator } from "./core";
import type { AllIntegerFilter, IntegerValue, LimitValue, Order, HederaTimestamp } from "../types";
import { validateAccountIdFilters, validateIntegerFilters, validateOrder, validateString, validateTimestampFilters } from "../core/utils";
import { ValidationError } from "../core/errors";

function appendValues<T>(current: readonly T[], value: T | readonly T[]): T[] {
	if (Array.isArray(value) && value.length === 0) throw new ValidationError("Filter arrays must contain at least one value");
	return [...current, ...(Array.isArray(value) ? (value as readonly T[]) : [value as T])];
}

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

/**
 * Fluent builder for **GET `/api/v1/balances`**.
 *
 * This DSL mirrors the wire format accepted by Mirror Node while giving you a
 * chainable, type‑safe API. It validates inputs early (entity IDs, timestamps)
 * and exposes only the comparator methods that endpoint semantics allow.
 *
 * ### What it builds
 * - A plain `params` object ready to hand to the resource layer/HTTP client.
 * - The raw `limit` you requested (e.g. `"default"` or `"max"`), which the
 *   resource layer will later clamp to the provider/network limits.
 *
 * ### Example
 * ```ts
 * const q = new BalancesListQueryBuilder()
 *   .accountId().greaterThan("0.0.100")       // => account.id=gt:0.0.100
 *   .accountBalance().lessThanOrEqualTo(500)  // => account.balance=lte:500
 *   .timestamp().greaterThanOrEqualTo("1700") // => timestamp[]=gte:1700
 *   .order("desc")
 *   .limit("default")
 *   .build();
 *
 * // q.params is a plain object suitable for the resource/transport layer.
 * // q.limit preserves the symbolic limit so the caller can resolve to a number.
 * ```
 */
export class BalancesListQueryBuilder {
	private _params: Record<string, unknown> = {};
	private _accountIds: string[] = [];
	private _accountBalances: Array<string | number> = [];
	private _timestamps: Array<string | number> = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/**
	 * Filter by `account.id`.
	 *
	 * You can pass a direct value:
	 * ```ts
	 * .accountId("0.0.123")
	 * // -> account.id = "0.0.123" (implicit equality)
	 * ```
	 *
	 * Or call without arguments to access comparators:
	 * ```ts
	 * .accountId().greaterThan("0.0.100")
	 * // -> account.id = "gt:0.0.100"
	 * ```
	 */
	accountId(value: string | readonly string[]): this;
	accountId(): ComparatorApi<string, this, AllComparatorOps>;
	accountId(value?: string | readonly string[]) {
		if (value !== undefined) {
			const next = appendValues(this._accountIds, value);
			validateAccountIdFilters(next);
			this._accountIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateAccountIdFilters(v);
			const filter = `${op}:${v}`;
			const next = [...this._accountIds, filter];
			validateAccountIdFilters(next);
			this._accountIds = next;
		});
	}

	/**
	 * Filter by `account.balance`.
	 *
	 * Pass a direct value to imply equality:
	 * ```ts
	 * .accountBalance(1_000_000) // -> "1000000"
	 * ```
	 *
	 * Or call without arguments to use comparators:
	 * ```ts
	 * .accountBalance().greaterThanOrEqualTo(1_000_000) // -> "gte:1000000"
	 * .accountBalance().lessThan("250")                 // -> "lt:250"
	 * ```
	 */
	accountBalance(value: AllIntegerFilter | readonly AllIntegerFilter[]): this;
	accountBalance(): ComparatorApi<IntegerValue, this, AllComparatorOps>;
	accountBalance(value?: AllIntegerFilter | readonly AllIntegerFilter[]) {
		if (value !== undefined) {
			const next = appendValues(this._accountBalances, value);
			validateIntegerFilters(next, "account.balance", { minimum: 0 });
			this._accountBalances = next;
			return this;
		}
		return createComparator<IntegerValue, this, AllComparatorOps>(this, (op, v) => {
			const filter = `${op}:${String(v)}`;
			const next = [...this._accountBalances, filter];
			validateIntegerFilters(next, "account.balance", { minimum: 0 });
			this._accountBalances = next;
		});
	}

	/**
	 * Filter by `account.publickey` (base64 string).
	 *
	 * ```ts
	 * .accountPublicKey("MCowBQYDK2VwAyEA…")
	 * ```
	 */
	accountPublicKey(publicKey: string) {
		validateString(publicKey, "accountPublicKey");
		this._params["account.publickey"] = publicKey;
		return this;
	}

	/**
	 * Filter by `timestamp`. Supports exact values and comparator chains.
	 *
	 * - Exact:
	 *   ```ts
	 *   .timestamp("1700000000.123456789")
	 *   ```
	 * - Comparator:
	 *   ```ts
	 *   .timestamp().greaterThan("1700000000")
	 *   .timestamp().lessThanOrEqualTo(1700000100)
	 *   ```
	 * - Comparator-as-string (also accepted):
	 *   ```ts
	 *   .timestamp("gte:1700000000")
	 *   ```
	 *
	 * You may call this multiple times to create an array of constraints. All
	 * values are validated.
	 */
	timestamp(value: HederaTimestamp): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, AllComparatorOps>;
	timestamp(value?: HederaTimestamp) {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value]);
			return this;
		}
		return createComparator<HederaTimestamp, this, AllComparatorOps>(this, (op, v) => {
			this._timestamps = validateTimestampFilters([...this._timestamps, `${op}:${String(v)}`]);
		});
	}

	/**
	 * Sort order.
	 *
	 * ```ts
	 * .order("asc")  // or "desc"
	 * ```
	 */
	order(order: Order) {
		validateOrder(order);
		this._order = order;
		return this;
	}

	/**
	 * Requested page size.
	 *
	 * Accepts:
	 * - a number (e.g. `25`)
	 * - `"default"` to use the provider/network default
	 * - `"max"` to request the provider/network maximum
	 *
	 * The resource layer resolves this symbolically and clamps to limits.
	 */
	limit(limit: LimitValue) {
		this._limit = limit;
		return this;
	}

	/**
	 * Produce the final query object.
	 *
	 * Returns a shape that the resource layer can use directly:
	 * ```ts
	 * {
	 *   params: { ... }, // plain querystring params
	 *   limit?: "default" | "max" | number
	 * }
	 * ```
	 *
	 * Notes:
	 * - `limit` is echoed so the caller can pass it through `resolveLimitValue`
	 *   against the current provider/network to obtain a numeric value.
	 * - Undefined fields are omitted.
	 */
	build(): { params: Record<string, unknown>; limit?: LimitValue } {
		const params: Record<string, unknown> = { ...this._params };
		const accountId = oneOrArray(this._accountIds);
		const accountBalance = oneOrArray(this._accountBalances.map(String));
		if (accountId !== undefined) params["account.id"] = accountId;
		if (accountBalance !== undefined) params["account.balance"] = accountBalance;
		if (this._timestamps.length > 0) params["timestamp"] = this._timestamps;
		if (this._order) params["order"] = this._order;
		if (this._limit !== undefined) params["limit"] = this._limit; // replaced later by resolved numeric limit
		return { params, limit: this._limit };
	}
}
