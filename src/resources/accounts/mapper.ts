// src/resources/accounts/mapper.ts

import type {
	AccountsListQuery,
	AccountOneQuery,
	AccountHooksQuery,
	AccountHookStorageQuery,
	AccountCryptoAllowancesQuery,
	AccountTokenAllowancesQuery,
	AccountNftAllowancesQuery,
	AccountTokensQuery,
	AccountNftsOwnedQuery,
	AccountRewardsQuery,
	AccountOutstandingAirdropsQuery,
	AccountPendingAirdropsQuery,
} from "../../types";
import {
	validateEntityIdOrAliasOrEvm,
	validateJavaAccountIdPath,
	validateAirdropAccountIdFilter,
	validateEntityIdFilter,
	validateEntityIdRangeFilters,
	validatePrimaryEntityIdRangeFilter,
	validateEntityIdOrEvmFilter,
	validateEntityIdOrEvmFilters,
	validateTokenIdFilter,
	validateTokenIdFilters,
	validateTimestampFilters,
	validateJavaTimestampFilters,
	validateIntegerFilter,
	validateIntegerFilters,
	validateRepeatedValues,
	validateRepeatedComparatorFilters,
	validateJavaLongRangeFilter,
	validateJavaLongRangeFilters,
	NO_NE_COMPARATOR_OPERATORS,
	validateHookStorageKey,
	validateHookStorageKeyFilters,
	assertAllowedObjectKeys,
	validateOptionalBoolean,
	validateOrder,
	validateString,
	opOf,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";

function assignOrder(params: Record<string, any>, order: unknown): void {
	if (order === undefined) return;
	validateOrder(order);
	params["order"] = order;
}

/**
 * AccountsMapper
 * ==============
 * Pure functions that **normalize** user-facing query objects into the exact
 * query‐parameter shapes expected by the Mirror Node REST API for the
 * /api/v1/accounts family of endpoints.
 *
 * Responsibilities
 * ----------------
 * 1) **Field renaming** — converts friendly names to API keys
 *    (e.g. `accountId` → `"account.id"`, `tokenId` → `"token.id"`).
 * 2) **Comparator support** — accepts either a plain value (treated as `eq`)
 *    or a comparator string of the form `op:value` where `op ∈ {eq, ne, gt, gte, lt, lte}`.
 * 3) **Type/shape validation** — validates well‑formed entity IDs, timestamps,
 *    and integer fields; throws {@link ValidationError} on invalid input.
 * 4) **Rule enforcement** — applies Mirror Node coupling/requirement rules,
 *    such as “`tokenId` requires `spenderId`” and multi‑column pagination
 *    constraints (e.g. `token.id lt/lte` implies `spender.id lte/eq`).
 *
 * Error behavior
 * --------------
 * Invalid inputs (wrong formats, missing required companions, or forbidden
 * comparators) result in {@link ValidationError} with a specific message that
 * explains what must be changed.
 *
 * Return shapes
 * -------------
 * Each mapper returns a small structure ready for HTTP execution. For list
 * endpoints this is `{ params }`. For single‑resource endpoints, or when a path
 * parameter is involved, the mapper also returns `{ id | pathId, params }`. The
 * `one()` mapper additionally returns a stable `cacheKey`.
 *
 * Examples
 * --------
 * - `accountId: "0.0.1001"`            → `"account.id" = "0.0.1001"`
 * - `accountId: "gte:0.0.1000"`        → `"account.id" = "gte:0.0.1000"`
 * - `accountBalance: 123`              → `"account.balance" = "123"` (equality)
 * - `timestamp: ["gte:1700", "lt:1800"]` → `"timestamp" = ["gte:1700","lt:1800"]`
 */
export class AccountsMapper {
	/* ==========================
	   /api/v1/accounts (list/one)
	   ========================== */

	/**
	 * Map the **accounts list** query.
	 *
	 * Accepted fields on {@link AccountsListQuery}:
	 * - `accountId` — entity id or comparator string (`op:value`)
	 * - `accountBalance` — number/string, or comparator string (`op:value`)
	 * - `accountPublicKey` — raw public key string (passthrough)
	 * - `includeBalance` — one to 100 booleans (`balance` query key)
	 * - `limit` — number | "default" | "max" (forwarded; clamped later)
	 * - `order` — "asc" | "desc"
	 *
	 * @returns A plain `{[key: string]: any}` params object with API keys.
	 * @throws {@link ValidationError} for invalid comparators or formats.
	 */
	static list(q: AccountsListQuery | undefined): Record<string, any> {
		if (q === undefined) return {};
		assertAllowedObjectKeys(q, ["accountId", "accountBalance", "accountPublicKey", "includeBalance", "limit", "order"], "accounts list query");
		const params: Record<string, any> = {};

		if (q.accountId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.accountId, "account.id");
			params["account.id"] = Array.isArray(q.accountId) ? values : values[0];
		}

		if (q.accountBalance !== undefined) {
			const values = validateIntegerFilters(q.accountBalance, "account.balance", { minimum: 0 });
			params["account.balance"] = Array.isArray(q.accountBalance) ? values.map(String) : String(values[0]);
		}

		if (q.accountPublicKey !== undefined) {
			validateString(q.accountPublicKey, "accountPublicKey");
			params["account.publickey"] = q.accountPublicKey;
		}
		if (q.includeBalance !== undefined) {
			const values = validateRepeatedValues(
				q.includeBalance,
				"balance",
				(value) => {
					if (typeof value !== "boolean") throw new ValidationError("balance must be a boolean");
				},
				100
			);
			params["balance"] = Array.isArray(q.includeBalance) ? values : values[0];
		}
		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);

		return params;
	}

	/**
	 * Map the **accounts one** query (by id/alias/evm).
	 *
	 * Accepted fields on {@link AccountOneQuery}:
	 * - `idOrAliasOrEvmAddress` — required. Accepts a request entity ID
	 *   (`num`, `realm.num`, or `shard.realm.num`), base32 alias, or EVM address.
	 * - `timestamp` — exact or comparator; string or array of filters.
	 * - `order`, `limit`, `transactiontype`, `transactions` (boolean).
	 *
	 * @returns `{ id, query, cacheKey }`
	 *   - `id` is the validated path parameter.
	 *   - `query` is the params object.
	 *   - `cacheKey` is a stable string you can use when caching is enabled.
	 *
	 * @throws {@link ValidationError} if the path id is not a valid entity/alias/evm.
	 */
	static one(q: AccountOneQuery): { id: string; query: Record<string, any>; cacheKey: string } {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "limit", "order", "timestamp", "transactiontype", "transactions", "useCache"], "account query");
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);
		validateOptionalBoolean(q.transactions, "transactions");
		validateOptionalBoolean(q.useCache, "useCache");
		const query: Record<string, any> = {};
		if (q.limit !== undefined) query["limit"] = q.limit;
		assignOrder(query, q.order);
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			query["timestamp"] = arr;
		}
		if (q.transactiontype !== undefined) {
			validateString(q.transactiontype, "transactiontype");
			query["transactiontype"] = q.transactiontype;
		}
		if (q.transactions !== undefined) query["transactions"] = q.transactions;
		const cacheKey = `accounts:${q.idOrAliasOrEvmAddress}:${JSON.stringify(query)}`;
		return { id: q.idOrAliasOrEvmAddress, query, cacheKey };
	}

	/** Map `GET /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks`. */
	static hooks(q: AccountHooksQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "hookId", "limit", "order"], "account hooks query");
		validateJavaAccountIdPath(q.idOrAliasOrEvmAddress);
		const params: Record<string, any> = {};
		if (q.hookId !== undefined) {
			const hookIds = validateJavaLongRangeFilters(q.hookId, "hook.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				maximum: 100,
			});
			params["hook.id"] = Array.isArray(q.hookId) ? hookIds : hookIds[0];
		}
		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);
		return { id: q.idOrAliasOrEvmAddress, params };
	}

	/** Map `GET /api/v1/accounts/{id}/hooks/{hookId}/storage`. */
	static hookStorage(q: AccountHookStorageQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "hookId", "key", "timestamp", "limit", "order"], "account hook storage query");
		validateJavaAccountIdPath(q.idOrAliasOrEvmAddress);
		validateJavaLongRangeFilter(q.hookId, "hookId", { comparators: [] });

		const params: Record<string, any> = {};
		if (q.key !== undefined) {
			const keys = validateHookStorageKeyFilters(q.key);
			params["key"] = Array.isArray(q.key) ? keys : keys[0];
		}
		if (q.timestamp !== undefined) {
			const timestamps = Array.isArray(q.timestamp) ? q.timestamp : [q.timestamp];
			validateJavaTimestampFilters(timestamps);
			params["timestamp"] = timestamps;
		}
		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);
		return { id: q.idOrAliasOrEvmAddress, hookId: q.hookId, params };
	}

	/* ==============================
	   Subresource query mappers
	   ============================== */

	/**
	 * Map **HBAR (crypto) allowances** list:
	 * `/api/v1/accounts/{id}/allowances/crypto`.
	 *
	 * Fields:
	 * - `idOrAliasOrEvmAddress` — required path id
	 * - `spenderId` — optional `0.0.x`
	 * - `order`, `limit`
	 */
	static cryptoAllowances(q: AccountCryptoAllowancesQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "spenderId", "limit", "order"], "account crypto allowances query");
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);
		const p: Record<string, any> = {};
		if (q.spenderId !== undefined) {
			const values = validateEntityIdOrEvmFilters(q.spenderId, "spender.id", NO_NE_COMPARATOR_OPERATORS);
			p["spender.id"] = Array.isArray(q.spenderId) ? values : values[0];
		}
		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return { id: q.idOrAliasOrEvmAddress, params: p };
	}

	/**
	 * Map **token allowances** list:
	 * `/api/v1/accounts/{id}/allowances/tokens`.
	 *
	 * Rules enforced:
	 * - If `tokenId` is provided, **`spenderId` is required**.
	 * - `'ne'` comparator is **forbidden** for both `spenderId` and `tokenId`.
	 * - **Comparator coupling for pagination**:
	 *   - `token.id lt|lte` → `spender.id` must be `lte|eq`.
	 *   - `token.id gt|gte` → `spender.id` must be `gte|eq`.
	 *
	 * @returns `{ pathId, params }`
	 * @throws {@link ValidationError} on missing required companions or invalid comparators.
	 */
	static tokenAllowances(q: AccountTokenAllowancesQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "tokenId", "spenderId", "limit", "order"], "account token allowances query");
		// Path account (owner)
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);
		const pathId = q.idOrAliasOrEvmAddress;

		const params: Record<string, any> = {};

		// spenderId -> "spender.id" (optional unless tokenId is present)
		let spenderOps: string[] = [];
		if (q.spenderId !== undefined) {
			const values = validateRepeatedComparatorFilters(
				q.spenderId,
				"spender.id",
				(value) => validateEntityIdOrEvmFilter(value, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			spenderOps = values.map((value) => opOf(value) ?? "eq");
			params["spender.id"] = Array.isArray(q.spenderId) ? values : values[0];
		}

		// tokenId -> "token.id" (REQUIRES spender.id)
		let tokenOps: string[] = [];
		if (q.tokenId !== undefined) {
			if (q.spenderId === undefined) {
				throw new ValidationError(`When 'tokenId' is provided, 'spenderId' (spender.id) is required by Mirror Node`);
			}

			const values = validateRepeatedComparatorFilters(
				q.tokenId,
				"token.id",
				(value) => validateTokenIdFilter(value, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			tokenOps = values.map((value) => opOf(value) ?? "eq");
			params["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		// Multi-column pagination coupling
		const tokenUpper = tokenOps.find((operator) => operator === "lt" || operator === "lte");
		if (tokenUpper) {
			if (!spenderOps.some((operator) => operator === "lte" || operator === "eq")) {
				throw new ValidationError(`When token.id uses '${tokenUpper}', spender.id must use 'lte' or 'eq' (Mirror Node pagination rules)`);
			}
		}
		const tokenLower = tokenOps.find((operator) => operator === "gt" || operator === "gte");
		if (tokenLower) {
			if (!spenderOps.some((operator) => operator === "gte" || operator === "eq")) {
				throw new ValidationError(`When token.id uses '${tokenLower}', spender.id must use 'gte' or 'eq' (Mirror Node pagination rules)`);
			}
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);

		return { pathId, params };
	}

	/**
	 * Map **NFT allowances** list:
	 * `/api/v1/accounts/{id}/allowances/nfts`.
	 *
	 * Additional semantics:
	 * - `view` maps to `owner` boolean (`owner=true` by default; `false` if `view='spender'`).
	 * - `tokenId` requires `counterpartyId` (`account.id`).
	 * - `'ne'` is forbidden for `counterpartyId` and `tokenId`.
	 * - Comparator coupling:
	 *   - `token.id lt|lte` → `account.id` must be `lte|eq`.
	 *   - `token.id gt|gte` → `account.id` must be `gte|eq`.
	 */
	static nftAllowances(q: AccountNftAllowancesQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "view", "tokenId", "counterpartyId", "limit", "order"], "account NFT allowances query");
		// Path account (view account)
		validateJavaAccountIdPath(q.idOrAliasOrEvmAddress);
		const pathId = q.idOrAliasOrEvmAddress;

		// View → owner flag
		if (q.view !== undefined && q.view !== "owner" && q.view !== "spender") {
			throw new ValidationError("view must be 'owner' or 'spender'");
		}
		const ownerFlag = q.view === "spender" ? false : true;
		const params: Record<string, any> = { owner: ownerFlag };

		// counterpartyId -> "account.id" (optional unless tokenId present)
		let counterpartyOps: string[] = [];
		if (q.counterpartyId !== undefined) {
			const values = validateEntityIdRangeFilters(q.counterpartyId, "account.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				primary: true,
				structured: true,
				orderedBounds: true,
			});
			counterpartyOps = values.map((value) => opOf(value)?.toLowerCase() ?? "eq");
			params["account.id"] = Array.isArray(q.counterpartyId) ? values : values[0];
		}

		// tokenId -> "token.id" (requires account.id)
		let tokenOps: string[] = [];
		if (q.tokenId !== undefined) {
			if (q.counterpartyId === undefined) {
				throw new ValidationError(`When 'tokenId' is provided, 'counterpartyId' (account.id) is required by Mirror Node`);
			}

			const accountHasLowerAndUpper =
				counterpartyOps.some((operator) => operator === "gt" || operator === "gte") &&
				counterpartyOps.some((operator) => operator === "lt" || operator === "lte");
			const values = validateEntityIdRangeFilters(q.tokenId, "token.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				structured: true,
				orderedBounds: !accountHasLowerAndUpper,
			});
			tokenOps = values.map((value) => opOf(value)?.toLowerCase() ?? "eq");
			params["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		// Comparator coupling rules
		const tokenUpper = tokenOps.find((operator) => operator === "lt" || operator === "lte");
		if (tokenUpper && !counterpartyOps.some((operator) => operator === "lte" || operator === "eq")) {
			throw new ValidationError(`When token.id uses '${tokenUpper}', account.id must use 'lte' or 'eq' (Mirror Node pagination rules)`);
		}
		const tokenLower = tokenOps.find((operator) => operator === "gt" || operator === "gte");
		if (tokenLower && !counterpartyOps.some((operator) => operator === "gte" || operator === "eq")) {
			throw new ValidationError(`When token.id uses '${tokenLower}', account.id must use 'gte' or 'eq' (Mirror Node pagination rules)`);
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);

		return { pathId, params };
	}

	/**
	 * Map **account tokens** list:
	 * `/api/v1/accounts/{id}/tokens`.
	 *
	 * Fields:
	 * - `idOrAliasOrEvmAddress` — required path id
	 * - `tokenId` — optional `0.0.x`
	 * - `order`, `limit`
	 */
	static accountTokens(q: AccountTokensQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "tokenId", "limit", "order"], "account tokens query");
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);
		const p: Record<string, any> = {};
		if (q.tokenId !== undefined) {
			const values = validateTokenIdFilters(q.tokenId, "token.id", NO_NE_COMPARATOR_OPERATORS);
			p["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}
		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return { id: q.idOrAliasOrEvmAddress, params: p };
	}

	/**
	 * Map **NFTs owned** list:
	 * `/api/v1/accounts/{id}/nfts`.
	 *
	 * Rules:
	 * - `serialNumber` requires `tokenId`.
	 * - `'ne'` is forbidden for `tokenId`, `serialNumber`, and `spenderId`.
	 * - Comparator coupling:
	 *   - `serialnumber lt|lte` → `token.id` must be `lte|eq`.
	 *   - `serialnumber gt|gte` → `token.id` must be `gte|eq`.
	 */
	static accountNftsOwned(q: AccountNftsOwnedQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "tokenId", "serialNumber", "spenderId", "limit", "order"], "account NFTs query");
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);

		const params: Record<string, any> = {};

		// token.id
		let tokenOps: string[] = [];
		if (q.tokenId !== undefined) {
			const values = validateRepeatedComparatorFilters(
				q.tokenId,
				"token.id",
				(value) => validateTokenIdFilter(value, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			tokenOps = values.map((value) => opOf(value) ?? "eq");
			params["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		// serialnumber (requires tokenId)
		let serialOps: string[] = [];
		if (q.serialNumber !== undefined) {
			if (q.tokenId === undefined) {
				throw new ValidationError(`When 'serialNumber' is provided, 'tokenId' must also be provided (Mirror Node requirement)`);
			}
			const values = validateRepeatedComparatorFilters(
				q.serialNumber,
				"serialnumber",
				(value) => validateIntegerFilter(value, "serialnumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			serialOps = values.map((value) => opOf(String(value)) ?? "eq");
			params["serialnumber"] = Array.isArray(q.serialNumber) ? values.map(String) : String(values[0]);
		}

		// spender.id (optional; no 'ne')
		if (q.spenderId !== undefined) {
			const values = validateRepeatedComparatorFilters(
				q.spenderId,
				"spender.id",
				(value) => validateEntityIdOrEvmFilter(value, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			params["spender.id"] = Array.isArray(q.spenderId) ? values : values[0];
		}

		// Coupling rule: token.id ↔ serialnumber
		const serialUpper = serialOps.find((operator) => operator === "lt" || operator === "lte");
		if (serialUpper) {
			if (!tokenOps.some((operator) => operator === "lte" || operator === "eq")) {
				throw new ValidationError(`When 'serialnumber' uses '${serialUpper}', 'token.id' must use 'lte' or 'eq' (Mirror Node pagination rule)`);
			}
		}
		const serialLower = serialOps.find((operator) => operator === "gt" || operator === "gte");
		if (serialLower) {
			if (!tokenOps.some((operator) => operator === "gte" || operator === "eq")) {
				throw new ValidationError(`When 'serialnumber' uses '${serialLower}', 'token.id' must use 'gte' or 'eq' (Mirror Node pagination rule)`);
			}
		}

		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);

		return { id: q.idOrAliasOrEvmAddress, params };
	}

	/**
	 * Map **staking rewards** list:
	 * `/api/v1/accounts/{id}/rewards`.
	 *
	 * Fields:
	 * - `idOrAliasOrEvmAddress` — required path id
	 * - `timestamp` — exact or comparator (string | number | array)
	 * - `order`, `limit`
	 */
	static rewards(q: AccountRewardsQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "timestamp", "limit", "order"], "account rewards query");
		validateEntityIdOrAliasOrEvm(q.idOrAliasOrEvmAddress);
		const p: Record<string, any> = {};
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp, NO_NE_COMPARATOR_OPERATORS);
			p["timestamp"] = arr;
		}
		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return { id: q.idOrAliasOrEvmAddress, params: p };
	}

	/**
	 * Map **outstanding airdrops** list:
	 * `/api/v1/accounts/{id}/airdrops/outstanding`.
	 *
	 * Semantics:
	 * - Path `id` is the **sender** account.
	 * - `receiverId` and `tokenId` accept up to two range bounds; `ne` is rejected because the server ignores it.
	 * - `serialNumber` is an independent integer range (eq|gt|gte|lt|lte).
	 */
	static outstandingAirdrops(q: AccountOutstandingAirdropsQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "receiverId", "tokenId", "serialNumber", "limit", "order"], "outstanding airdrops query");
		// path account (sender for 'outstanding')
		validateJavaAccountIdPath(q.idOrAliasOrEvmAddress);
		const id = q.idOrAliasOrEvmAddress;

		const p: Record<string, any> = {};

		// receiver.id (up to two range bounds; no ineffective `ne`)
		if (q.receiverId !== undefined) {
			const values = validateEntityIdRangeFilters(q.receiverId, "receiver.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				primary: true,
				orderedBounds: true,
			});
			p["receiver.id"] = Array.isArray(q.receiverId) ? values : values[0];
		}

		// token.id (up to two range bounds; no ineffective `ne`)
		if (q.tokenId !== undefined) {
			const values = validateEntityIdRangeFilters(q.tokenId, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			p["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		// serialnumber — independent integer range; comparators eq|gt|gte|lt|lte
		if (q.serialNumber !== undefined) {
			const values = validateJavaLongRangeFilters(q.serialNumber, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			p["serialnumber"] = Array.isArray(q.serialNumber) ? values.map(String) : String(values[0]);
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);

		return { id, params: p };
	}

	/**
	 * Map **pending airdrops** list:
	 * `/api/v1/accounts/{id}/airdrops/pending`.
	 *
	 * Semantics:
	 * - Path `id` is the **receiver** account.
	 * - `senderId` and `tokenId` accept up to two range bounds; `ne` is rejected because the server ignores it.
	 * - `serialNumber` is an independent integer range (eq|gt|gte|lt|lte).
	 */
	static pendingAirdrops(q: AccountPendingAirdropsQuery) {
		assertAllowedObjectKeys(q, ["idOrAliasOrEvmAddress", "senderId", "tokenId", "serialNumber", "limit", "order"], "pending airdrops query");
		// path account (receiver for 'pending')
		validateJavaAccountIdPath(q.idOrAliasOrEvmAddress);
		const id = q.idOrAliasOrEvmAddress;

		const p: Record<string, any> = {};

		// sender.id (up to two range bounds; no ineffective `ne`)
		if (q.senderId !== undefined) {
			const values = validateEntityIdRangeFilters(q.senderId, "sender.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				primary: true,
				orderedBounds: true,
			});
			p["sender.id"] = Array.isArray(q.senderId) ? values : values[0];
		}

		// token.id (up to two range bounds; no ineffective `ne`)
		if (q.tokenId !== undefined) {
			const values = validateEntityIdRangeFilters(q.tokenId, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			p["token.id"] = Array.isArray(q.tokenId) ? values : values[0];
		}

		// serialnumber — independent integer range; eq|gt|gte|lt|lte
		if (q.serialNumber !== undefined) {
			const values = validateJavaLongRangeFilters(q.serialNumber, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			p["serialnumber"] = Array.isArray(q.serialNumber) ? values.map(String) : String(values[0]);
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);

		return { id, params: p };
	}
}
