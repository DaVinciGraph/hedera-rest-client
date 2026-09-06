// src/resources/tokens/mapper.ts

import type { TokensListQuery, TokenOneQuery, TokenBalancesQuery, TokenNftsListQuery, TokenNftOneQuery, TokenNftTransactionsQuery } from "../../types";

import {
	ALL_COMPARATOR_OPERATORS,
	assertAllowedObjectKeys,
	validateEntityIdOrEvm,
	validateEntityIdOrEvmFilter,
	validateEntityIdOrEvmFilters,
	validateIntegerFilter,
	validateIntegerFilters,
	validatePositiveInt64,
	validateOptionalBoolean,
	validateOrder,
	validateString,
	validateTimestampFilters,
	validateTokenIdFilter,
	validateTokenIdFilters,
	validateTokenIdOrAddress,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";
import { validateTokenInfoTimestampFilters, validateTokenName, validateTokenTypeFilters } from "./validation";

/**
 * Maps high‑level **Tokens** queries into the exact REST query params for the
 * Hedera Mirror Node API. This file is **pure mapping + validation**:
 * it does not perform HTTP, paging, caching, or retries.
 *
 * Consistency guarantees
 * ----------------------
 * All validation and parameter naming live here so both the **object style**
 * (`{ ... }`) and the **DSL builders** produce identical requests and errors.
 *
 * Error model
 * -----------
 * Invalid inputs throw {@link ValidationError} with a clear message. Builders and
 * resource clients do not catch these; they bubble to the caller.
 *
 * Return shapes
 * -------------
 * - Collection endpoints return a plain `Record<string, any>` of query params.
 * - Single‑item endpoints return identifiers and optional `cacheKey`s to
 *   enable read‑through caching in the builder.
 */
export class TokensMapper {
	/* --------------------------
     Query mappers
     -------------------------- */

	/**
	 * Normalize and validate **GET `/api/v1/tokens`** list queries.
	 *
	 * Mapped fields
	 * -------------
	 * - `accountId` → `"account.id"`
	 *   - Accepts an exact request EntityId or EVM address; comparators are not supported.
	 * - `tokenId`   → `"token.id"` (numeric IDs and long-zero token addresses support comparators).
	 * - `publicKey` → `"publickey"`.
	 * - `name`      → `"name"`. **Mutually exclusive** with `accountId` and `tokenId`.
	 * - `type`      → `"type"`. One to 100 non-empty token-type values; input is preserved.
	 * - `order`     → `"order"` (server default applies when omitted).
	 * - `limit`     → `"limit"` (numeric or symbolic, clamped later by the builder).
	 *
	 * Validation
	 * ----------
	 * - `accountId` must be an exact numeric request ID or EVM address.
	 * - Token comparator payloads must be numeric IDs or valid long-zero token addresses.
	 * - Every repeated `type` occurrence must be a non-empty string.
	 * - `name` must contain 3–100 UTF-8 bytes.
	 * - `'name'` cannot be combined with `accountId` or `tokenId`.
	 *
	 * @param q Optional object query.
	 * @returns Plain params object.
	 * @throws {ValidationError} For invalid comparators, entity ids, or field combinations.
	 */
	static list(q?: TokensListQuery): Record<string, any> {
		const p: Record<string, any> = {};
		if (q === undefined) return p;
		assertAllowedObjectKeys(q, ["accountId", "tokenId", "publicKey", "name", "type", "limit", "order"], "tokens list query");

		if (q.name !== undefined && (q.accountId !== undefined || q.tokenId !== undefined)) {
			throw new ValidationError(`'name' is mutually exclusive with 'accountId' and 'tokenId' for /tokens`);
		}

		if (q.accountId !== undefined) {
			validateEntityIdOrEvm(q.accountId, "account.id");
			p["account.id"] = q.accountId;
		}

		if (q.tokenId !== undefined) {
			const values = validateTokenIdFilters(q.tokenId, "token.id");
			p["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		if (q.publicKey !== undefined) {
			validateString(q.publicKey, "publicKey");
			p["publickey"] = q.publicKey;
		}
		if (q.name !== undefined) {
			validateTokenName(q.name);
			p["name"] = q.name;
		}

		if (q.type !== undefined) {
			const types = validateTokenTypeFilters(q.type);
			p["type"] = typeof q.type === "string" ? q.type : types;
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			p["order"] = q.order;
		}

		return p;
	}

	/**
	 * Normalize and validate **GET `/api/v1/tokens/{tokenId}`** single‑item queries.
	 *
	 * Requirements
	 * ------------
	 * - `tokenId`: request EntityId shorthand or a documented Solidity-address form.
	 * - `timestamp` (optional): one to 100 exact or `eq|lt|lte` occurrences.
	 *   The server validates every occurrence and uses the last one.
	 *
	 * Returns
	 * -------
	 * - `{ id, params, cacheKey }` where:
	 *   - `id` is path‑safe.
	 *   - `params` includes an optional `"timestamp"`.
	 *   - `cacheKey` can be used by the builder for read‑through caching.
	 */
	static one(q: TokenOneQuery) {
		assertAllowedObjectKeys(q, ["tokenId", "timestamp", "useCache"], "token query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTokenIdOrAddress(q.tokenId);
		const params: Record<string, any> = {};
		const timestamps = q.timestamp === undefined ? undefined : validateTokenInfoTimestampFilters(q.timestamp);
		if (timestamps !== undefined) params["timestamp"] = Array.isArray(q.timestamp) ? timestamps : timestamps[0];
		const effectiveTimestamp = timestamps?.at(-1) ?? "";
		const cacheKey = `token:${q.tokenId}:${effectiveTimestamp}`;
		return { id: q.tokenId, params, cacheKey };
	}

	/**
	 * Normalize and validate **GET `/api/v1/tokens/{tokenId}/balances`** queries.
	 *
	 * Mapped fields
	 * -------------
	 * - `tokenId`          → path segment (request EntityId shorthand or Solidity address).
	 * - `accountId`        → `"account.id"` (numeric EntityId/EVM address or comparator).
	 * - `accountPublicKey` → `"account.publickey"`.
	 * - `accountBalance`   → `"account.balance"` (exact number or comparator string).
	 * - `timestamp`        → `"timestamp"` (single or array; exact or comparator).
	 * - `order`, `limit`   → forwarded unchanged (limit clamped later).
	 *
	 * Numeric zero is preserved for `accountBalance`.
	 */
	static balances(q: TokenBalancesQuery) {
		assertAllowedObjectKeys(q, ["tokenId", "accountId", "accountPublicKey", "accountBalance", "timestamp", "limit", "order"], "token balances query");
		validateTokenIdOrAddress(q.tokenId);
		const params: Record<string, any> = {};
		if (q.accountId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.accountId, "account.id");
			params["account.id"] = Array.isArray(q.accountId) ? values : values[0];
		}
		if (q.accountPublicKey !== undefined) {
			validateString(q.accountPublicKey, "accountPublicKey");
			params["account.publickey"] = q.accountPublicKey;
		}
		if (q.accountBalance !== undefined) {
			const values = validateIntegerFilters(q.accountBalance, "account.balance", { minimum: 0 });
			params["account.balance"] = Array.isArray(q.accountBalance) ? values.map(String) : values[0];
		}
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			params["timestamp"] = arr;
		}
		if (q.limit !== undefined) params["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}
		return { id: q.tokenId, params };
	}

	/**
	 * Normalize and validate **GET `/api/v1/tokens/{tokenId}/nfts`** list queries.
	 *
	 * Rules
	 * -----
	 * - `tokenId`: request EntityId shorthand or Solidity address (path).
	 * - `accountId`: numeric EntityId/EVM address or a standard comparator.
	 * - `serialNumber`:
	 *    - integer or comparator string using any standard comparator:
	 *      `eq|ne|gt|gte|lt|lte:<int>`.
	 *    - Up to 19 digits.
	 *
	 * @returns `{ id, params }` where `params` contains `"account.id"`,
	 *          `"serialnumber"`, `"order"`, `"limit"` when provided.
	 */
	static nftsList(q: TokenNftsListQuery) {
		assertAllowedObjectKeys(q, ["tokenId", "accountId", "serialNumber", "limit", "order"], "token NFTs query");
		validateTokenIdOrAddress(q.tokenId);

		const params: Record<string, any> = {};

		// 'account.id' (numeric ID/EVM payload; all standard comparators)
		if (q.accountId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.accountId, "account.id");
			params["account.id"] = Array.isArray(q.accountId) ? values : values[0];
		}

		// 'serialnumber' (int or comparator eq|ne|gt|gte|lt|lte)
		if (q.serialNumber !== undefined) {
			const values = validateIntegerFilters(q.serialNumber, "serialnumber", { minimum: 1, comparators: ALL_COMPARATOR_OPERATORS });
			params["serialnumber"] = Array.isArray(q.serialNumber) ? values.map(String) : String(values[0]);
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}

		return { id: q.tokenId, params };
	}

	/**
	 * Normalize and validate **GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}`** single‑item queries.
	 *
	 * Requirements
	 * ------------
	 * - `tokenId`: request EntityId shorthand or Solidity address.
	 * - `serialNumber`: positive integer (number or string).
	 *
	 * Returns
	 * -------
	 * - `{ id, serial, cacheKey }` for path construction and optional caching.
	 */
	static nftOne(q: TokenNftOneQuery) {
		assertAllowedObjectKeys(q, ["tokenId", "serialNumber", "useCache"], "NFT query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateTokenIdOrAddress(q.tokenId);
		validatePositiveInt64(q.serialNumber, "serialNumber");
		const cacheKey = `nft:${q.tokenId}:${q.serialNumber}`;
		return { id: q.tokenId, serial: String(q.serialNumber), cacheKey };
	}

	/**
	 * Normalize and validate **GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}/transactions`** queries.
	 *
	 * Mapped fields
	 * -------------
	 * - `timestamp`: exact values or comparator strings. Accepts a single value
	 *   or an array; an array is preserved to express ranges (e.g., `gte:...`, `lt:...`).
	 * - `order`, `limit`: forwarded (limit clamped later by the builder).
	 *
	 * @returns `{ id, serial, params }`
	 */
	static nftTx(q: TokenNftTransactionsQuery) {
		assertAllowedObjectKeys(q, ["tokenId", "serialNumber", "timestamp", "limit", "order"], "NFT transactions query");
		validateTokenIdOrAddress(q.tokenId);
		validatePositiveInt64(q.serialNumber, "serialNumber");

		const params: Record<string, any> = {};

		// timestamp (single or array)
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			// Preserve multiplicity for range queries
			params["timestamp"] = arr.map(String);
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}

		return { id: q.tokenId, serial: String(q.serialNumber), params };
	}
}
