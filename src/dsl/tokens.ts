// src/dsl/tokens.ts

import { AllComparatorOps, ComparatorApi, createComparator, EqualOrLessComparator } from "./core";
import { AllIntegerFilter, EqualOrLessTimestampFilter, IntegerValue, LimitValue, Order, TokenTypeFilter, TokensListQuery, TokenOneQuery, TokenBalancesQuery, TokenNftsListQuery, TokenNftOneQuery, TokenNftTransactionsQuery, HederaTimestamp } from "../types";
import {
	ALL_COMPARATOR_OPERATORS,
	EQUAL_OR_LESS_COMPARATOR_OPERATORS,
	validateBoolean,
	validateEntityIdOrEvm,
	validateEntityIdOrEvmFilter,
	validateEntityIdOrEvmFilters,
	validateIntegerFilter,
	validateIntegerFilters,
	validateOrder,
	validatePositiveInt64,
	validateString,
	validateTimestampFilters,
	validateTokenIdFilter,
	validateTokenIdFilters,
	validateTokenIdOrAddress,
} from "../core/utils";
import { ValidationError } from "../core/errors";
import { validateTokenInfoTimestampFilters, validateTokenName, validateTokenTypeFilters } from "../resources/tokens/validation";

function appendValues<T>(current: readonly T[], value: T | readonly T[]): T[] {
	if (Array.isArray(value) && value.length === 0) throw new ValidationError("Filter arrays must contain at least one value");
	return [...current, ...(Array.isArray(value) ? (value as readonly T[]) : [value as T])];
}

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

/**
 * Tokens DSL
 * ==========
 * Strongly‑typed, fluent builders for /api/v1/tokens endpoints.
 *
 * Goals
 * -----
 * - Provide a discoverable, chainable API mirroring the REST surface.
 * - Validate inputs early with clear error messages.
 * - Support **direct values** (including comparator-as-string like `"gt:..."`) and
 *   **fluent comparators** (e.g. `.field().greaterThan(...)`).
 *
 * Notes on comparators
 * --------------------
 * Many endpoints accept comparator filters. You can supply them in two ways:
 *
 * 1) **Comparator-as-string** — pass a single string such as `"gt:0.0.100"`.
 * 2) **Fluent comparator** — call the method with no arguments to receive a typed API:
 *    ```ts
 *    .tokenId().greaterThan("0.0.100")
 *    ```
 *
 * In both cases, the resulting parameter is the same (e.g. `gt:0.0.100`).
 */

/* =======================================================================
 * /api/v1/tokens  (LIST)
 *   - accountId: exact numeric EntityId or EVM address
 *   - tokenId:   EntityId or comparator (eq|ne|gt|gte|lt|lte)
 *   - publicKey, name, type, order, limit
 *   - name is MUTUALLY EXCLUSIVE with accountId/tokenId
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens`** (list).
 *
 * Supported filters
 * -----------------
 * - `accountId` — exact request EntityId shorthand or EVM address (no comparator).
 * - `tokenId` — request EntityId shorthand or long-zero token address, with an optional comparator.
 * - `publicKey` — exact public key string.
 * - `name` — token name (mutually exclusive with `accountId` and `tokenId`).
	 * - `type` — known or forward-compatible token type value.
 * - `order` — `"asc"` or `"desc"`.
 * - `limit` — number or `"default"` / `"max"` (resolved later per network).
 */
export class TokensListQueryBuilder {
	private _accountId?: string;
	private _tokenIds: string[] = [];
	private _publicKey?: string;
	private _name?: string;
	private _types: TokenTypeFilter[] = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Filter by `account.id` (holder account).
	 *
	 * **Direct**: `.accountId("0.0.123")` or `.accountId("0x0123…")`
	 *
	 * @throws ValidationError if the value is not an exact numeric EntityId or EVM address.
	 */
	accountId(value: string) {
		validateEntityIdOrEvm(value, "account.id");
		this._accountId = value;
		return this;
	}

