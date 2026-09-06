// src/resources/schedules/mapper.ts

import type { SchedulesListQuery, SchedulesOneQuery } from "../../types";
import { assertAllowedObjectKeys, validateEntityIdOrEvmFilters, validateOptionalBoolean, validateOrder, validateScheduleId } from "../../core/utils";
import { ValidationError } from "../../core/errors";

/**
 * Maps high‑level **Schedules** queries to the exact query parameters expected by the
 * Mirror Node REST API. This module performs **pure transformation + validation** only:
 * no HTTP calls, paging, or caching logic lives here.
 *
 * Why a mapper?
 * -------------
 * Keeping all field validation and parameter naming in one place guarantees the
 * same behavior whether a query is provided via:
 *
 * - a plain object (legacy style), or
 * - the typed DSL builders.
 *
 * Error model
 * -----------
 * - Invalid inputs throw {@link ValidationError} with clear, user‑facing messages
 *   (e.g., malformed EntityId or invalid comparator).
 *
 * Returned shapes
 * ---------------
 * - List endpoints return a plain params object.
 * - Single‑item endpoints can also return a `cacheKey` for optional read‑through caching.
 */
export class SchedulesMapper {
	/**
	 * Normalize and validate `GET /api/v1/schedules` list queries.
	 *
	 * Mapped parameters
	 * -----------------
	 * - `accountId`  → `"account.id"`
	 *   - Accepts numeric EntityIds or EVM addresses, with optional comparator prefixes
	 *     like `"gt:0.0.50"`, `"lte:0.0.999"`, `"ne:0.0.2"`.
	 * - `scheduleId` → `"schedule.id"`
	 *   - Same generic numeric/EVM filter rules as `accountId`.
	 * - `order`      → `"order"` (server default is ascending when omitted).
	 * - `limit`      → `"limit"` (numeric value is clamped later by the builder based on provider defaults).
	 *
	 * Validation
	 * ----------
	 * - Comparator operators and their numeric-ID/EVM payloads are both validated.
	 * - Bare values may use a numeric request ID or EVM-address form.
	 *
	 * @param q Optional object form query.
	 * @returns Plain params object suitable for the transport layer.
	 * @throws {ValidationError} If any identifier or comparator is invalid.
	 *
	 * @example
	 * ```ts
	 * const p = SchedulesMapper.list({
	 *   accountId: "gte:0.0.100",
	 *   scheduleId: "0.0.5000",
	 *   order: "desc",
	 *   limit: 25
	 * });
	 * // -> { "account.id": "gte:0.0.100", "schedule.id": "0.0.5000", order: "desc", limit: 25 }
	 * ```
	 */
	static list(q?: SchedulesListQuery) {
		const p: Record<string, any> = {};
		if (q === undefined) return p;
		assertAllowedObjectKeys(q, ["accountId", "scheduleId", "limit", "order"], "schedules list query");

		if (q.accountId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.accountId, "account.id");
			p["account.id"] = Array.isArray(q.accountId) ? values : values[0];
		}

		if (q.scheduleId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.scheduleId, "schedule.id");
			p["schedule.id"] = Array.isArray(q.scheduleId) ? values : values[0];
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			p["order"] = q.order;
		}
		return p;
	}

	/**
	 * Normalize and validate `GET /api/v1/schedules/{scheduleId}` single‑item queries.
	 *
	 * Requirements
	 * ------------
	 * - `scheduleId` is **required** and accepts request-ID shorthand or the full form.
	 *
	 * Returns
	 * -------
	 * - `{ id, cacheKey }` where `id` is safe to place in the path segment and
	 *   `cacheKey` is a deterministic key if a cache layer is used by the caller.
	 *
	 * @param q Object form query for `/schedules/{id}`.
	 * @returns `{ id, cacheKey }`
	 * @throws {ValidationError} If `scheduleId` is missing or invalid.
	 *
	 * @example
	 * ```ts
	 * const { id, cacheKey } = SchedulesMapper.one({ scheduleId: "0.0.12345" });
	 * // id       -> "0.0.12345"
	 * // cacheKey -> "schedules:0.0.12345"
	 * ```
	 */
	static one(q: SchedulesOneQuery) {
		assertAllowedObjectKeys(q, ["scheduleId", "useCache"], "schedule query");
		validateOptionalBoolean(q.useCache, "useCache");
		if (!q?.scheduleId) {
			throw new ValidationError("scheduleId is required");
		}
		validateScheduleId(q.scheduleId);
		const id = q.scheduleId;
		const cacheKey = `schedules:${id}`;
		return { id, cacheKey };
	}
}
