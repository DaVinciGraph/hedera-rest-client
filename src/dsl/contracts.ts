// src/dsl/contracts.ts
import { AllComparatorOps, ComparatorApi, createComparator, EqualComparator, NoNeComparatorOps } from "./core";

import type {
	LimitValue,
	Order,
	HederaTimestamp,
	NoNeTimestampFilter,
	ContractsListQuery,
	ContractOneQuery,
	ContractResultsListQuery,
	ContractResultsByContractQuery,
	ContractResultByTimestampQuery,
	ContractResultByTransactionQuery,
	ContractLogsListQuery,
	ContractLogsByContractQuery,
	ContractStateQuery,
	ContractCallRequest,
	ContractResultActionsQuery,
	ContractOpcodesQuery,
	Int64Input,
	BlockNumberValue,
	EqualityIntegerFilter,
	IntegerFilter,
	IntegerValue,
} from "../types";

import {
	EQUALITY_COMPARATOR_OPERATORS,
	NO_NE_COMPARATOR_OPERATORS,
	parseComparatorValue,
	validateBoolean,
	validateContractIdFilter,
	validateContractFromFilter,
	validateContractResultBlockNumber,
	validateIntegerFilter,
	validateIntegerFilters,
	validateOrder,
	validateNonNegativeInt32,
	validateRepeatedComparatorFilters,
	validateRepeatedValues,
	validateTimestampFilter,
	validateTimestampFilters,
	validateTimestampValue,
	validateTimestampExact,
	validateContractIdOrAddress,
	validateEvmAddress,
	validateLogTopic,
	validateHex,
	enforceTopicTimestampWindow,
	hasEffectiveTimestampEquality,
	validateTransactionIdOrHash,
	validateContractStateSlot,
	validateContractHashFilter,
} from "../core/utils";
import { ValidationError } from "../core/errors";

function appendValues<T>(current: readonly T[], value: T | readonly T[]): T[] {
	if (Array.isArray(value) && value.length === 0) throw new ValidationError("Filter arrays must contain at least one value");
	return [...current, ...(Array.isArray(value) ? (value as readonly T[]) : [value as T])];
}

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

type LogTopicName = "topic0" | "topic1" | "topic2" | "topic3";

function appendLogTopics(current: readonly string[], topics: readonly string[], name: LogTopicName): string[] {
	if (topics.length === 0) throw new ValidationError(`${name} accepts between one and 100 values`);
	return validateRepeatedValues([...current, ...topics], name, (topic) => validateLogTopic(topic, name), 100);
}

function validateContractIdFilters(values: readonly string[]): void {
	validateRepeatedValues(values, "contract.id", (filter) => validateContractIdFilter(filter), 100);
}

function validateContractFromFilters(values: readonly string[]): void {
	validateRepeatedValues(values, "from", (filter) => validateContractFromFilter(filter), 100);
}

function validateBlockHashFilters(values: readonly string[]): void {
	validateRepeatedValues(values, "block.hash", (filter) => validateContractHashFilter(filter, "block.hash"), 100);
}

function validateBlockNumberFilters(values: readonly EqualityIntegerFilter[]): void {
	validateRepeatedValues(values, "block.number", (filter) => validateContractResultBlockNumber(filter), 100);
}

function validateTransactionIndexes(values: readonly number[]): void {
	validateRepeatedValues(
		values,
		"transaction.index",
		(value) => {
			if (typeof value !== "number") throw new ValidationError("transaction.index must be supplied as a number");
			validateNonNegativeInt32(value, "transaction.index");
		},
		100
	);
}

const LOG_BOUND_SHAPE = {
	maximum: 100,
	equalityMustBeAlone: true,
	maximumEqualities: 1,
	maximumLowerBounds: 1,
	maximumUpperBounds: 1,
} as const;

function validateLogTimestamps(values: readonly NoNeTimestampFilter[]): void {
	validateRepeatedComparatorFilters(
		values,
		"timestamp",
		(filter) => validateTimestampFilter(filter, NO_NE_COMPARATOR_OPERATORS),
		LOG_BOUND_SHAPE
	);
}

function validateLogIndexes(values: readonly IntegerFilter[]): void {
	validateRepeatedComparatorFilters(
		values,
		"index",
		(filter) =>
			validateIntegerFilter(filter, "index", {
				minimum: 0,
				maximum: "2147483647",
				maxDigits: 10,
				comparators: NO_NE_COMPARATOR_OPERATORS,
			}),
		LOG_BOUND_SHAPE
	);
}

