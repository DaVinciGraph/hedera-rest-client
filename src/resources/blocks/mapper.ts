// src/resources/blocks/mapper.ts

import type { BlocksListQuery, BlocksOneQuery } from "../../types";
import {
	assertAllowedObjectKeys,
	validateBlockHashOrNumber,
	validateBlockNumberFilters,
	validateOptionalBoolean,
	validateOrder,
	validateTimestampFilters,
} from "../../core/utils";

/**
 * Maps user-facing query objects for the **Blocks** resource to the exact
 * key/value pairs expected by the Mirror Node REST API.
 *
 * Responsibilities
 * ----------------
 * - **Field translation** (friendly keys → API keys):
 *   - `blockNumber` → `"block.number"`
 *   - `timestamp`   → `"timestamp"` (unchanged)
 *   - `order`       → `"order"` (unchanged)
 *   - `limit`       → `"limit"` (unchanged; clamped later)
 * - **Validation**:
 *   - Comparator strings must be well‑formed, e.g. `"gt:100"`, `"lte:1234"`.
 *   - Timestamps must be exact or comparator-based per API rules.
 *   - `hashOrNumber` must be a valid decimal block number, a `0x` hex block
 *     number, or a 32/48‑byte hash (with or without `0x`).
 *
 * This class is pure and side‑effect free. It does not execute HTTP requests,
 * apply paging, or perform caching. Those concerns are handled by the builder
 * layer.
 */
export class BlocksMapper {
	/**
	 * Convert a legacy object‑style list query into a parameter map.
	 *
	 * Accepted forms
	 * --------------
	 * - `blockNumber`: number or a comparator string, e.g. `"gt:100"`.
	 * - `timestamp`: single value or an array of:
	 *   - exact values like `"1700000000.123456789"` or `1700000000`
	 *   - comparator values like `"gte:1700000000"`, `"lt:1700003600"`
	 *
	 * @example List with comparators
	 * ```ts
	 * BlocksMapper.list({
	 *   blockNumber: "gt:100",
	 *   timestamp: ["gte:1700000000", "lt:1700003600"],
	 *   order: "desc",
	 *   limit: 25,
	 * });
	 * // → {
	 * //   "block.number": "gt:100",
	 * //   "timestamp": ["gte:1700000000", "lt:1700003600"],
	 * //   "order": "desc",
	 * //   "limit": 25
	 * // }
	 * ```
	 *
	 * @param q Optional {@link BlocksListQuery}. When omitted, returns `{}`.
	 * @returns Parameter map with API field names.
	 * @throws {@link import("../../core/errors").ValidationError}
	 *         If a comparator or timestamp is malformed.
	 */
	static list(q?: BlocksListQuery) {
		const p: Record<string, any> = {};
		if (q === undefined) return p;
		assertAllowedObjectKeys(q, ["blockNumber", "timestamp", "limit", "order"], "blocks list query");

		if (q.blockNumber !== undefined) {
			const values = validateBlockNumberFilters(q.blockNumber);
			p["block.number"] = Array.isArray(q.blockNumber) ? values : values[0];
		}

		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			p["timestamp"] = arr;
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			p["order"] = q.order;
		}

		return p;
	}

	/**
	 * Normalize and validate a single‑block request.
	 *
	 * - `hashOrNumber` can be:
	 *   - a decimal block number (up to 19 digits),
	 *   - a `0x` hex block number,
	 *   - a 32‑byte (64 hex) or 48‑byte (96 hex) block hash, with or without `0x`.
	 *
	 * The returned `cacheKey` is a stable string suitable for an external cache.
	 *
	 * @example
	 * ```ts
	 * BlocksMapper.one({ hashOrNumber: "0xabc123..." })
	 * // → { id: "0xabc123...", cacheKey: "blocks:0xabc123..." }
	 * ```
	 *
	 * @param q {@link BlocksOneQuery} with `hashOrNumber`.
	 * @returns `{ id, cacheKey }` where `id` is the validated path segment.
	 * @throws {@link import("../../core/errors").ValidationError}
	 *         If `hashOrNumber` is not a supported format.
	 */
	static one(q: BlocksOneQuery) {
		assertAllowedObjectKeys(q, ["hashOrNumber", "useCache"], "block query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateBlockHashOrNumber(q.hashOrNumber);
		const id = String(q.hashOrNumber);
		const cacheKey = `blocks:${id}`;
		return { id, cacheKey };
	}
}