	/**
	 * Filter by `token.id`.
	 *
	 * **Direct**: `.tokenId("0.0.5005")` or `.tokenId("lte:0.0.9999")`
	 * **Fluent**: `.tokenId().lessThanOrEqualTo("0.0.9999")`
	 *
	 * @throws ValidationError if the provided value is not a valid EntityId/comparator string.
	 */
	tokenId(value: string | readonly string[]): this;
	tokenId(): ComparatorApi<string, this, AllComparatorOps>;
	tokenId(value?: string | readonly string[]) {
		if (value !== undefined) {
			const next = appendValues(this._tokenIds, value);
			validateTokenIdFilters(next, "token.id");
			this._tokenIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateTokenIdOrAddress(v);
			const next = [...this._tokenIds, `${op}:${v}`];
			validateTokenIdFilters(next, "token.id");
			this._tokenIds = next;
		});
	}

	/**
	 * Filter by `account.publickey`.
	 */
	publicKey(k: string) {
		validateString(k, "publicKey");
		this._publicKey = k;
		return this;
	}

	/**
	 * Filter by token `name`.
	 * **Mutually exclusive** with `accountId` and `tokenId`.
	 */
	name(n: string) {
		validateTokenName(n);
		this._name = n;
		return this;
	}

	/**
	 * Add one or more token-type filters. Repeated calls append values, matching
	 * the exploded `type` array in the Mirror Node OpenAPI contract.
	 */
	type(type: TokenTypeFilter | readonly TokenTypeFilter[]) {
		const next = appendValues(this._types, type);
		validateTokenTypeFilters(next);
		this._types = next;
		return this;
	}

	/**
	 * Sort order.
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint. Use a number, or the symbols `"default"` / `"max"`.
	 * The numeric value is resolved later per provider/network.
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the list query.
	 *
	 * @returns `TokensListQuery` suitable for the resource layer.
	 * @throws ValidationError if `name` is combined with `accountId` or `tokenId`.
	 */
	build(): TokensListQuery {
		if (this._name !== undefined && (this._accountId !== undefined || this._tokenIds.length > 0)) {
			throw new ValidationError(`'name' is mutually exclusive with 'accountId' and 'tokenId' for /tokens`);
		}
		const common = {
			publicKey: this._publicKey,
			type: this._types.length === 1 ? this._types[0] : this._types.length > 1 ? this._types.slice() : undefined,
			order: this._order,
			limit: this._limit,
		};
		if (this._name !== undefined) return { ...common, name: this._name };
		return { ...common, accountId: this._accountId, tokenId: oneOrArray(this._tokenIds) };
	}
}

/* =======================================================================
 * /api/v1/tokens/{tokenId}  (ONE)
 *   - tokenId (request EntityId or Solidity address)
 *   - timestamp: up to 100 exact or eq|lt|lte occurrences
 *   - useCache
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens/{tokenId}`** (single).
 *
 * - Requires a token request ID in shorthand/full form or a documented Solidity address.
 * - Optional `timestamp` accepts up to 100 exact or `eq|lt|lte` occurrences;
 *   the server uses the last occurrence after validating them all.
 * - Optional `useCache` flag permitting a cached read downstream.
 */
export class TokenOneQueryBuilder {
	private _tokenId?: string;
	private _timestamps: EqualOrLessTimestampFilter[] = [];
	private _useCache?: boolean;

	/**
	 * Set the required `tokenId` path parameter.
	 * @throws ValidationError if `tokenId` is not a valid request ID or Solidity address.
	 */
	tokenId(id: string) {
		validateTokenIdOrAddress(id);
		this._tokenId = id;
		return this;
	}

	/**
	 * Fluent comparator builder for timestamp.
	 *
	 * Example:
	 * ```ts
	 * .timestamp().lessThanOrEqualTo("1700000100.0")
	 * ```
	 */