function validateLogIndexTimestampCoupling(indexes: readonly IntegerFilter[], timestamps: readonly NoNeTimestampFilter[]): void {
	if (indexes.length === 0) return;
	if (timestamps.length === 0) throw new ValidationError("'index' requires a 'timestamp' filter");

	validateLogTimestamps(timestamps);
	validateLogIndexes(indexes);
	const timestampOperators = timestamps.map((filter) =>
		typeof filter === "number"
			? "eq"
			: (parseComparatorValue(filter, { name: "timestamp", comparators: NO_NE_COMPARATOR_OPERATORS }).operator ?? "eq")
	);
	const timestampHasEquality = hasEffectiveTimestampEquality(timestamps);
	const timestampHasInclusiveLower = timestampOperators.includes("gte");
	const timestampHasInclusiveUpper = timestampOperators.includes("lte");

	for (const filter of indexes) {
		const operator =
			typeof filter === "number"
				? "eq"
				: (parseComparatorValue(filter, { name: "index", comparators: NO_NE_COMPARATOR_OPERATORS }).operator ?? "eq");
		if (operator === "eq" && !timestampHasEquality) {
			throw new ValidationError("timestamp must use the 'eq' comparator when index uses equality");
		}
		if ((operator === "gt" || operator === "gte") && !timestampHasEquality && !timestampHasInclusiveLower) {
			throw new ValidationError("timestamp must use the 'eq' or 'gte' comparator with a lower index bound");
		}
		if ((operator === "lt" || operator === "lte") && !timestampHasEquality && !timestampHasInclusiveUpper) {
			throw new ValidationError("timestamp must use the 'eq' or 'lte' comparator with an upper index bound");
		}
	}
}

/**
 * Contracts DSL
 * ------------
 * Fluent, type‑safe builders for all api/v1/contracts endpoints.
 *
 * Each builder:
 * - Exposes a chainable API that mirrors the underlying REST parameters.
 * - Validates inputs early (IDs, timestamps, hex, ranges).
 * - Supports **fluent comparators** (e.g. `.greaterThan(...)`) as well as
 *   **comparator-as-string** inputs such as `"gt:100"`.
 * - Emulates server pagination rules where Mirror Node imposes coupling between fields.
 *
 * **How comparator methods work**
 * Call a field method with no arguments to switch into comparator mode:
 * ```ts
 * // comparator-as-string (one and done)
 * .blockNumber("gt:100")
 *
 * // fluent comparator: call the field, then the comparator
 * .blockNumber().greaterThan(100)
 * ```
 *
 * **Error handling**
 * All validation errors are thrown as {@link ValidationError}. No network calls
 * are made by these builders; they only construct validated query objects that
 * the resource layer will send over HTTP.
 */

/* ---------------------------------------
 * GET /api/v1/contracts (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts`**.
 *
 * Filters:
 * - `contractId` — accepts a request entity ID (`num`, `realm.num`, or
 *   `shard.realm.num`) or a comparator string
 *   like `"gt:0.0.100"`. For fluent comparator style, call `contractId()` with
 *   no argument and then use one of the comparator methods.
 * - `order` — `"asc" | "desc"`.
 * - `limit` — number or `"default"` / `"max"`. Symbolic values are resolved by
 *   the resource layer to the active network’s limits.
 *
 * Example:
 * ```ts
 * const q = new ContractsListQueryBuilder()
 *   .contractId().greaterThan("0.0.1000")
 *   .order("desc")
 *   .limit("default")
 *   .build();
 * ```
 */
export class ContractsListQueryBuilder {
	private _contractIds: string[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/**
	 * Filter by `contract.id` (entity ID), with optional comparator.
	 *
	 * Call with a value to set it directly (supports comparator-as-string),
	 * or call without a value to get a comparator API:
	 *
	 * ```ts
	 * .contractId("0.0.2002")          // equality
	 * .contractId("gt:0.0.1000")       // comparator-as-string
	 * .contractId().lessThan("0.0.50") // fluent comparator
	 * ```
	 */
	contractId(value: string | readonly string[]): this;
	contractId(): ComparatorApi<string, this, AllComparatorOps>;
	contractId(value?: string | readonly string[]) {
		if (value !== undefined) {
			const next = appendValues(this._contractIds, value);
			validateContractIdFilters(next);
			this._contractIds = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, v) => {
			validateContractIdFilter(v);
			const filter = `${op}:${v}`;
			const next = [...this._contractIds, filter];
			validateContractIdFilters(next);
			this._contractIds = next;
		});
	}

