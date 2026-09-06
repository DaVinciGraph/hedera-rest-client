// src/dsl/accounts.ts

/**
 * Fluent builders (DSL) for **all `/api/v1/accounts` endpoints**.
 *
 * The goal of these builders is to:
 * - Provide a **chainable, type‑safe** API for constructing queries.
 * - Expose **comparator methods** (`equalTo`, `lessThan`, `gte`, …) only where
 *   the endpoint allows them.
 * - Perform **early validation** (entity IDs, timestamps, integer ranges).
 * - Enforce **Mirror Node coupling rules** (e.g. “A requires B”, or
 *   “when token comparator is lt, spender comparator must be lte/eq”).
 *
 * ### Quick example
 * ```ts
 * // GET /api/v1/accounts: list with comparators and paging
 * const built = new AccountsListQueryDSL()
 *   .includeBalance(true)
 *   .accountId().greaterThan("0.0.5000")
 *   .accountBalance().lessThanOrEqualTo(1_000_000)
 *   .order("desc")
 *   .limit(25)
 *   ._build();
 *
 * // built.params -> plain object ready for the resource layer/HTTP
 * // built.requestedLimit -> requested page size; later clamped to provider limits
 * ```
 */

import type { AllIntegerFilter, HederaTimestamp, IntegerFilter, IntegerValue, JavaLongRangeFilter, JavaLongValue, LimitValue, Order, TransactionTypes } from "../types";

import { AllComparatorOps, createComparator, NoNeComparatorOps, type ComparatorApi } from "./core";

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
	validateJavaTimestampFilter,
	validateJavaTimestampFilters,
	validatePositiveInt64,
	validateNonNegativeInt64,
	validateIntegerFilter,
	validateIntegerFilters,
	validateRepeatedValues,
	validateRepeatedComparatorFilters,
	validateJavaLongRangeFilter,
	validateJavaLongRangeFilters,
	validateHookStorageKey,
	validateHookStorageKeyFilters,
	validateBoolean,
	validateOrder,
	validateString,
	NO_NE_COMPARATOR_OPERATORS,
	opOf,
} from "../core/utils";

import { ValidationError } from "../core/errors";

/* ----------------------------------------------------------------------------
   Common helpers
---------------------------------------------------------------------------- */

/**
 * Format an operator/value pair into the wire format accepted by Mirror Node.
 *
 * - `eq` is encoded as just the value (e.g. `"123"`).
 * - Other ops use `op:value` (e.g. `"gt:123"`).
 *
 * @internal
 */
function asEqOrOp(op: string, value: string | number) {
	const s = String(value);
	return op === "eq" ? s : `${op}:${s}`;
}

/** Format a string comparator without silently coercing unsafe JavaScript calls. */
function asStringEqOrOp(op: string, value: string, name: string) {
	if (typeof value !== "string") throw new ValidationError(`${name} must be a string, got: ${String(value)}`);
	return asEqOrOp(op, value);
}

function appendedValues<T>(current: readonly T[], value: T | readonly T[]): T[] {
	if (Array.isArray(value) && value.length === 0) throw new ValidationError("Filter arrays must contain at least one value");
	return [...current, ...(Array.isArray(value) ? (value as readonly T[]) : [value as T])];
}

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

/**
 * Ensure a numeric value is a positive integer up to 19 digits.
 *
 * Many numeric filters in Mirror Node accept up to 64‑bit ranges; the builders
 * enforce a conservative decimal length bound for safety and consistency.
 *
 * @throws {@link ValidationError} if not a valid integer string/number
 * @internal
 */
function assertInteger(v: number | string, name: string) {
	validatePositiveInt64(v, name);
}

/** Return the validated no-`ne` filter operator, treating a bare value as equality. */
function integerFilterOperator(v: IntegerFilter): NoNeComparatorOps {
	const match = /^(eq|gt|gte|lt|lte):/.exec(String(v));
	return (match?.[1] as NoNeComparatorOps | undefined) ?? "eq";
}

/* ----------------------------------------------------------------------------
   LIST /api/v1/accounts
---------------------------------------------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/accounts`**.
 *
 * Supports:
 * - `account.id` and `account.balance` with comparators (`eq`, `gt`, `lte`, …).
 * - Optional ordering and paging.
 * - Runtime validation of entity IDs and numeric ranges.
 */
export class AccountsListQueryDSL {
	private params: Record<string, unknown> = {};
	private _limit?: LimitValue;
	private accountIds: string[] = [];
	private accountBalances: Array<string | number> = [];
	private includeBalances: boolean[] = [];