	timestamp(value: EqualOrLessTimestampFilter | readonly EqualOrLessTimestampFilter[]): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, EqualOrLessComparator>;
	timestamp(value?: EqualOrLessTimestampFilter | readonly EqualOrLessTimestampFilter[]): ComparatorApi<HederaTimestamp, this, EqualOrLessComparator> | this {
		if (value !== undefined) {
			const next = appendValues(this._timestamps, value);
			validateTokenInfoTimestampFilters(next);
			this._timestamps = next;
			return this;
		}

		return createComparator<HederaTimestamp, this, EqualOrLessComparator>(this, (op, v) => {
			const next = [...this._timestamps, `${op}:${String(v)}` as EqualOrLessTimestampFilter];
			validateTokenInfoTimestampFilters(next);
			this._timestamps = next;
		}, EQUAL_OR_LESS_COMPARATOR_OPERATORS);
	}

	/**
	 * Allow this request to return an existing cached response downstream.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the single-token query.
	 * @throws ValidationError if `tokenId` was never set.
	 */
	build(): TokenOneQuery {
		if (!this._tokenId) throw new ValidationError("tokenId is required for tokens.one()");
		return { tokenId: this._tokenId, timestamp: oneOrArray(this._timestamps), useCache: this._useCache };
	}
}

/* =======================================================================
 * /api/v1/tokens/{tokenId}/balances
 *   - tokenId (request EntityId or Solidity address)
 *   - accountId: numeric EntityId/EVM address or comparator (eq|ne|gt|gte|lt|lte)
 *   - accountPublicKey
 *   - accountBalance: comparator (eq|ne|gt|gte|lt|lte) or raw
 *   - timestamp: single or multiple (comparator or exact)
 *   - order, limit
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens/{tokenId}/balances`**.
 *
 * Common uses:
 * - Filter balances by `accountId` or `account.publickey`.
 * - Filter by `account.balance` with comparators (e.g. `gte:1000000`).
 * - Apply one or multiple `timestamp` filters (exact or comparator).
 */
export class TokenBalancesQueryBuilder {
	private _tokenId?: string;
	private _accountIds: string[] = [];
	private _accountPublicKey?: string;
	private _accountBalances: Array<string | number> = [];
	private _timestamps: Array<string | number> = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Required path parameter `tokenId`.
	 * @throws ValidationError if not a valid request ID or Solidity address.
	 */
	tokenId(id: string) {
		validateTokenIdOrAddress(id);
		this._tokenId = id;
		return this;
	}

	/**
	 * Filter by `account.id`.
	 *
	 * **Direct**: `.accountId("0.0.123")` or `.accountId("ne:0.0.50")`
	 * **Fluent**: `.accountId().notEqualTo("0.0.50")`
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
			validateEntityIdOrEvm(v, "account.id");
			const next = [...this._accountIds, `${op}:${v}`];
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
		});
	}

	/**
	 * Filter by `account.publickey`.
	 */
	accountPublicKey(k: string) {
		validateString(k, "accountPublicKey");
		this._accountPublicKey = k;
		return this;
	}

	/**
	 * Filter by `account.balance`.
	 *
	 * **Direct**: `.accountBalance(1000000)` or `.accountBalance("gte:1000000")`
	 * **Fluent**: `.accountBalance().greaterThanOrEqualTo(1000000)`
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
			const next = [...this._accountBalances, `${op}:${String(v)}`];
			validateIntegerFilters(next, "account.balance", { minimum: 0 });
			this._accountBalances = next;
		});
	}

	// /**
	//  * Add a timestamp filter (exact `"s.ns"` or comparator-as-string `"op:s.ns"`).
	//  * Call multiple times to append multiple filters.
	//  */
	// timestamp(v: HederaTimestamp) {
	// 	this._timestamps.push(v);
	// 	return this;
	// }