	/** Requested page size (number, `"default"`, or `"max"`). */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Finalize the query object for transport. */
	build(): ContractsListQuery {
		return {
			contractId: oneOrArray(this._contractIds),
			limit: this._limit,
			order: this._order,
		};
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/{idOrAddress} (one)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/{idOrAddress}`**.
 *
 * Path:
 * - `idOrAddress` — request entity ID (`num`, `realm.num`, or
 *   `shard.realm.num`) **or** 20‑byte EVM address (`0x…`).
 *
 * Filters:
 * - `timestamp` — accepts exact values or comparator expressions. Provide
 *   several to form a bounded range (e.g. `gte` + `lte`).
 * - `useCache` — permits the resource layer to return an existing cached response.
 */
export class ContractOneQueryBuilder {
	private _id?: string;
	private _timestamps: Array<string | number> = [];
	private _useCache?: boolean;

	/** Set the path ID: request entity ID shorthand/full form or a 20‑byte EVM address. */
	idOrAddress(v: string) {
		validateContractIdOrAddress(v);
		this._id = v;
		return this;
	}

	/**
	 * Add one or more `timestamp` constraints. Call with a value for
	 * equality/comparator string, or call without a value to use fluent
	 * comparators.
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

	/** Allow the resource layer to return an existing cached response. */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractOneQuery {
		if (!this._id) throw new ValidationError("idOrAddress is required");
		return {
			idOrAddress: this._id,
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			useCache: this._useCache,
		};
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/{id}/results (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/{id}/results`**.
 *
 * Path:
 * - `idOrAddress` — contract entity ID or EVM address.
 *
 * Optional filters:
 * - `timestamp` — exact/comparator; multiple values supported.
 * - `from` — sender account (request entity ID shorthand/full form or EVM address).
 * - `blockHash` — **equality only**; can be provided as `"eq:0x…"`.
 * - `blockNumber` — **equality only**; decimal or `0x` hex; can be provided as `"eq:<…>"`.
 * - `internal` — include internal results (boolean).
 * - `transactionIndex` — non‑negative 32‑bit integer; **requires** `blockHash` or `blockNumber`.
 * - `order`, `limit` — standard pagination controls.
 *
 * **Mirror rules enforced here**
 * - `blockHash` and `blockNumber` are mutually exclusive selectors.
 * - `transactionIndex` cannot be set unless `blockHash` or `blockNumber` is also set.
 */
export class ContractResultsByContractQueryBuilder {
	private _id?: string;
	private _timestamps: Array<string | number> = [];
	private _froms: string[] = [];
	private _blockHashes: string[] = [];
	private _blockNumbers: EqualityIntegerFilter[] = [];
	private _internal?: boolean;
	private _txIndexes: number[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/** Set `{idOrAddress}` path segment. */
	idOrAddress(v: string) {
		validateContractIdOrAddress(v);
		this._id = v;
		return this;
	}

	/** `timestamp` filter (multiple allowed; comparators supported). */
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

	/** Sender account: request entity ID shorthand/full form or EVM address. */
	from(v: string | readonly string[]): this;
	from(): ComparatorApi<string, this, AllComparatorOps>;
	from(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendValues(this._froms, v);
			validateContractFromFilters(next);
			this._froms = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, value) => {
			validateContractFromFilter(value);
			const filter = `${op}:${value}`;
			const next = [...this._froms, filter];
			validateContractFromFilters(next);
			this._froms = next;
		});
	}

	/** `block.hash` — equality only. Accepts last‑of‑array semantics at the mapper. */
	blockHash(value: string | readonly string[]): this;
	blockHash(): ComparatorApi<string, this, EqualComparator>;
	blockHash(value?: string | readonly string[]) {
		if (value !== undefined) {
			if (this._blockNumbers.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const next = appendValues(this._blockHashes, value);
			validateBlockHashFilters(next);
			this._blockHashes = next;
			return this;
		}
		return createComparator<string, this, EqualComparator>(this, (op, v) => {
			if (this._blockNumbers.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const filter = `${op}:${v}`;
			const next = [...this._blockHashes, filter];
			validateBlockHashFilters(next);
			this._blockHashes = next;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/** `block.number` — equality only (decimal or `0x` hex). */
	blockNumber(value: EqualityIntegerFilter | readonly EqualityIntegerFilter[]): this;
	blockNumber(): ComparatorApi<BlockNumberValue, this, EqualComparator>;
	blockNumber(value?: EqualityIntegerFilter | readonly EqualityIntegerFilter[]) {
		if (value !== undefined) {
			if (this._blockHashes.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const next = appendValues(this._blockNumbers, value);
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
			return this;
		}
		return createComparator<BlockNumberValue, this, EqualComparator>(this, (op, v) => {
			if (this._blockHashes.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const filter = `${op}:${String(v)}` as EqualityIntegerFilter;
			const next = [...this._blockNumbers, filter];
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/** Include internal results. */
	internal(flag: boolean) {
		validateBoolean(flag, "internal");
		this._internal = flag;
		return this;
	}

	/**
	 * `transaction.index` — requires `blockHash` or `blockNumber`.
	 * Must be a non‑negative 32‑bit integer.
	 */
	transactionIndex(n: number | readonly number[]) {
		const next = appendValues(this._txIndexes, n);
		validateTransactionIndexes(next);
		this._txIndexes = next;
		return this;
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractResultsByContractQuery {
		if (!this._id) throw new ValidationError("idOrAddress is required");
		if (this._blockHashes.length > 0 && this._blockNumbers.length > 0) {
			throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
		}
		if (this._txIndexes.length > 0 && this._blockHashes.length === 0 && this._blockNumbers.length === 0) {
			throw new ValidationError("'transactionIndex' requires either 'blockHash' or 'blockNumber'");
		}
		return {
			idOrAddress: this._id,
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			from: oneOrArray(this._froms),
			blockHash: oneOrArray(this._blockHashes),
			blockNumber: oneOrArray(this._blockNumbers),
			internal: this._internal,
			transactionIndex: oneOrArray(this._txIndexes),
			limit: this._limit,
			order: this._order,
		} as ContractResultsByContractQuery;
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/results (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/results`** (global results).
 *
 * Same filters as the “by contract” variant, except there is no `idOrAddress`.
 * `blockHash` and `blockNumber` are mutually exclusive selectors.
 * `transactionIndex` may be used only in combination with `blockHash` or `blockNumber`.
 * Monetary fields are returned in tinybars by default; call {@link hbar} with
 * `false` to request weibars.
 */
export class ContractResultsListQueryBuilder {
	private _timestamps: Array<string | number> = [];
	private _froms: string[] = [];
	private _blockHashes: string[] = [];
	private _blockNumbers: EqualityIntegerFilter[] = [];
	private _internal?: boolean;
	private _hbar?: boolean;
	private _txIndexes: number[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/** `timestamp` filter (multiple allowed; comparators supported). */
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

	/** Sender account (entity ID or EVM address). */
	from(v: string | readonly string[]): this;
	from(): ComparatorApi<string, this, AllComparatorOps>;
	from(v?: string | readonly string[]) {
		if (v !== undefined) {
			const next = appendValues(this._froms, v);
			validateContractFromFilters(next);
			this._froms = next;
			return this;
		}
		return createComparator<string, this, AllComparatorOps>(this, (op, value) => {
			validateContractFromFilter(value);
			const filter = `${op}:${value}`;
			const next = [...this._froms, filter];
			validateContractFromFilters(next);
			this._froms = next;
		});
	}

	/** `block.hash` — equality only (last‑of‑array semantics downstream). */
	blockHash(value: string | readonly string[]): this;
	blockHash(): ComparatorApi<string, this, EqualComparator>;
	blockHash(value?: string | readonly string[]) {
		if (value !== undefined) {
			if (this._blockNumbers.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const next = appendValues(this._blockHashes, value);
			validateBlockHashFilters(next);
			this._blockHashes = next;
			return this;
		}
		return createComparator<string, this, EqualComparator>(this, (op, v) => {
			if (this._blockNumbers.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const filter = `${op}:${v}`;
			const next = [...this._blockHashes, filter];
			validateBlockHashFilters(next);
			this._blockHashes = next;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/** `block.number` — equality only (decimal or `0x` hex). */
	blockNumber(value: EqualityIntegerFilter | readonly EqualityIntegerFilter[]): this;
	blockNumber(): ComparatorApi<BlockNumberValue, this, EqualComparator>;
	blockNumber(value?: EqualityIntegerFilter | readonly EqualityIntegerFilter[]) {
		if (value !== undefined) {
			if (this._blockHashes.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const next = appendValues(this._blockNumbers, value);
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
			return this;
		}
		return createComparator<BlockNumberValue, this, EqualComparator>(this, (op, v) => {
			if (this._blockHashes.length > 0) throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
			const filter = `${op}:${String(v)}` as EqualityIntegerFilter;
			const next = [...this._blockNumbers, filter];
			validateBlockNumberFilters(next);
			this._blockNumbers = next;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/** Include internal results. */
	internal(flag: boolean) {
		validateBoolean(flag, "internal");
		this._internal = flag;
		return this;
	}

	/**
	 * Select monetary units. `true` uses tinybars and `false` uses weibars.
	 * The Mirror Node default is `true` when this parameter is omitted.
	 */
	hbar(flag: boolean) {
		validateBoolean(flag, "hbar");
		this._hbar = flag;
		return this;
	}

	/** `transaction.index` — must be a non‑negative 32‑bit integer. */
	transactionIndex(n: number | readonly number[]) {
		const next = appendValues(this._txIndexes, n);
		validateTransactionIndexes(next);
		this._txIndexes = next;
		return this;
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractResultsListQuery {
		if (this._blockHashes.length > 0 && this._blockNumbers.length > 0) {
			throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
		}
		if (this._txIndexes.length > 0 && this._blockHashes.length === 0 && this._blockNumbers.length === 0) {
			throw new ValidationError("'transactionIndex' requires either 'blockHash' or 'blockNumber'");
		}
		return {
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			from: oneOrArray(this._froms),
			blockHash: oneOrArray(this._blockHashes),
			blockNumber: oneOrArray(this._blockNumbers),
			internal: this._internal,
			hbar: this._hbar,
			transactionIndex: oneOrArray(this._txIndexes),
			limit: this._limit,
			order: this._order,
		} as ContractResultsListQuery;
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/{id}/results/{timestamp} (one)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/{id}/results/{timestamp}`**.
 *
 * Path requirements:
 * - `idOrAddress` — contract ID or EVM address.
 * - `timestamp` — exact seconds with an optional fractional part (no comparators).
 *
 * Optional:
 * - `hbar` — `true` for tinybars (default), `false` for weibars.
 * - `useCache` — permits a cached read by the resource layer.
 */
export class ContractResultByTimestampQueryBuilder {
	private _id?: string;
	private _ts?: string;
	private _hbar?: boolean;
	private _useCache?: boolean;

	/** Set `{idOrAddress}` path segment. */
	idOrAddress(v: string) {
		validateContractIdOrAddress(v);
		this._id = v;
		return this;
	}

	/** Set the **exact** timestamp (no comparators), e.g. `"1700.000001"`. */
	timestamp(tsExact: string) {
		validateTimestampExact(tsExact);
		this._ts = tsExact;
		return this;
	}

	/**
	 * Select monetary units. `true` uses tinybars and `false` uses weibars.
	 * The Mirror Node default is `true` when this parameter is omitted.
	 */
	hbar(flag: boolean) {
		validateBoolean(flag, "hbar");
		this._hbar = flag;
		return this;
	}

	/** Allow the resource layer to return an existing cached response. */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractResultByTimestampQuery {
		if (!this._id) throw new ValidationError("idOrAddress is required");
		if (!this._ts) throw new ValidationError("timestamp is required and must be exact");
		return { idOrAddress: this._id, timestamp: this._ts, hbar: this._hbar, useCache: this._useCache };
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/results/{transactionIdOrHash} (one)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/results/{transactionIdOrHash}`**.
 *
 * Path:
 * - `transactionIdOrHash` — either a Transaction ID (`0.0.x-<seconds>-<nanos>`)
 *   or a 32‑byte EVM transaction hash (`0x…`).
 *
 * Optional:
 * - `nonce` — last value wins if called multiple times (matches server semantics).
 * - `hbar` — `true` for tinybars (default), `false` for weibars.
 * - `useCache` — permits a cached read by the resource layer.
 */
export class ContractResultByTransactionQueryBuilder {
	private _id?: string;
	private _nonces: IntegerValue[] = [];
	private _hbar?: boolean;
	private _useCache?: boolean;

	/** Set `{transactionIdOrHash}` path segment. */
	transactionIdOrHash(v: string) {
		validateTransactionIdOrHash(v);
		this._id = v;
		return this;
	}

	/** Optional `nonce`; the last provided value is used. */
	nonce(n: IntegerValue | readonly IntegerValue[]) {
		const next = appendValues(this._nonces, n);
		validateRepeatedValues(next, "nonce", (value) => validateNonNegativeInt32(value, "nonce"), 100);
		this._nonces = next;
		return this;
	}

	/**
	 * Select monetary units. `true` uses tinybars and `false` uses weibars.
	 * The Mirror Node default is `true` when this parameter is omitted.
	 */
	hbar(flag: boolean) {
		validateBoolean(flag, "hbar");
		this._hbar = flag;
		return this;
	}

	/** Allow the resource layer to return an existing cached response. */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractResultByTransactionQuery {
		if (!this._id) throw new ValidationError("transactionIdOrHash is required");
		return { transactionIdOrHash: this._id, nonce: oneOrArray(this._nonces), hbar: this._hbar, useCache: this._useCache };
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/results/logs (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/results/logs`**.
 *
 * Filters:
 * - `topic0..topic3` — arrays of 1–64 hex-digit values with an optional `0x` prefix.
 * - `timestamp` — required when using topics; must define a window ≤ 7 days
 * - `index` — integer or comparator (no `"ne"`); **requires** `timestamp`.
 * - `transaction.hash` — a single **equality-only** hash filter.
 * - `order`, `limit` — standard pagination controls.
 *
 * **Mirror rules enforced here**
 * - If any `topicX` is used, a timestamp filter with window ≤ 7 days is required.
 * - `index` cannot be used without `timestamp`.
 */
export class ContractLogsListQueryBuilder {
	private _t0: string[] = [];
	private _t1: string[] = [];
	private _t2: string[] = [];
	private _t3: string[] = [];
	private _timestamps: NoNeTimestampFilter[] = [];
	private _indexes: IntegerFilter[] = [];
	private _txHash?: string;
	private _limit?: LimitValue;
	private _order?: Order;

	/** Append one or more `topic0` values (1–64 hex digits, optional `0x`). */
	topic0(...topics: string[]) {
		this._t0 = appendLogTopics(this._t0, topics, "topic0");
		return this;
	}
	/** Append one or more `topic1` values (1–64 hex digits, optional `0x`). */
	topic1(...topics: string[]) {
		this._t1 = appendLogTopics(this._t1, topics, "topic1");
		return this;
	}
	/** Append one or more `topic2` values (1–64 hex digits, optional `0x`). */
	topic2(...topics: string[]) {
		this._t2 = appendLogTopics(this._t2, topics, "topic2");
		return this;
	}
	/** Append one or more `topic3` values (1–64 hex digits, optional `0x`). */
	topic3(...topics: string[]) {
		this._t3 = appendLogTopics(this._t3, topics, "topic3");
		return this;
	}

	/** Add `timestamp` constraints; comparators supported. */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			validateTimestampFilter(value, NO_NE_COMPARATOR_OPERATORS);
			this._timestamps.push(value);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			validateTimestampValue(v);
			this._timestamps.push(`${op}:${String(v)}` as NoNeTimestampFilter);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Set or compare `index` (no `"ne"`). Requires a timestamp filter to be present.
	 * ```ts
	 * .index(5)                   // eq:5
	 * .index().greaterThan(100)   // gt:100
	 * ```
	 */
	index(value: IntegerFilter | readonly IntegerFilter[]): this;
	index(): ComparatorApi<IntegerValue, this, NoNeComparatorOps>;
	index(value?: IntegerFilter | readonly IntegerFilter[]) {
		if (value !== undefined) {
			const next = appendValues(this._indexes, value);
			validateLogIndexes(next);
			this._indexes = next;
			return this;
		}
		return createComparator<IntegerValue, this, NoNeComparatorOps>(this, (op, v) => {
			const filter = `${op}:${String(v)}` as IntegerFilter;
			const next = [...this._indexes, filter];
			validateLogIndexes(next);
			this._indexes = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Transaction hash — one equality-only value. */
	transactionHash(value: string): this;
	transactionHash(): ComparatorApi<string, this, EqualComparator>;
	transactionHash(value?: string) {
		if (value !== undefined) {
			validateContractHashFilter(value, "transaction.hash");
			this._txHash = value;
			return this;
		}
		return createComparator<string, this, EqualComparator>(this, (op, v) => {
			const filter = `${op}:${v}`;
			validateContractHashFilter(filter, "transaction.hash");
			this._txHash = filter;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}
	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload and enforce topic/timestamp rules. */
	build(): ContractLogsListQuery {
		const hasTopic = this._t0.length || this._t1.length || this._t2.length || this._t3.length;
		enforceTopicTimestampWindow(this._timestamps.length ? this._timestamps : undefined, !!hasTopic);
		if (this._timestamps.length > 0) validateLogTimestamps(this._timestamps);
		validateLogIndexTimestampCoupling(this._indexes, this._timestamps);
		return {
			topic0: this._t0.length ? this._t0 : undefined,
			topic1: this._t1.length ? this._t1 : undefined,
			topic2: this._t2.length ? this._t2 : undefined,
			topic3: this._t3.length ? this._t3 : undefined,
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			index: oneOrArray(this._indexes),
			transactionHash: this._txHash,
			limit: this._limit,
			order: this._order,
		} as ContractLogsListQuery;
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/{id}/results/logs (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/{id}/results/logs`**.
 *
 * Path:
 * - `idOrAddress` — contract ID or EVM address.
 *
 * Filters:
 * - `topic0..topic3` — one or more 1–64 hex-digit values, optional `0x`.
 * - `timestamp` — required when any topic is set; window ≤ 7 days.
 * - `index` — integer or comparator (no `"ne"`); **requires** `timestamp`.
 * - `order`, `limit` — standard pagination controls.
 */
export class ContractLogsByContractQueryBuilder {
	private _id?: string;
	private _t0: string[] = [];
	private _t1: string[] = [];
	private _t2: string[] = [];
	private _t3: string[] = [];
	private _timestamps: NoNeTimestampFilter[] = [];
	private _indexes: IntegerFilter[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/** Set `{idOrAddress}` path segment. */
	idOrAddress(v: string) {
		validateContractIdOrAddress(v);
		this._id = v;
		return this;
	}

	/** Append one or more topic filters (1..64 hex digits, optional `0x`). */
	topic0(...topics: string[]) {
		this._t0 = appendLogTopics(this._t0, topics, "topic0");
		return this;
	}
	topic1(...topics: string[]) {
		this._t1 = appendLogTopics(this._t1, topics, "topic1");
		return this;
	}
	topic2(...topics: string[]) {
		this._t2 = appendLogTopics(this._t2, topics, "topic2");
		return this;
	}
	topic3(...topics: string[]) {
		this._t3 = appendLogTopics(this._t3, topics, "topic3");
		return this;
	}

	/** Add `timestamp` constraints; comparators supported. */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			validateTimestampFilter(value, NO_NE_COMPARATOR_OPERATORS);
			this._timestamps.push(value);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			validateTimestampValue(v);
			this._timestamps.push(`${op}:${String(v)}` as NoNeTimestampFilter);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Set or compare `index` (no `"ne"`). Requires a timestamp filter to be present.
	 */
	index(value: IntegerFilter | readonly IntegerFilter[]): this;
	index(): ComparatorApi<IntegerValue, this, NoNeComparatorOps>;
	index(value?: IntegerFilter | readonly IntegerFilter[]) {
		if (value !== undefined) {
			const next = appendValues(this._indexes, value);
			validateLogIndexes(next);
			this._indexes = next;
			return this;
		}
		return createComparator<IntegerValue, this, NoNeComparatorOps>(this, (op, v) => {
			const filter = `${op}:${String(v)}` as IntegerFilter;
			const next = [...this._indexes, filter];
			validateLogIndexes(next);
			this._indexes = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}
	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload and enforce topic/timestamp rules. */
	build(): ContractLogsByContractQuery {
		if (!this._id) throw new ValidationError("idOrAddress is required");
		const hasTopic = this._t0.length > 0 || this._t1.length > 0 || this._t2.length > 0 || this._t3.length > 0;
		enforceTopicTimestampWindow(this._timestamps.length ? this._timestamps : undefined, hasTopic);
		if (this._timestamps.length > 0) validateLogTimestamps(this._timestamps);
		validateLogIndexTimestampCoupling(this._indexes, this._timestamps);
		return {
			idOrAddress: this._id,
			topic0: this._t0.length ? this._t0 : undefined,
			topic1: this._t1.length ? this._t1 : undefined,
			topic2: this._t2.length ? this._t2 : undefined,
			topic3: this._t3.length ? this._t3 : undefined,
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			index: oneOrArray(this._indexes),
			limit: this._limit,
			order: this._order,
		} as ContractLogsByContractQuery;
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/{id}/state (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/{id}/state`**.
 *
 * Path:
 * - `idOrAddress` — contract ID or EVM address.
 *
 * Filters:
 * - `slot` — one or more 1–64 hex-digit keys; `eq|gt|gte|lt|lte` supported.
 * - `timestamp` — exact or `eq|gt|gte|lt|lte`; multiple values allowed.
 * - `order`, `limit` — standard pagination controls.
 */
export class ContractStateQueryBuilder {
	private _id?: string;
	private _slots: string[] = [];
	private _timestamps: NoNeTimestampFilter[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/** Set `{idOrAddress}` path segment. */
	idOrAddress(v: string) {
		validateContractIdOrAddress(v);
		this._id = v;
		return this;
	}

	/** Add storage-slot filters directly, or use a no-`ne` comparator API. */
	slot(first: string, ...rest: string[]): this;
	slot(): ComparatorApi<string, this, NoNeComparatorOps>;
	slot(first?: string, ...rest: string[]) {
		if (first !== undefined) {
			const slots = [first, ...rest];
			const next = [...this._slots, ...slots];
			validateRepeatedValues(next, "slot", validateContractStateSlot, 100);
			this._slots = next;
			return this;
		}
		return createComparator<string, this, NoNeComparatorOps>(this, (op, slot) => {
			const encoded = `${op}:${slot}`;
			const next = [...this._slots, encoded];
			validateRepeatedValues(next, "slot", validateContractStateSlot, 100);
			this._slots = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Add `timestamp` constraints; comparators supported. */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			this._timestamps = validateTimestampFilters([...this._timestamps, value], NO_NE_COMPARATOR_OPERATORS);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			this._timestamps = validateTimestampFilters(
				[...this._timestamps, `${op}:${String(v)}` as NoNeTimestampFilter],
				NO_NE_COMPARATOR_OPERATORS
			);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}
	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractStateQuery {
		if (!this._id) throw new ValidationError("idOrAddress is required");
		return {
			idOrAddress: this._id,
			slot: oneOrArray(this._slots),
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			limit: this._limit,
			order: this._order,
		};
	}
}

/* ---------------------------------------
 * POST /api/v1/contracts/call
 * ------------------------------------- */

/**
 * Fluent builder for **POST `/api/v1/contracts/call`**.
 *
 * Body fields:
 * - `to` (required) — 20‑byte EVM address (`0x…`).
 * - `from` (optional/nullable) — 20‑byte EVM address (`0x…`).
 * - `data` (optional/nullable) — call data hex (may include `0x`; validated downstream for length/parity).
 * - `block` (optional/nullable) — `"latest" | "pending" | "earliest"` or hex block number.
 * - `estimate` (optional/nullable) — if `true`, `block` must be `"latest"` or omitted.
 * - `gas`, `gasPrice`, `value` (optional/nullable) — non‑negative integers as safe numbers or decimal strings.
 *
 * Notes:
 * - This builder performs basic shape validation; detailed validation (e.g.,
 *   hex parity and size limits for `data`) occurs in the mapper.
 */
export class ContractCallRequestBuilder {
	private _to?: string;
	private _from?: string | null;
	private _data?: string | null;
	private _block?: string | null;
	private _estimate?: boolean | null;
	private _gas?: Int64Input | null;
	private _gasPrice?: Int64Input | null;
	private _value?: Int64Input | null;

	/** Set `to` (required): 20‑byte EVM address. */
	to(addr: string) {
		validateEvmAddress(addr, "to");
		this._to = addr;
		return this;
	}
	/** Set optional/nullable `from`: 20‑byte EVM address. */
	from(addr: string | null) {
		if (addr !== null) validateEvmAddress(addr, "from");
		this._from = addr;
		return this;
	}
	/** Set optional/nullable call `data` (validated downstream for hex/parity/size). */
	data(hex: string | null) {
		this._data = hex;
		return this;
	}
	/** Set optional/nullable `block` tag or hex block number. */
	block(tagOrHex: string | null) {
		this._block = tagOrHex;
		return this;
	}
	/** Set optional/nullable `estimate` flag. If true, `block` must be `"latest"` or omitted. */
	estimate(flag: boolean | null) {
		if (flag !== null) validateBoolean(flag, "estimate");
		this._estimate = flag;
		return this;
	}
	/** Set optional/nullable `gas` limit (non‑negative integer). */
	gas(v: Int64Input | null) {
		this._gas = v;
		return this;
	}
	/** Set optional/nullable `gasPrice` (non‑negative integer). */
	gasPrice(v: Int64Input | null) {
		this._gasPrice = v;
		return this;
	}
	/** Set optional/nullable `value` (non‑negative integer, number or decimal string). */
	value(v: Int64Input | null) {
		this._value = v;
		return this;
	}

	/** Build the final POST body; throws if `to` is missing. */
	build(): ContractCallRequest {
		if (!this._to) throw new ValidationError("'to' is required for /contracts/call");
		return {
			to: this._to,
			from: this._from === undefined ? undefined : this._from,
			data: this._data === undefined ? undefined : this._data,
			block: this._block === undefined ? undefined : this._block,
			estimate: this._estimate === undefined ? undefined : this._estimate,
			gas: this._gas === undefined ? undefined : this._gas,
			gasPrice: this._gasPrice === undefined ? undefined : this._gasPrice,
			value: this._value === undefined ? undefined : this._value,
		};
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/results/{id}/actions (list)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/results/{transactionIdOrHash}/actions`**.
 *
 * Path:
 * - `transactionIdOrHash` — Transaction ID or 32‑byte EVM tx hash.
 *
 * Filters:
 * - `index` — integer or comparator (no `"ne"`).
 * - `order`, `limit` — standard pagination controls.
 */
export class ContractActionsQueryBuilder {
	private _id?: string;
	private _indexes: IntegerFilter[] = [];
	private _limit?: LimitValue;
	private _order?: Order;

	/** Set `{transactionIdOrHash}` path segment. */
	transactionIdOrHash(v: string) {
		validateTransactionIdOrHash(v);
		this._id = v;
		return this;
	}

	/**
	 * Set or compare `index` (no `"ne"`).
	 * ```ts
	 * .index(1)                 // eq:1
	 * .index().lessThan(10)     // lt:10
	 * ```
	 */
	index(value: IntegerFilter | readonly IntegerFilter[]): this;
	index(): ComparatorApi<IntegerValue, this, NoNeComparatorOps>;
	index(value?: IntegerFilter | readonly IntegerFilter[]) {
		if (value !== undefined) {
			const next = appendValues(this._indexes, value);
			validateIntegerFilters(next, "index", { minimum: 0, maximum: "2147483647", maxDigits: 10, comparators: NO_NE_COMPARATOR_OPERATORS }, 100);
			this._indexes = next;
			return this;
		}
		return createComparator<IntegerValue, this, NoNeComparatorOps>(this, (op, v) => {
			const filter = `${op}:${String(v)}` as IntegerFilter;
			const next = [...this._indexes, filter];
			validateIntegerFilters(next, "index", { minimum: 0, maximum: "2147483647", maxDigits: 10, comparators: NO_NE_COMPARATOR_OPERATORS }, 100);
			this._indexes = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Requested page size. */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}
	/** Sort order. */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractResultActionsQuery {
		if (!this._id) throw new ValidationError("transactionIdOrHash is required");
		return {
			transactionIdOrHash: this._id,
			index: oneOrArray(this._indexes),
			limit: this._limit,
			order: this._order,
		};
	}
}

/* ---------------------------------------
 * GET /api/v1/contracts/results/{id}/opcodes (no paging)
 * ------------------------------------- */

/**
 * Fluent builder for **GET `/api/v1/contracts/results/{transactionIdOrHash}/opcodes`**.
 *
 * Path:
 * - `transactionIdOrHash` — Transaction ID or 32‑byte EVM tx hash.
 *
 * Flags:
 * - `stack`, `memory`, `storage` — booleans indicating whether to include
 *   the respective sections in the response payload.
 */
export class ContractOpcodesQueryBuilder {
	private _id?: string;
	private _stack?: boolean;
	private _memory?: boolean;
	private _storage?: boolean;

	/** Set `{transactionIdOrHash}` path segment. */
	transactionIdOrHash(v: string) {
		validateTransactionIdOrHash(v);
		this._id = v;
		return this;
	}
	/** Include EVM stack section. */
	stack(flag: boolean) {
		validateBoolean(flag, "stack");
		this._stack = flag;
		return this;
	}
	/** Include EVM memory section. */
	memory(flag: boolean) {
		validateBoolean(flag, "memory");
		this._memory = flag;
		return this;
	}
	/** Include storage diffs section. */
	storage(flag: boolean) {
		validateBoolean(flag, "storage");
		this._storage = flag;
		return this;
	}

	/** Build the final request payload. */
	build(): ContractOpcodesQuery {
		if (!this._id) throw new ValidationError("transactionIdOrHash is required");
		return {
			transactionIdOrHash: this._id,
			stack: this._stack,
			memory: this._memory,
			storage: this._storage,
		};
	}
}