	/** Append one or more `balance` flags (up to 100 occurrences). */
	includeBalance(v: boolean | readonly boolean[]): this {
		const next = appendedValues(this.includeBalances, v);
		this.includeBalances = validateRepeatedValues(
			next,
			"balance",
			(value) => {
				if (typeof value !== "boolean") throw new ValidationError("balance must be a boolean");
			},
			100
		);
		return this;
	}

	/** Sort order: `"asc"` or `"desc"`. */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Filter by account public key (base64 string). */
	accountPublicKey(pk: string): this {
		validateString(pk, "accountPublicKey");
		this.params["account.publickey"] = pk;
		return this;
	}

	/**
	 * Requested page size. The resource layer will clamp this to
	 * the provider/network defaults and maximums.
	 */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/**
	 * Filter by `account.id`.
	 *
	 * You can:
	 * - pass a direct value (`"0.0.1234"`), or
	 * - call without args and then use comparators:
	 *   `accountId().greaterThan("0.0.2")`, `accountId().equalTo("0.0.10")`, etc.
	 */
	accountId(): ComparatorApi<string, AccountsListQueryDSL, AllComparatorOps>;
	accountId(id: string | readonly string[]): this;
	accountId(id?: string | readonly string[]) {
		if (id !== undefined) {
			const next = appendedValues(this.accountIds, id);
			validateEntityIdOrEvmFilters(next, "account.id");
			this.accountIds = next;
			return this;
		}
		return createComparator<string, AccountsListQueryDSL, AllComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "account.id");
			const next = [...this.accountIds, filter];
			validateEntityIdOrEvmFilters(next, "account.id");
			this.accountIds = next;
		});
	}

	/**
	 * Filter by `account.balance` using comparators.
	 *
	 * Example:
	 * ```ts
	 * .accountBalance().greaterThanOrEqualTo(1_000_000)
	 * ```
	 */
	accountBalance(value: AllIntegerFilter | readonly AllIntegerFilter[]): this;
	accountBalance(): ComparatorApi<IntegerValue, AccountsListQueryDSL, AllComparatorOps>;
	accountBalance(value?: AllIntegerFilter | readonly AllIntegerFilter[]) {
		if (value !== undefined) {
			const next = appendedValues(this.accountBalances, value);
			validateIntegerFilters(next, "account.balance", { minimum: 0 });
			this.accountBalances = next;
			return this;
		}
		return createComparator<IntegerValue, AccountsListQueryDSL, AllComparatorOps>(this, (op, value) => {
			const next = [...this.accountBalances, asEqOrOp(op, value)];
			validateIntegerFilters(next, "account.balance", { minimum: 0 });
			this.accountBalances = next;
		});
	}

	/**
	 * Finalize the query into a plain object for the resource layer.
	 * @internal
	 */
	_build() {
		const params = { ...this.params };
		const accountId = oneOrArray(this.accountIds);
		const accountBalance = oneOrArray(this.accountBalances.map(String));
		const includeBalance = oneOrArray(this.includeBalances);
		if (accountId !== undefined) params["account.id"] = accountId;
		if (accountBalance !== undefined) params["account.balance"] = accountBalance;
		if (includeBalance !== undefined) params["balance"] = includeBalance;
		return { params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountsListQueryDSL}. */
export type AccountsListInit = (q: AccountsListQueryDSL) => void | AccountsListQueryDSL;

/* ----------------------------------------------------------------------------
   ONE /api/v1/accounts/{id}
---------------------------------------------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/accounts/{id}`** (single account).
 *
 * Features:
 * - Path `id` can be **EntityId**, **alias**, or **EVM address**.
 * - Timestamp filters (including arrays and comparators).
 * - Transaction type filter.
 * - Optional transactions embedding.
 * - Optional cache hint for the resource layer.
 */
export class AccountOneQueryDSL {
	private _id?: string; // path param: id|alias|evm
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private _useCache = false;
	private _timestamps: Array<string | number> = [];

	/** Set the path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** Requested page size for embedded lists (where applicable). */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/**
	 * Add a timestamp filter (supports chaining to compose multiple constraints).
	 *
	 * Example:
	 * ```ts
	 * q.timestamp().greaterThanOrEqualTo("1700.000001")
	 *  .timestamp().lessThan("1701");
	 * ```
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

	/** Filter by embedded transaction type. */
	transactiontype(v: TransactionTypes): this {
		validateString(v, "transactiontype");
		this.params["transactiontype"] = v;
		return this;
	}

	/** Include transactions in the account response. */
	includeTransactions(v: boolean): this {
		validateBoolean(v, "transactions");
		this.params["transactions"] = v;
		return this;
	}

	/** Allow the resource layer to return an existing cached response. */
	useCache(v = true): this {
		validateBoolean(v, "useCache");
		this._useCache = v;
		return this;
	}

	/**
	 * Finalize the query and produce a stable `cacheKey`.
	 * @internal
	 */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		// Build query with the same key order used in mapOneQuery for cacheKey stability
		const q: Record<string, unknown> = {};
		if (this._limit !== undefined) q["limit"] = this._limit;
		if (this.params["order"] !== undefined) q["order"] = this.params["order"];
		if (this._timestamps.length > 0) q["timestamp"] = this._timestamps;
		if (this.params["transactiontype"] !== undefined) q["transactiontype"] = this.params["transactiontype"];
		if (this.params["transactions"] !== undefined) q["transactions"] = this.params["transactions"];

		const cacheKey = `accounts:${this._id}:${JSON.stringify(q)}`;
		return { id: this._id, params: q, requestedLimit: this._limit, useCache: this._useCache, cacheKey };
	}
}