	/**
	 * Fluent comparator helper for timestamp.
	 *
	 * Example:
	 * ```ts
	 * .timestamp().greaterThan("1700000000")
	 * .timestamp().lessThanOrEqualTo("1700000100.5")
	 * ```
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
	 * Sort order.
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint (`number` | `"default"` | `"max"`).
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the balances query.
	 * @throws ValidationError if `tokenId` was never set.
	 */
	build(): TokenBalancesQuery {
		if (!this._tokenId) throw new ValidationError("tokenId is required for tokens.balances()");
		let ts: TokenBalancesQuery["timestamp"];
		if (this._timestamps.length === 1) ts = this._timestamps[0];
		else if (this._timestamps.length > 1) ts = this._timestamps.slice();
		return {
			tokenId: this._tokenId,
			accountId: oneOrArray(this._accountIds),
			accountPublicKey: this._accountPublicKey,
			accountBalance: oneOrArray(this._accountBalances) as TokenBalancesQuery["accountBalance"],
			timestamp: ts,
			order: this._order,
			limit: this._limit,
		};
	}
}

/* =======================================================================
 * /api/v1/tokens/{tokenId}/nfts  (LIST)
 *   - tokenId (request EntityId or Solidity address)
 *   - accountId: numeric EntityId or EVM address, with optional comparator
 *   - serialNumber: int or comparator (eq|ne|gt|gte|lt|lte)
 *   - order, limit
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens/{tokenId}/nfts`**.
 *
 * Rules
 * -----
 * - `tokenId` is required and accepts request-ID shorthand or a Solidity address.
 * - `accountId` accepts a numeric EntityId or EVM address with any standard comparator.
 * - `serialNumber` supports `eq|ne|gt|gte|lt|lte`.
 */
export class TokenNftsListQueryBuilder {
	private _tokenId?: string;
	private _accountIds: string[] = [];
	private _serials: Array<string | number> = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Required path parameter `tokenId`.
	 */
	tokenId(id: string) {
		validateTokenIdOrAddress(id);
		this._tokenId = id;
		return this;
	}

	/**
	 * Filter by `account.id`, either directly or with a fluent comparator.
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
		return createComparator<string, this, AllComparatorOps>(this, (op, accountId) => {
			validateEntityIdOrEvm(accountId, "account.id");
			const next = [...this._accountIds, `${op}:${accountId}`];
			validateEntityIdOrEvmFilters(next, "account.id");
			this._accountIds = next;
		});
	}

	/**
	 * Filter by `serialnumber`. Accepts:
	 * - **Direct** positive integer (string/number): `.serialNumber(100)`
	 * - **Fluent comparator** (all standard operators):
	 *   `.serialNumber().greaterThanOrEqualTo(100)`
	 */
	serialNumber(v: AllIntegerFilter | readonly AllIntegerFilter[]): this;
	serialNumber(): ComparatorApi<IntegerValue, this, AllComparatorOps>;
	serialNumber(v?: AllIntegerFilter | readonly AllIntegerFilter[]) {
		if (v !== undefined) {
			const next = appendValues(this._serials, v);
			validateIntegerFilters(next, "serialnumber", { minimum: 1, comparators: ALL_COMPARATOR_OPERATORS });
			this._serials = next;
			return this;
		}
		return createComparator<IntegerValue, this, AllComparatorOps>(this, (op, val) => {
			const next = [...this._serials, `${op}:${String(val)}`];
			validateIntegerFilters(next, "serialnumber", { minimum: 1, comparators: ALL_COMPARATOR_OPERATORS });
			this._serials = next;
		});
	}

	/**
	 * Sort order.
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint.
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the NFT list query.
	 * @throws ValidationError if `tokenId` was never set.
	 */
	build(): TokenNftsListQuery {
		if (!this._tokenId) throw new ValidationError("tokenId is required for tokens.nfts()");
		return {
			tokenId: this._tokenId,
			accountId: oneOrArray(this._accountIds),
			serialNumber: oneOrArray(this._serials.map(String)) as TokenNftsListQuery["serialNumber"],
			order: this._order,
			limit: this._limit,
		};
	}
}

