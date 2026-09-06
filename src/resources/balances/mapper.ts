// src/resources/balances/mapper.ts

import type { BalancesListQuery } from "../../types";
import { assertAllowedObjectKeys, validateAccountIdFilters, validateIntegerFilters, validateOrder, validateString, validateTimestampFilters } from "../../core/utils";

/**
 * BalancesMapper
 * ==============
 * Pure, side‑effect‑free utilities that transform a user‑facing
 * {@link BalancesListQuery} object into the exact query‑parameter map the
 * Mirror Node REST API expects for **GET `/api/v1/balances`**.
 *
 * What this mapper does
 * ---------------------
 * 1) **Field renaming** — converts friendly keys to API keys:
 *    - `accountId`      → `"account.id"`
 *    - `accountBalance` → `"account.balance"`
 *    - `accountPublicKey` stays `"account.publickey"`
 *    - `timestamp` stays `"timestamp"`
 *    - `limit`, `order` passthrough
 * 2) **Comparator handling** — accepts plain values (treated as `eq`) or
 *    comparator strings of the form `op:value` where `op ∈ {eq, ne, lt, lte, gt, gte}`.
 * 3) **Validation** — verifies well‑formed entity IDs, timestamps, and
 *    comparator strings. Invalid inputs throw {@link import("../../core/errors").ValidationError}.
 *
 * Notes on behavior
 * -----------------
 * - For parity with the DSL, the equality form of `accountBalance` is
 *   stringified: `123` → `"123"`.
 * - `timestamp` accepts either a single exact/comparator value or an array of
 *   them; values are validated and then forwarded as an array to the API.
 */
export class BalancesMapper {
	/**
	 * Map a {@link BalancesListQuery} into a plain `{[key: string]: any}` object
	 * suitable for `URLSearchParams`. Keys match the Mirror Node API.
	 *
	 * @example
	 * ```ts
	 * BalancesMapper.list({
	 *   accountId: "gte:0.0.100",
	 *   accountBalance: "gt:1000000",
	 *   timestamp: ["gte:1700000000", "lt:1700003600"],
	 *   order: "desc",
	 *   limit: 25,
	 * });
	 * // =>
	 * // {
	 * //   "account.id": "gte:0.0.100",
	 * //   "account.balance": "gt:1000000",
	 * //   "timestamp": ["gte:1700000000", "lt:1700003600"],
	 * //   "order": "desc",
	 * //   "limit": 25
	 * // }
	 * ```
	 *
	 * @param q Optional query object. If omitted, returns `{}`.
	 * @returns A parameter map with API field names.
	 * @throws {@link import("../../core/errors").ValidationError}
	 *         If any field is malformed (invalid comparator, entity ID, or timestamp).
	 */
	static list(q?: BalancesListQuery) {
		const p: Record<string, any> = {};
		if (q === undefined) return p;
		assertAllowedObjectKeys(q, ["accountId", "accountBalance", "accountPublicKey", "timestamp", "limit", "order"], "balances query");

		// account.id — plain EntityId or comparator string
		if (q.accountId !== undefined) {
			const values = validateAccountIdFilters(q.accountId);
			p["account.id"] = Array.isArray(q.accountId) ? values : values[0];
		}

		// account.balance — numeric equality (stringified) or comparator string
		if (q.accountBalance !== undefined) {
			const values = validateIntegerFilters(q.accountBalance, "account.balance", { minimum: 0 });
			p["account.balance"] = Array.isArray(q.accountBalance) ? values.map(String) : String(values[0]);
		}

		// account.publickey — passthrough
		if (q.accountPublicKey !== undefined) {
			validateString(q.accountPublicKey, "accountPublicKey");
			p["account.publickey"] = q.accountPublicKey;
		}

		// timestamp — single value or array; each entry validated
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			p["timestamp"] = arr;
		}

		// order / limit — passthrough (limit is clamped later by resolveLimitValue)
		if (q.limit !== undefined) p["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			p["order"] = q.order;
		}

		return p;
	}
}