/** Optional initializer/callback type for {@link AccountOneQueryDSL}. */
export type AccountOneInit = (q: AccountOneQueryDSL) => void | AccountOneQueryDSL;

/* ----------------------------------------------------------------------------
   HOOKS /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks
---------------------------------------------------------------------------- */

/** Fluent query for listing the hooks owned by an account. */
export class AccountHooksDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private hookIds: Array<string | number> = [];

	/** Account number/id, alias, or EVM address. Required. */
	idOrAliasOrEvmAddress(value: string): this {
		validateJavaAccountIdPath(value);
		this._id = value;
		return this;
	}

	/** Add a hook-id range filter (up to 100 occurrences; `ne` is unsupported). */
	hookId(value: JavaLongRangeFilter | readonly JavaLongRangeFilter[]): this;
	hookId(): ComparatorApi<JavaLongRangeFilter, this, NoNeComparatorOps>;
	hookId(value?: JavaLongRangeFilter | readonly JavaLongRangeFilter[]) {
		if (value !== undefined) {
			const next = appendedValues(this.hookIds, value);
			validateJavaLongRangeFilters(next, "hook.id", { comparators: NO_NE_COMPARATOR_OPERATORS, maximum: 100 });
			this.hookIds = next;
			return this;
		}
		return createComparator<JavaLongRangeFilter, this, NoNeComparatorOps>(this, (op, hookId) => {
			validateJavaLongRangeFilter(hookId, "hook.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			const filter = asEqOrOp(op, hookId);
			const next = [...this.hookIds, filter];
			validateJavaLongRangeFilters(next, "hook.id", { comparators: NO_NE_COMPARATOR_OPERATORS, maximum: 100 });
			this.hookIds = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(value: LimitValue): this {
		this._limit = value;
		return this;
	}

	/** Sort order; the Mirror Node default is `desc`. */
	order(value: Order): this {
		validateOrder(value);
		this.params["order"] = value;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params = { ...this.params };
		const hookId = oneOrArray(this.hookIds);
		if (hookId !== undefined) params["hook.id"] = hookId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Initializer/callback type for {@link AccountHooksDSL}. */
export type AccountHooksInit = (q: AccountHooksDSL) => void | AccountHooksDSL;

/* ----------------------------------------------------------------------------
   HOOK STORAGE /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks/{hookId}/storage
---------------------------------------------------------------------------- */

/** Fluent query for listing the storage slots belonging to an account hook. */
export class AccountHookStorageDSL {
	private _id?: string;
	private _hookId?: JavaLongValue;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private keys: string[] = [];
	private timestamps: HederaTimestamp[] = [];

	/** Account number/id, alias, or EVM address. Required. */
	idOrAliasOrEvmAddress(value: string): this {
		validateJavaAccountIdPath(value);
		this._id = value;
		return this;
	}

	/** Exact Java-long hook path id in the inclusive range 0..2^63-1. Required. */
	hookId(value: JavaLongValue): this {
		validateJavaLongRangeFilter(value, "hookId", { comparators: [] });
		this._hookId = value;
		return this;
	}

	/** Set a key expression directly, or use the typed comparator surface. */
	key(value: string | readonly string[]): this;
	key(): ComparatorApi<string, this, NoNeComparatorOps>;
	key(value?: string | readonly string[]) {
		if (value !== undefined) {
			const next = appendedValues(this.keys, value);
			validateHookStorageKeyFilters(next);
			this.keys = next;
			return this;
		}

		return createComparator<string, this, NoNeComparatorOps>(this, (op, key) => {
			const encoded = asStringEqOrOp(op, key, "key");
			const next = [...this.keys, encoded];
			validateHookStorageKeyFilters(next);
			this.keys = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Add an exact or comparator-prefixed consensus timestamp filter. */
	timestamp(value: HederaTimestamp): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: HederaTimestamp) {
		if (value !== undefined) {
			validateJavaTimestampFilters([...this.timestamps, value]);
			this.timestamps.push(value);
			return this;
		}

		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, timestamp) => {
			validateJavaTimestampFilter(timestamp);
			const encoded = `${op}:${String(timestamp)}`;
			validateJavaTimestampFilters([...this.timestamps, encoded]);
			this.timestamps.push(encoded);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(value: LimitValue): this {
		this._limit = value;
		return this;
	}

	/** Sort order; the Mirror Node default is `asc`. */
	order(value: Order): this {
		validateOrder(value);
		this.params["order"] = value;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		if (this._hookId === undefined) throw new ValidationError("hookId is required (call .hookId(...))");
		const params = { ...this.params };
		const key = oneOrArray(this.keys);
		if (key !== undefined) params["key"] = key;
		if (this.timestamps.length > 0) params["timestamp"] = [...this.timestamps];
		return { id: this._id, hookId: this._hookId, params, requestedLimit: this._limit };
	}
}

/** Initializer/callback type for {@link AccountHookStorageDSL}. */
export type AccountHookStorageInit = (q: AccountHookStorageDSL) => void | AccountHookStorageDSL;

/* ----------------------------------------------------------------------------
   HBAR ALLOWANCES /api/v1/accounts/{id}/allowances/crypto
---------------------------------------------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/accounts/{id}/allowances/crypto`**.
 *
 * - `spender.id` supports `eq`, `gt`, `gte`, `lt`, and `lte` comparators.
 * - Standard `order` and `limit`.
 */
export class AccountCryptoAllowancesDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private spenderFilters: string[] = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** Filter by spender account ID directly or with a comparator (no `ne`). */
	spenderId(): ComparatorApi<string, AccountCryptoAllowancesDSL, NoNeComparatorOps>;
	spenderId(v: string | readonly string[]): this;
	spenderId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.spenderFilters, v);
			validateEntityIdOrEvmFilters(next, "spender.id", NO_NE_COMPARATOR_OPERATORS);
			this.spenderFilters = next;
			return this;
		}
		return createComparator<string, AccountCryptoAllowancesDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "spender.id");
			const next = [...this.spenderFilters, filter];
			validateEntityIdOrEvmFilters(next, "spender.id", NO_NE_COMPARATOR_OPERATORS);
			this.spenderFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params = { ...this.params };
		const spenderId = oneOrArray(this.spenderFilters);
		if (spenderId !== undefined) params["spender.id"] = spenderId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountCryptoAllowancesDSL}. */
export type AccountCryptoAllowancesInit = (q: AccountCryptoAllowancesDSL) => void | AccountCryptoAllowancesDSL;

/* ----------------------------------------------------------------------------
   TOKEN ALLOWANCES /api/v1/accounts/{id}/allowances/tokens
   Rules:
   - When `token.id` is provided, `spender.id` is required.
   - `'ne'` is not allowed on `spender.id`/`token.id`.
   - Comparator coupling (Mirror Node pagination):
     * token.lt/lte → spender.lte/eq
     * token.gt/gte → spender.gte/eq
---------------------------------------------------------------------------- */

/** Fluent builder for **GET `/api/v1/accounts/{id}/allowances/tokens`**. */
export class AccountTokenAllowancesDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private spenderFilters: string[] = [];
	private tokenFilters: string[] = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** Filter by spender ID with comparators (no `'ne'`). */
	spenderId(): ComparatorApi<string, AccountTokenAllowancesDSL, NoNeComparatorOps>;
	spenderId(v: string | readonly string[]): this;
	spenderId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.spenderFilters, v);
			validateRepeatedComparatorFilters(
				next,
				"spender.id",
				(value) => validateEntityIdOrEvmFilter(value, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.spenderFilters = next;
			return this;
		}
		return createComparator<string, AccountTokenAllowancesDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "spender.id");
			const next = [...this.spenderFilters, filter];
			validateRepeatedComparatorFilters(
				next,
				"spender.id",
				(item) => validateEntityIdOrEvmFilter(item, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.spenderFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Filter by token ID with comparators (no `'ne'`).
	 * Requires `spenderId` to be set.
	 */
	tokenId(): ComparatorApi<string, AccountTokenAllowancesDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateRepeatedComparatorFilters(
				next,
				"token.id",
				(value) => validateTokenIdFilter(value, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountTokenAllowancesDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateRepeatedComparatorFilters(
				next,
				"token.id",
				(item) => validateTokenIdFilter(item, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize and enforce comparator coupling rules. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		if (this.tokenFilters.length > 0 && this.spenderFilters.length === 0) {
			throw new ValidationError(`When 'tokenId' is provided, 'spenderId' (spender.id) is required by Mirror Node`);
		}

		const spenderOps = this.spenderFilters.map((value) => opOf(value) ?? "eq");
		const tokenOps = this.tokenFilters.map((value) => opOf(value) ?? "eq");
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

		const params = { ...this.params };
		const spenderId = oneOrArray(this.spenderFilters);
		const tokenId = oneOrArray(this.tokenFilters);
		if (spenderId !== undefined) params["spender.id"] = spenderId;
		if (tokenId !== undefined) params["token.id"] = tokenId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountTokenAllowancesDSL}. */
export type AccountTokenAllowancesInit = (q: AccountTokenAllowancesDSL) => void | AccountTokenAllowancesDSL;

/* ----------------------------------------------------------------------------
   NFT ALLOWANCES /api/v1/accounts/{id}/allowances/nfts
   Rules:
   - `view("owner" | "spender")` toggles perspective (owner=true by default).
   - `tokenId` requires `counterpartyId` (`account.id`).
   - `'ne'` is disallowed for `token.id`/`account.id`.
   - Comparator coupling (token vs account) mirrors pagination rules.
---------------------------------------------------------------------------- */

/** Fluent builder for **GET `/api/v1/accounts/{id}/allowances/nfts`**. */
export class AccountNftAllowancesDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = { owner: true }; // default owner=true
	private tokenFilters: string[] = [];
	private accountFilters: string[] = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateJavaAccountIdPath(v);
		this._id = v;
		return this;
	}

	/**
	 * Toggle perspective:
	 * - `"owner"`  → `owner=true`  (default)
	 * - `"spender"`→ `owner=false`
	 */
	view(v: "owner" | "spender"): this {
		if (v !== "owner" && v !== "spender") throw new ValidationError("view must be 'owner' or 'spender'");
		this.params["owner"] = v === "owner";
		return this;
	}

	/** Counterparty filter as `account.id` (comparators allowed, no `'ne'`). */
	counterpartyId(): ComparatorApi<string, AccountNftAllowancesDSL, NoNeComparatorOps>;
	counterpartyId(v: string | readonly string[]): this;
	counterpartyId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.accountFilters, v);
			validateEntityIdRangeFilters(next, "account.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				primary: true,
				structured: true,
				orderedBounds: true,
			});
			this.accountFilters = next;
			return this;
		}
		return createComparator<string, AccountNftAllowancesDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "account.id");
			const next = [...this.accountFilters, filter];
			validateEntityIdRangeFilters(next, "account.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				primary: true,
				structured: true,
				orderedBounds: true,
			});
			this.accountFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Token filter (`token.id`) with comparators (no `'ne'`).
	 * Requires `counterpartyId` to be set.
	 */
	tokenId(): ComparatorApi<string, AccountNftAllowancesDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS, structured: true });
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountNftAllowancesDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS, structured: true });
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize and enforce comparator coupling rules. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		if (this.tokenFilters.length > 0 && this.accountFilters.length === 0) {
			throw new ValidationError(`When 'tokenId' is provided, 'counterpartyId' (account.id) is required by Mirror Node`);
		}

		// token.lt/lte → account.lte/eq
		const accountOps = this.accountFilters.map((value) => opOf(value)?.toLowerCase() ?? "eq");
		const tokenOps = this.tokenFilters.map((value) => opOf(value)?.toLowerCase() ?? "eq");
		const accountHasLowerAndUpper =
			accountOps.some((operator) => operator === "gt" || operator === "gte") &&
			accountOps.some((operator) => operator === "lt" || operator === "lte");
		if (this.tokenFilters.length > 0) {
			validateEntityIdRangeFilters(this.tokenFilters, "token.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				structured: true,
				orderedBounds: !accountHasLowerAndUpper,
			});
		}
		const tokenUpper = tokenOps.find((operator) => operator === "lt" || operator === "lte");
		if (tokenUpper && !accountOps.some((operator) => operator === "lte" || operator === "eq")) {
			throw new ValidationError(`When token.id uses '${tokenUpper}', account.id must use 'lte' or 'eq' (Mirror Node pagination rules)`);
		}
		// token.gt/gte → account.gte/eq
		const tokenLower = tokenOps.find((operator) => operator === "gt" || operator === "gte");
		if (tokenLower && !accountOps.some((operator) => operator === "gte" || operator === "eq")) {
			throw new ValidationError(`When token.id uses '${tokenLower}', account.id must use 'gte' or 'eq' (Mirror Node pagination rules)`);
		}

		const params = { ...this.params };
		const accountId = oneOrArray(this.accountFilters);
		const tokenId = oneOrArray(this.tokenFilters);
		if (accountId !== undefined) params["account.id"] = accountId;
		if (tokenId !== undefined) params["token.id"] = tokenId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountNftAllowancesDSL}. */
