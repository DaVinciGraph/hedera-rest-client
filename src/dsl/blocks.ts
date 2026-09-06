// src/dsl/blocks.ts

import { AllComparatorOps, ComparatorApi, createComparator, NoNeComparatorOps } from "./core";
import type { BlockNumberFilter, BlockNumberValue, LimitValue, Order, HederaTimestamp } from "../types";
import {
	NO_NE_COMPARATOR_OPERATORS,
	validateBlockHashOrNumber,
	validateBlockNumberFilter,
	validateBlockNumberFilters,
	validateBoolean,
	validateOrder,
	validateTimestampFilters,
} from "../core/utils";
import { ValidationError } from "../core/errors";

/**
 * Fluent builder for **GET `/api/v1/blocks`** (list endpoint).
 *
 * This class lets you assemble a query using a readable, chainable API while
 * keeping the query perfectly aligned with what Mirror Node accepts. It
 * validates inputs as you build them and only emits plain JSON when you call
 * {@link build}.
 *
 * ### Supported filters
 * - `block.number` — accepts a bare value (implied equality), a comparator
 *   string like `"gt:100"`, or fluent comparators via `.blockNumber()...`.
 * - `timestamp` — accepts exact values or comparator expressions (including a
 *   sequence of them); values are validated by `validateTimestampFilter`.
 * - `order` — `"asc"` or `"desc"`.
 * - `limit` — number, `"default"`, or `"max"`. The symbolic value is preserved
 *   so the resource layer can clamp it to the provider/network limits.
 *
 * ### Quick examples
 * ```ts
 * // Exact block number and exact timestamp
 * const q1 = new BlocksListQueryBuilder()
 *   .blockNumber(10)
 *   .timestamp("1700000000.123456789")
 *   .order("desc")
 *   .limit("default")
 *   .build();
 *
 * // Comparator style (string input)
 * const q2 = new BlocksListQueryBuilder()
 *   .blockNumber("gt:100")
 *   .timestamp("lte:1700000100")
 *   .build();
 *
 * // Fluent comparator style
 * const q3 = new BlocksListQueryBuilder()
 *   .blockNumber().greaterThanOrEqualTo(500)  // => block.number=gte:500
 *   .timestamp().greaterThan(1700000000)      // => timestamp[]=gt:1700000000
 *   .timestamp().lessThanOrEqualTo("1700000500.5")
 *   .build();
 * ```
 */