/* =======================================================================
 * /api/v1/tokens/{tokenId}/nfts/{serialNumber}  (ONE)
 *   - tokenId (request EntityId or Solidity address)
 *   - serialNumber: positive int
 *   - useCache
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}`** (single).
 *
 * - Requires both `tokenId` and `serialNumber`.
 * - Optional `useCache` flag permitting a cached read downstream.
 */
export class TokenNftOneQueryBuilder {
	private _tokenId?: string;
	private _serial?: IntegerValue;
	private _useCache?: boolean;

	/**
	 * Set the required `tokenId` (request EntityId shorthand or Solidity address).
	 */
	tokenId(id: string) {
		validateTokenIdOrAddress(id);
		this._tokenId = id;
		return this;
	}

	/**
	 * Set the required `serialNumber` (positive integer).
	 */
	serialNumber(v: IntegerValue) {
		validatePositiveInt64(v, "serialNumber");
		this._serial = v;
		return this;
	}

	/**
	 * Allow this request to return an existing cached response.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the single NFT query.
	 * @throws ValidationError if `tokenId` or `serialNumber` were not set.
	 */
	build(): TokenNftOneQuery {
		if (!this._tokenId) throw new ValidationError("tokenId is required for tokens.nft()");
		if (this._serial === undefined) throw new ValidationError("serialNumber is required for tokens.nft()");
		return { tokenId: this._tokenId, serialNumber: this._serial, useCache: this._useCache };
	}
}

/* =======================================================================
 * /api/v1/tokens/{tokenId}/nfts/{serial}/transactions
 *   - tokenId (request EntityId or Solidity address)
 *   - serialNumber (positive int)
 *   - timestamp: single or multiple (eq|ne|gt|gte|lt|lte or exact)
 *   - order, limit
 * ======================================================================= */

/**
 * Builder for **GET `/api/v1/tokens/{tokenId}/nfts/{serial}/transactions`**.
 *
 * - Add one or more `timestamp` filters (exact or comparator).
 * - Sorting and paging are supported through `order` and `limit`.
 */
export class TokenNftTransactionsQueryBuilder {
	private _tokenId?: string;
	private _serial?: IntegerValue;
	private _timestamps: Array<string | number> = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Required path parameter `tokenId`.
	 */
	tokenId(id: string) {
		validateTokenIdOrAddress(id);
		this._tokenId = id;
		return this;
	}

	/**
	 * Required path parameter `serialNumber` (positive integer).
	 */
	serialNumber(v: IntegerValue) {
		validatePositiveInt64(v, "serialNumber");
		this._serial = v;
		return this;
	}

	/**
	 * Fluent comparator builder for timestamp.
	 *
	 * Example:
	 * ```ts
	 * .timestamp().greaterThan("1700000000")
	 * .timestamp().lessThanOrEqualTo("1700000100.5")
	 * ```
	 */
	timestamp(value: HederaTimestamp): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, AllComparatorOps>;
	timestamp(value?: HederaTimestamp): ComparatorApi<HederaTimestamp, this, AllComparatorOps> | this {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value]);
			return this;
		}

		return createComparator<HederaTimestamp, this, AllComparatorOps>(this, (op, val) => {
			this._timestamps = validateTimestampFilters([...this._timestamps, `${op}:${String(val)}`]);
		});
	}

	/**
	 * Sort order.
	 */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Page size hint.
	 */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the NFT transactions query.
	 * @throws ValidationError if `tokenId` or `serialNumber` were not set.
	 */
	build(): TokenNftTransactionsQuery {
		if (!this._tokenId) throw new ValidationError("tokenId is required for tokens.nftTransactions()");
		if (this._serial === undefined) throw new ValidationError("serialNumber is required for tokens.nftTransactions()");
		let ts: TokenNftTransactionsQuery["timestamp"];
		if (this._timestamps.length === 1) ts = this._timestamps[0];
		else if (this._timestamps.length > 1) ts = this._timestamps.slice();
		return {
			tokenId: this._tokenId,
			serialNumber: this._serial,
			timestamp: ts,
			order: this._order,
			limit: this._limit,
		};
	}
}