export type AccountNftAllowancesInit = (q: AccountNftAllowancesDSL) => void | AccountNftAllowancesDSL;

/* ----------------------------------------------------------------------------
   TOKENS /api/v1/accounts/{id}/tokens
---------------------------------------------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/accounts/{id}/tokens`**.
 *
 * - `token.id` supports `eq`, `gt`, `gte`, `lt`, and `lte` comparators.
 */
export class AccountTokensDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private tokenFilters: string[] = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** Filter by token ID directly or with a comparator (no `ne`). */
	tokenId(): ComparatorApi<string, AccountTokensDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateTokenIdFilters(next, "token.id", NO_NE_COMPARATOR_OPERATORS);
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountTokensDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateTokenIdFilters(next, "token.id", NO_NE_COMPARATOR_OPERATORS);
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params = { ...this.params };
		const tokenId = oneOrArray(this.tokenFilters);
		if (tokenId !== undefined) params["token.id"] = tokenId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountTokensDSL}. */
export type AccountTokensInit = (q: AccountTokensDSL) => void | AccountTokensDSL;

/* ----------------------------------------------------------------------------
   NFTs OWNED /api/v1/accounts/{id}/nfts
   Rules:
   - `token.id`: comparators (no `'ne'`).
   - `serialnumber`: integer comparators; **requires** `token.id`.
   - `spender.id`: comparators (no `'ne'`).
   - Coupling: serial vs token comparator (same rule as mapper).
---------------------------------------------------------------------------- */