export class BlocksListQueryBuilder {
	private _params: Record<string, unknown> = {};
	private _blockNumbers: Array<string | number> = [];
	private _timestamps: Array<string | number> = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/**
	 * Set or compare the `block.number` filter.
	 *
	 * You can:
	 * - Pass a number/string directly (server treats a bare value as equality):
	 *   ```ts
	 *   .blockNumber(123)              // => "123"
	 *   .blockNumber("gt:100")         // => "gt:100" (validated as a comparator string)
	 *   ```
	 * - Or call without an argument to use fluent comparators:
	 *   ```ts
	 *   .blockNumber().greaterThan(100) // => "gt:100"
	 *   ```
	 *
	 * @param value A block number (number or decimal string), or a comparator string like `"gt:100"`.
	 * @returns `this` for chaining, or a comparator API when called with no arguments.
	 */
	blockNumber(value: BlockNumberFilter | readonly BlockNumberFilter[]): this;
	blockNumber(): ComparatorApi<BlockNumberValue, this, NoNeComparatorOps>;
	blockNumber(value?: BlockNumberFilter | readonly BlockNumberFilter[]) {
		if (value !== undefined) {
			if (Array.isArray(value) && value.length === 0) throw new ValidationError("block.number must contain at least one value");
			const next = [...this._blockNumbers, ...(Array.isArray(value) ? value : [value])];
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
			return this;
		}
		return createComparator<BlockNumberValue, this, NoNeComparatorOps>(this, (op, v) => {
			validateBlockNumberFilter(v);
			const filter = `${op}:${String(v)}`;
			const next = [...this._blockNumbers, filter];
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Add one or more `timestamp` constraints.
	 *
	 * Supports both exact values and comparator expressions. You may call this
	 * multiple times; each call appends another constraint.
	 *
	 * Usage patterns:
	 * ```ts
	 * .timestamp("1700000000.123456789") // exact
	 * .timestamp("gte:1700000000")       // comparator-as-string
	 * .timestamp().lessThan(1700000100)  // fluent comparator
	 * ```
	 *
	 * Every value is validated with `validateTimestampFilter`.
	 *
	 * @param value An exact timestamp (`"s.ns"` or number) or a comparator string (e.g. `"gt:1700"`).
	 * @returns `this` for chaining, or a comparator API when called with no arguments.
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
	 *
	 * @param order `"asc"` or `"desc"`.
	 * @returns `this` for chaining.
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
	 * The symbolic value is preserved so the caller can later resolve and clamp
	 * it against the active provider/network limits.
	 *
	 * @param limit Numeric size, `"default"`, or `"max"`.
	 * @returns `this` for chaining.
	 */
	limit(limit: LimitValue) {
		this._limit = limit;
		return this;
	}

	/**
	 * Finalize the query.
	 *
	 * Returns a plain `params` object you can pass to the resource/HTTP layer,
	 * plus the raw `limit` you requested (so the caller can run it through
	 * `resolveLimitValue`).
	 *
	 * Undefined fields are omitted.
	 *
	 * @returns `{ params, limit }` where `params` is ready for the transport layer.
	 */
	build(): { params: Record<string, unknown>; limit?: LimitValue } {
		const params: Record<string, unknown> = { ...this._params };
		if (this._blockNumbers.length === 1) params["block.number"] = this._blockNumbers[0];
		else if (this._blockNumbers.length > 1) params["block.number"] = [...this._blockNumbers];
		if (this._timestamps.length > 0) params["timestamp"] = this._timestamps;
		if (this._order) params["order"] = this._order;
		if (this._limit !== undefined) params["limit"] = this._limit;
		return { params, limit: this._limit };
	}
}

/**
 * Fluent builder for **GET `/api/v1/blocks/{hashOrNumber}`** (single block).
 *
 * This builder is intentionally small. It only collects the path segment and an
 * optional cache hint; validation of the path value (hash vs number) is
 * performed by the mapping layer.
 *
 * ### Examples
 * ```ts
 * // Look up block #100
 * const q1 = new BlocksOneQueryBuilder()
 *   .hashOrNumber(100)
 *   .build();
 *
 * // Look up block by hash (string form)
 * const q2 = new BlocksOneQueryBuilder()
 *   .hashOrNumber("0xabc123…")
 *   .useCache(true)
 *   .build();
 * ```
 */
export class BlocksOneQueryBuilder {
	private _id?: string;
	private _useCache?: boolean;

	/**
	 * Set the `{hashOrNumber}` path segment.
	 *
	 * The value is converted to string and used as a path segment. The resource
	 * layer will URL‑encode it for transport and validate its semantics.
	 *
	 * @param v A block number (e.g. `123`) or a block hash (e.g. `"0x…"` or 64/96‑hex).
	 * @returns `this` for chaining.
	 */
	hashOrNumber(v: string | number) {
		validateBlockHashOrNumber(v);
		this._id = String(v);
		return this;
	}

	/**
	 * Hint that the result may be cached by the calling layer.
	 *
	 * This does not perform any caching by itself; it simply records the intent
	 * so the resource layer can use its configured cache adapter if enabled.
	 *
	 * @param flag `true` to allow a cached read, `false` to require a fresh response.
	 * @returns `this` for chaining.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Build the final object consumed by the resource layer.
	 *
	 * @throws {@link ValidationError} if `hashOrNumber` was never provided.
	 * @returns An object with `{ id, useCache? }`.
	 */
	build(): { id: string; useCache?: boolean } {
		if (!this._id) {
			throw new ValidationError("hashOrNumber is required for Blocks.one()");
		}
		return { id: this._id, useCache: this._useCache };
	}
}
