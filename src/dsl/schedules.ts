// src/dsl/schedules.ts

import { AllComparatorOps, ComparatorApi, createComparator } from "./core";
import type { LimitValue, Order, SchedulesListQuery, SchedulesOneQuery } from "../types";
import { validateBoolean, validateEntityIdOrEvmFilters, validateOrder, validateScheduleId } from "../core/utils";
import { ValidationError } from "../core/errors";

/**
 * Schedules DSL
 * =============
 * Strongly‑typed, fluent builders for /api/v1/schedules endpoints.
 *
 * Why this exists
 * ---------------
 * - Provide a small, discoverable, chainable API that mirrors the REST surface.
 * - Validate inputs early (entity IDs, comparator strings) with helpful errors.
 * - Support both:
 *   - **Direct values** (equality or comparator-as-string like `"gt:…"`)
 *   - **Fluent comparators** via `.field().greaterThan(...)` etc.
 *
 * What these builders return
 * --------------------------
 * - `.build()` produces a plain query object consumed by the resource layer.
 * - No network calls happen here; there is no hidden state beyond what you set.
 *
 * Quick example
 * -------------
 * ```ts
 * // GET /api/v1/schedules?account.id=gte:0.0.100&order=desc&limit=25
 * const q = new SchedulesListQueryBuilder()
 *   .accountId().greaterThanOrEqualTo("0.0.100")
 *   .order("desc")
 *   .limit(25)
 *   .build();
 * ```
 */

/* -------------------------------------------------
 * /api/v1/schedules (list; never cached)
 *   - accountId: numeric EntityId/EVM filter (eq|ne|gt|gte|lt|lte)
 *   - scheduleId: numeric EntityId/EVM filter (eq|ne|gt|gte|lt|lte)
 *   - order, limit
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/schedules`** (list).
 *
 * Supported filters
 * -----------------
 * - `accountId` — A numeric EntityId or EVM address, optionally comparator-prefixed
 *   like `"gt:0.0.10"`, `"lte:0.0.500"`, or `"ne:0.0.123"`.
 * - `scheduleId` — Same generic numeric/EVM filter rules as `accountId`.
 * - `order` — `"asc"` or `"desc"`.
 * - `limit` — number or the symbols `"default"` / `"max"` (resolved later per network).
 *
 * Two ways to express comparators
 * -------------------------------
 * - **Comparator string**: `.accountId("gte:0.0.100")`
 * - **Fluent API**: `.accountId().greaterThanOrEqualTo("0.0.100")`
 */
export class SchedulesListQueryBuilder {
	private _accountIds: string[] = [];
	private _scheduleIds: string[] = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Filter by `account.id`.
	 *
	 * **Direct usage**
	 * - Pass a numeric request ID or EVM address.
	 * - Or a comparator string: `"gt:0.0.10"`, `"ne:0.0.50"`, …
	 *
	 * **Fluent usage**
	 * - Call with no argument, then chain a comparator:
	 *   ```ts
	 *   .accountId().lessThan("0.0.200")
	 *   .accountId().notEqualTo("0.0.42")
	 *   ```
	 *
	 * @param value Optional direct value or comparator string.
	 * @returns The builder (for chaining) or a comparator API when called without arguments.
	 * @throws ValidationError if a direct value is provided and fails validation.
	 */
	accountId(value: string | readonly string[]): this;
	accountId(): ComparatorApi<string, this, AllComparatorOps>;
	accountId(value?: string | readonly string[]) {
		if (value !== undefined) {
			if (Array.isArray(value) && value.length === 0) throw new ValidationError("account.id must contain at least one value");
			const next = [...this._accountIds, ...(Array.isArray(value) ? value : [value])];
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateEntityIdOrEvmFilters(v, "account.id");
			const next = [...this._accountIds, `${op}:${v}`];
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
		});
	}

	/**
	 * Filter by `schedule.id`.
	 *
	 * **Direct usage**
	 * - Numeric request ID or EVM address.
	 * - Comparator string: `"lte:0.0.6000"`, `"ne:0.0.42"`, …
	 *
	 * **Fluent usage**
	 * - `.scheduleId().greaterThan("0.0.100")`
	 *
	 * @param value Optional direct value or comparator string.
	 * @returns The builder (for chaining) or a comparator API when called without arguments.
	 * @throws ValidationError if a direct value is provided and fails validation.
	 */
	scheduleId(value: string | readonly string[]): this;
	scheduleId(): ComparatorApi<string, this, AllComparatorOps>;
	scheduleId(value?: string | readonly string[]) {
		if (value !== undefined) {
			if (Array.isArray(value) && value.length === 0) throw new ValidationError("schedule.id must contain at least one value");
			const next = [...this._scheduleIds, ...(Array.isArray(value) ? value : [value])];
			validateEntityIdOrEvmFilters(next, "schedule.id");
			this._scheduleIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateEntityIdOrEvmFilters(v, "schedule.id");
			const next = [...this._scheduleIds, `${op}:${v}`];
			validateEntityIdOrEvmFilters(next, "schedule.id");
			this._scheduleIds = next;
		});
	}

	/**
	 * Sort order for the response.
	 * @param v `"asc"` or `"desc"`.
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint.
	 * - A number is used as-is (later clamped per network).
	 * - `"default"` / `"max"` are resolved by the resource layer.
	 * @param v limit value.
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Produce the final plain query object that the resource layer understands.
	 * @returns `SchedulesListQuery` with your selected filters.
	 */
	build(): SchedulesListQuery {
		const accountId = this._accountIds.length === 0 ? undefined : this._accountIds.length === 1 ? this._accountIds[0] : [...this._accountIds];
		const scheduleId = this._scheduleIds.length === 0 ? undefined : this._scheduleIds.length === 1 ? this._scheduleIds[0] : [...this._scheduleIds];
		return {
			accountId,
			scheduleId,
			order: this._order,
			limit: this._limit,
		};
	}
}

/* -------------------------------------------------
 * /api/v1/schedules/{scheduleId} (single; cacheable)
 *   - scheduleId: request EntityId
 *   - useCache: boolean
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/schedules/{scheduleId}`** (single).
 *
 * - Requires a `scheduleId` in shorthand or full request form.
 * - Supports a `useCache` flag permitting a cached read downstream.
 *
 * Example
 * -------
 * ```ts
 * const q = new SchedulesOneQueryBuilder()
 *   .scheduleId("0.0.6000")
 *   .useCache(true)
 *   .build();
 * ```
 */
export class SchedulesOneQueryBuilder {
	private _scheduleId?: string;
	private _useCache?: boolean;

	/**
	 * Set the required path parameter `scheduleId`.
	 * @param id Request entity ID in the form `"num"`, `"realm.num"`, or `"shard.realm.num"`.
	 * @returns The builder (for chaining).
	 * @throws ValidationError if the value is not a valid EntityId.
	 */
	scheduleId(id: string) {
		validateScheduleId(id);
		this._scheduleId = id;
		return this;
	}

	/**
	 * Hint that the result can be cached by the resource layer.
	 * Builders do not perform caching themselves.
	 * @param flag Enable/disable cached reads for this request.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the query for the single schedule endpoint.
	 * @returns `SchedulesOneQuery` with `scheduleId` and optional `useCache`.
	 * @throws ValidationError if `scheduleId` was never provided.
	 */
	build(): SchedulesOneQuery {
		if (!this._scheduleId) {
			// Clear error to guide the caller to set the required path value.
			throw new ValidationError("scheduleId is required for schedules.one()");
		}
		return { scheduleId: this._scheduleId, useCache: this._useCache };
	}
}