/** Fluent builder for **GET `/api/v1/accounts/{id}/nfts`** (owned NFTs). */
export class AccountNftsOwnedDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private tokenFilters: string[] = [];
	private serialFilters: Array<string | number> = [];
	private spenderFilters: string[] = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** `token.id` with allowed comparators (no `'ne'`). */
	tokenId(): ComparatorApi<string, AccountNftsOwnedDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateRepeatedComparatorFilters(
				next,
				"token.id",
				(value) => validateTokenIdFilter(value, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountNftsOwnedDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateRepeatedComparatorFilters(
				next,
				"token.id",
				(item) => validateTokenIdFilter(item, "token.id", NO_NE_COMPARATOR_OPERATORS),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * `serialnumber` with integer comparators (no `'ne'`).
	 * Requires `tokenId` to be set.
	 */
	serialNumber(): ComparatorApi<IntegerValue, AccountNftsOwnedDSL, NoNeComparatorOps>;
	serialNumber(v: IntegerFilter | readonly IntegerFilter[]): this;
	serialNumber(v?: IntegerFilter | readonly IntegerFilter[]) {
		if (v !== undefined) {
			const next = appendedValues(this.serialFilters, v);
			validateRepeatedComparatorFilters(
				next,
				"serialnumber",
				(value) => validateIntegerFilter(value, "serialnumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.serialFilters = next;
			return this;
		}

		return createComparator<IntegerValue, AccountNftsOwnedDSL, NoNeComparatorOps>(this, (op, value) => {
			const next = [...this.serialFilters, asEqOrOp(op, value)];
			validateRepeatedComparatorFilters(
				next,
				"serialnumber",
				(item) => validateIntegerFilter(item, "serialnumber", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS }),
				{ equalityMustBeAlone: true, maximumEqualities: 1, maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.serialFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** `spender.id` with comparators (no `'ne'`). */
	spenderId(): ComparatorApi<string, AccountNftsOwnedDSL, NoNeComparatorOps>;
	spenderId(v: string | readonly string[]): this;
	spenderId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.spenderFilters, v);
			validateRepeatedComparatorFilters(
				next,
				"spender.id",
				(value) => validateEntityIdOrEvmFilter(value, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.spenderFilters = next;
			return this;
		}
		return createComparator<string, AccountNftsOwnedDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "spender.id");
			const next = [...this.spenderFilters, filter];
			validateRepeatedComparatorFilters(
				next,
				"spender.id",
				(item) => validateEntityIdOrEvmFilter(item, "spender.id", NO_NE_COMPARATOR_OPERATORS),
				{ maximumLowerBounds: 1, maximumUpperBounds: 1 }
			);
			this.spenderFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize and enforce serial/token comparator coupling rules. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		if (this.serialFilters.length > 0 && this.tokenFilters.length === 0) {
			throw new ValidationError(`When 'serialNumber' is provided, 'tokenId' must also be provided (Mirror Node requirement)`);
		}

		const tokenOps = this.tokenFilters.map((value) => opOf(value) ?? "eq");
		const serialOps = this.serialFilters.map((value) => opOf(String(value)) ?? "eq");
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

		const params = { ...this.params };
		const tokenId = oneOrArray(this.tokenFilters);
		const serialNumber = oneOrArray(this.serialFilters.map(String));
		const spenderId = oneOrArray(this.spenderFilters);
		if (tokenId !== undefined) params["token.id"] = tokenId;
		if (serialNumber !== undefined) params["serialnumber"] = serialNumber;
		if (spenderId !== undefined) params["spender.id"] = spenderId;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountNftsOwnedDSL}. */
export type AccountNftsOwnedInit = (q: AccountNftsOwnedDSL) => void | AccountNftsOwnedDSL;

/* ----------------------------------------------------------------------------
   REWARDS /api/v1/accounts/{id}/rewards
---------------------------------------------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/accounts/{id}/rewards`**.
 *
 * - `timestamp` supports arrays and comparators except `ne`.
 */
export class AccountRewardsDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private _timestamps: Array<string | number> = [];
	private _order?: Order;

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateEntityIdOrAliasOrEvm(v);
		this._id = v;
		return this;
	}

	/** Add a timestamp filter (supports chaining to add multiple constraints). */
	timestamp(value: HederaTimestamp): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: HederaTimestamp) {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value], NO_NE_COMPARATOR_OPERATORS);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			const filter = `${op}:${String(v)}`;
			this._timestamps = validateTimestampFilters([...this._timestamps, filter], NO_NE_COMPARATOR_OPERATORS);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params: Record<string, unknown> = {};

		if (this._timestamps.length > 0) params["timestamp"] = this._timestamps;
		if (this._order) params["order"] = this._order;
		return {
			id: this._id,
			params,
			requestedLimit: this._limit,
		};
	}
}

/** Optional initializer/callback type for {@link AccountRewardsDSL}. */
export type AccountRewardsInit = (q: AccountRewardsDSL) => void | AccountRewardsDSL;

/* ----------------------------------------------------------------------------
   OUTSTANDING AIRDROPS /api/v1/accounts/{id}/airdrops/outstanding
   Rules:
   - `receiver.id`: up to two range filters; `'ne'` is rejected as ineffective.
   - `token.id`:    up to two range filters; `'ne'` is rejected as ineffective.
   - `serialnumber`: independent integer range filters (no `'ne'`).
---------------------------------------------------------------------------- */

/** Fluent builder for **GET `/api/v1/accounts/{id}/airdrops/outstanding`**. */
export class AccountOutstandingAirdropsDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private receiverFilters: string[] = [];
	private tokenFilters: string[] = [];
	private serialFilters: Array<string | number> = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateJavaAccountIdPath(v);
		this._id = v;
		return this;
	}

	/** Receiver range filter (`receiver.id`), up to two occurrences; `ne` is unsupported. */
	receiverId(): ComparatorApi<string, AccountOutstandingAirdropsDSL, NoNeComparatorOps>;
	receiverId(v: string | readonly string[]): this;
	receiverId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.receiverFilters, v);
			validateEntityIdRangeFilters(next, "receiver.id", { comparators: NO_NE_COMPARATOR_OPERATORS, primary: true, orderedBounds: true });
			this.receiverFilters = next;
			return this;
		}
		return createComparator<string, AccountOutstandingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "receiver.id");
			const next = [...this.receiverFilters, filter];
			validateEntityIdRangeFilters(next, "receiver.id", { comparators: NO_NE_COMPARATOR_OPERATORS, primary: true, orderedBounds: true });
			this.receiverFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Token range filter (`token.id`), up to two occurrences; `ne` is unsupported. */
	tokenId(): ComparatorApi<string, AccountOutstandingAirdropsDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountOutstandingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Independent serial-number filter (`serialnumber`) with integer comparators (no `'ne'`).
	 */
	serialNumber(): ComparatorApi<JavaLongRangeFilter, AccountOutstandingAirdropsDSL, NoNeComparatorOps>;
	serialNumber(v: JavaLongRangeFilter | readonly JavaLongRangeFilter[]): this;
	serialNumber(v?: JavaLongRangeFilter | readonly JavaLongRangeFilter[]) {
		if (v !== undefined) {
			const next = appendedValues(this.serialFilters, v);
			validateJavaLongRangeFilters(next, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.serialFilters = next;
			return this;
		}
		return createComparator<JavaLongRangeFilter, AccountOutstandingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			validateJavaLongRangeFilter(value, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			const filter = asEqOrOp(op, value);
			const next = [...this.serialFilters, filter];
			validateJavaLongRangeFilters(next, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.serialFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params = { ...this.params };
		const receiverId = oneOrArray(this.receiverFilters);
		const tokenId = oneOrArray(this.tokenFilters);
		const serialNumber = oneOrArray(this.serialFilters.map(String));
		if (receiverId !== undefined) params["receiver.id"] = receiverId;
		if (tokenId !== undefined) params["token.id"] = tokenId;
		if (serialNumber !== undefined) params["serialnumber"] = serialNumber;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountOutstandingAirdropsDSL}. */
export type AccountOutstandingAirdropsInit = (q: AccountOutstandingAirdropsDSL) => void | AccountOutstandingAirdropsDSL;

/* ----------------------------------------------------------------------------
   PENDING AIRDROPS /api/v1/accounts/{id}/airdrops/pending
   Rules:
   - `sender.id`: up to two range filters; `'ne'` is rejected as ineffective.
   - `token.id`:  up to two range filters; `'ne'` is rejected as ineffective.
   - `serialnumber`: independent integer range filters (no `'ne'`).
---------------------------------------------------------------------------- */

/** Fluent builder for **GET `/api/v1/accounts/{id}/airdrops/pending`**. */
export class AccountPendingAirdropsDSL {
	private _id?: string;
	private _limit?: LimitValue;
	private params: Record<string, unknown> = {};
	private senderFilters: string[] = [];
	private tokenFilters: string[] = [];
	private serialFilters: Array<string | number> = [];

	/** Path identifier (EntityId, alias, or EVM address). Required. */
	idOrAliasOrEvmAddress(v: string): this {
		validateJavaAccountIdPath(v);
		this._id = v;
		return this;
	}

	/** Sender range filter (`sender.id`), up to two occurrences; `ne` is unsupported. */
	senderId(): ComparatorApi<string, AccountPendingAirdropsDSL, NoNeComparatorOps>;
	senderId(v: string | readonly string[]): this;
	senderId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.senderFilters, v);
			validateEntityIdRangeFilters(next, "sender.id", { comparators: NO_NE_COMPARATOR_OPERATORS, primary: true, orderedBounds: true });
			this.senderFilters = next;
			return this;
		}
		return createComparator<string, AccountPendingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "sender.id");
			const next = [...this.senderFilters, filter];
			validateEntityIdRangeFilters(next, "sender.id", { comparators: NO_NE_COMPARATOR_OPERATORS, primary: true, orderedBounds: true });
			this.senderFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Token range filter (`token.id`), up to two occurrences; `ne` is unsupported. */
	tokenId(): ComparatorApi<string, AccountPendingAirdropsDSL, NoNeComparatorOps>;
	tokenId(v: string | readonly string[]): this;
	tokenId(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendedValues(this.tokenFilters, v);
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.tokenFilters = next;
			return this;
		}
		return createComparator<string, AccountPendingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			const filter = asStringEqOrOp(op, value, "token.id");
			const next = [...this.tokenFilters, filter];
			validateEntityIdRangeFilters(next, "token.id", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.tokenFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Independent serial-number filter (`serialnumber`) with integer comparators (no `'ne'`).
	 */
	serialNumber(): ComparatorApi<JavaLongRangeFilter, AccountPendingAirdropsDSL, NoNeComparatorOps>;
	serialNumber(v: JavaLongRangeFilter | readonly JavaLongRangeFilter[]): this;
	serialNumber(v?: JavaLongRangeFilter | readonly JavaLongRangeFilter[]) {
		if (v !== undefined) {
			const next = appendedValues(this.serialFilters, v);
			validateJavaLongRangeFilters(next, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.serialFilters = next;
			return this;
		}
		return createComparator<JavaLongRangeFilter, AccountPendingAirdropsDSL, NoNeComparatorOps>(this, (op, value) => {
			validateJavaLongRangeFilter(value, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			const filter = asEqOrOp(op, value);
			const next = [...this.serialFilters, filter];
			validateJavaLongRangeFilters(next, "serialnumber", { comparators: NO_NE_COMPARATOR_OPERATORS });
			this.serialFilters = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue): this {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order): this {
		validateOrder(v);
		this.params["order"] = v;
		return this;
	}

	/** Finalize the query. @internal */
	_build() {
		if (!this._id) throw new ValidationError("idOrAliasOrEvmAddress is required (call .idOrAliasOrEvmAddress(...))");
		const params = { ...this.params };
		const senderId = oneOrArray(this.senderFilters);
		const tokenId = oneOrArray(this.tokenFilters);
		const serialNumber = oneOrArray(this.serialFilters.map(String));
		if (senderId !== undefined) params["sender.id"] = senderId;
		if (tokenId !== undefined) params["token.id"] = tokenId;
		if (serialNumber !== undefined) params["serialnumber"] = serialNumber;
		return { id: this._id, params, requestedLimit: this._limit };
	}
}

/** Optional initializer/callback type for {@link AccountPendingAirdropsDSL}. */
export type AccountPendingAirdropsInit = (q: AccountPendingAirdropsDSL) => void | AccountPendingAirdropsDSL;
