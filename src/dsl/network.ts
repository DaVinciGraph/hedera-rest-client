// src/dsl/network.ts

import { ComparatorApi, createComparator, EqualComparator, NoNeComparatorOps } from "./core";

import type {
	LimitValue,
	Order,
	HederaTimestamp,
	NoNeTimestampFilter,
	NetworkSupplyQuery,
	NetworkSupplyResponse,
	NetworkSupplyType,
	NetworkFeesQuery,
	NetworkFeeEstimateRequest,
	NetworkExchangeRateQuery,
	NetworkNodesQuery,
	NetworkRegisteredNodesQuery,
	NetworkStakeQuery,
	RegisteredNodeTypeFilter,
	FeeEstimateModeInput,
	ProtobufContentType,
	ProtobufTransactionBytes,
	IntegerFilter,
	IntegerValue,
	JavaLongRangeFilter,
} from "../types";

import {
	NO_NE_COMPARATOR_OPERATORS,
	EQUALITY_COMPARATOR_OPERATORS,
	validateBoolean,
	validateEntityIdFilter,
	validateJavaLongRangeFilter,
	validateJavaLongRangeFilters,
	validateOrder,
	validateFeeEstimateMode,
	validateHighVolumeThrottle,
	validateProtobufContentType,
	validateProtobufTransactionBytes,
	validateJavaTimestampFilter,
	validateJavaTimestampFilters,
	validateNetworkSupplyType,
	validateRegisteredNodeTypeFilter,
} from "../core/utils";
import { ValidationError } from "../core/errors";

function oneOrArray<T>(values: readonly T[]): T | T[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : [...values];
}

/**
 * Network DSL
 * ===========
 * Strongly‑typed, fluent builders for /api/v1/network endpoints.
 *
 * Goals
 * -----
 * - Offer a small, discoverable, chainable API that mirrors the REST surface.
 * - Validate inputs early (timestamps, comparators, entity IDs) with helpful errors.
 * - Support both *fluent comparators* (e.g. `field().greaterThan(...)`) and
 *   *comparator‑as‑string* values (e.g. `"gt:123"`), matching mapper behavior.
 * - Produce plain query objects via `.build()`; these are later sent by the
 *   resource layer. No network requests happen here.
 *
 * Fluent comparator pattern
 * -------------------------
 * Every method that supports comparators is overloaded:
 *
 * - **Direct:** pass a value for equality, or a string like `"lt:…"` for a comparator.
 *   ```ts
 *   .timestamp("gte:1700000000")
 *   ```
 * - **Fluent:** call the method with no arguments to get a comparator API.
 *   ```ts
 *   .timestamp().greaterThanOrEqualTo(1700000000)
 *   ```
 *
 * Limits & caching hints
 * ----------------------
 * - `.limit(...)` accepts a number or `"default"` / `"max"`. The mapper will clamp
 *   and resolve these symbols using the active network’s page settings.
 * - `.useCache(true)` permits the resource layer to return an existing cached response.
 */

/* -------------------------------------------------
 * /api/v1/network/supply (single; cacheable)
 *   - timestamp: up to two rest-java filters (comparators allowed)
 *   - q: circulating | totalcoins (returns a plain-text decimal string)
 *   - useCache: boolean
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/network/supply`**.
 *
 * - Supports up to two `timestamp` filters; an optional suffix is raw nanoseconds.
 * - `.q("totalcoins")` or `.q("circulating")` selects the plain-text scalar response.
 * - Exposes `useCache` to permit a cached read downstream.
 *
 * Example
 * -------
 * ```ts
 * const q = new NetworkSupplyQueryBuilder()
 *   .timestamp().lessThanOrEqualTo("1700000100.000000000")
 *   .useCache(true)
 *   .build();
 * ```
 */
export class NetworkSupplyQueryBuilder<SupplyType extends NetworkSupplyType | undefined = undefined> {
	private _timestamps: NoNeTimestampFilter[] = [];
	private _supplyType?: NetworkSupplyType;
	private _useCache?: boolean;

	/**
	 * Add a `timestamp` filter used to retrieve supply information. Repeated calls
	 * append filters in request order.
	 *
	 * **Direct forms**
	 * - Exact timestamp: `"1700000000.123456789"` (seconds plus raw nanoseconds) or integer seconds
	 * - Comparator string: `"gte:1700000000"`
	 *
	 * **Fluent form**
	 * - Call with no argument to get comparator methods:
	 *   `.timestamp().greaterThan(1700000000)`
	 */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			validateJavaTimestampFilters([...this._timestamps, value]);
			this._timestamps.push(String(value) as NoNeTimestampFilter);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			validateJavaTimestampFilter(v);
			const encoded = `${op}:${String(v)}` as NoNeTimestampFilter;
			validateJavaTimestampFilters([...this._timestamps, encoded]);
			this._timestamps.push(encoded);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Request one supply value as an HBAR-denominated decimal string. */
	q<NextSupplyType extends NetworkSupplyType>(value: NextSupplyType): NetworkSupplyQueryBuilder<NextSupplyType> {
		validateNetworkSupplyType(value);
		this._supplyType = value;
		return this as unknown as NetworkSupplyQueryBuilder<NextSupplyType>;
	}

	/**
	 * Allow the resource layer to return an existing cached response.
	 * Builders do not perform caching themselves.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the query.
	 * @returns Plain object suitable for the resource mapper.
	 */
	build(): Omit<NetworkSupplyQuery, "q"> & (SupplyType extends NetworkSupplyType ? { q: SupplyType } : { q?: undefined }) {
		let timestamp: NetworkSupplyQuery["timestamp"];
		if (this._timestamps.length === 1) timestamp = this._timestamps[0];
		else if (this._timestamps.length > 1) timestamp = this._timestamps.slice();
		return {
			timestamp,
			q: this._supplyType,
			useCache: this._useCache,
		} as unknown as Omit<NetworkSupplyQuery, "q"> & (SupplyType extends NetworkSupplyType ? { q: SupplyType } : { q?: undefined });
	}
}

/** Return type selected by a supply DSL initializer's type state. */
export type NetworkSupplyBuilderResult<Result> = Result extends NetworkSupplyQueryBuilder<infer SupplyType>
	? SupplyType extends NetworkSupplyType
		? string
		: NetworkSupplyResponse
	: NetworkSupplyResponse | string;

/* -------------------------------------------------
 * /api/v1/network/fees (list; never cached)
 *   - timestamp: one or two rest-java filters (comparators allowed)
 *   - order
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/network/fees`**.
 *
 * - Accepts up to two `timestamp` filters (exact or comparator).
 * - Supports `order` (`"asc"` or `"desc"`).
 *
 * Example
 * -------
 * ```ts
 * const q = new NetworkFeesQueryBuilder()
 *   .timestamp().greaterThanOrEqualTo(1700000000)
 *   .timestamp().lessThan(1700003600)
 *   .order("desc")
 *   .build();
 * ```
 */
export class NetworkFeesQueryBuilder {
	private _timestamps: NoNeTimestampFilter[] = [];
	private _order?: Order;

	/**
	 * Add a `timestamp` filter. Multiple calls append multiple constraints.
	 * Accepts exact values, comparator strings, or fluent comparators.
	 */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			validateJavaTimestampFilters([...this._timestamps, value]);
			this._timestamps.push(value);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			validateJavaTimestampFilter(v);
			const encoded = `${op}:${String(v)}` as NoNeTimestampFilter;
			validateJavaTimestampFilters([...this._timestamps, encoded]);
			this._timestamps.push(encoded);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Sort order for the response (`"asc"` or `"desc"`). */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/**
	 * Finalize the query.
	 * @returns Plain object suitable for the resource mapper.
	 */
	build(): NetworkFeesQuery {
		return {
			timestamp: this._timestamps.length ? this._timestamps : undefined,
			order: this._order,
		};
	}
}

/* -------------------------------------------------
 * POST /api/v1/network/fees (transaction fee estimate)
 *   - transaction: raw protobuf bytes (required body)
 *   - mode, high_volume_throttle: query parameters
 * ------------------------------------------------- */

/** Builder for **POST `/api/v1/network/fees`**. */
export class NetworkFeeEstimateRequestBuilder {
	private _transaction?: ProtobufTransactionBytes;
	private _mode?: FeeEstimateModeInput;
	private _highVolumeThrottle?: number;
	private _contentType?: ProtobufContentType;

	/** Set the bytes of one protobuf HAPI `Transaction` (not a `TransactionList`). */
	transaction(value: ProtobufTransactionBytes): this {
		validateProtobufTransactionBytes(value);
		this._transaction = value;
		return this;
	}

	/** Select intrinsic-only estimation or estimation using current network state. */
	mode(value: FeeEstimateModeInput): this {
		validateFeeEstimateMode(value);
		this._mode = value;
		return this;
	}

	/** Set simulated high-volume throttle utilization in basis points (0..10000). */
	highVolumeThrottle(value: number): this {
		validateHighVolumeThrottle(value);
		this._highVolumeThrottle = value;
		return this;
	}

	/** Select one of the two protobuf media types accepted by Mirror Node. */
	contentType(value: ProtobufContentType): this {
		validateProtobufContentType(value);
		this._contentType = value;
		return this;
	}

	/** Finalize the fee-estimation request. */
	build(): NetworkFeeEstimateRequest {
		if (this._transaction === undefined) {
			throw new ValidationError("transaction protobuf bytes are required");
		}
		return {
			transaction: this._transaction,
			mode: this._mode,
			highVolumeThrottle: this._highVolumeThrottle,
			contentType: this._contentType,
		};
	}
}

/* -------------------------------------------------
 * /api/v1/network/exchangerate (single; cacheable)
 *   - timestamp: up to two rest-java filters (comparators allowed)
 *   - useCache: boolean
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/network/exchangerate`**.
 *
 * - Supports up to two `timestamp` filters; an optional suffix is raw nanoseconds.
 * - Exposes `useCache` to permit a cached read downstream.
 *
 * Example
 * -------
 * ```ts
 * const q = new NetworkExchangeRateQueryBuilder()
 *   .timestamp("eq:1700000000")
 *   .useCache(true)
 *   .build();
 * ```
 */
export class NetworkExchangeRateQueryBuilder {
	private _timestamps: NoNeTimestampFilter[] = [];
	private _useCache?: boolean;

	/**
	 * Add a `timestamp` filter for exchange rate selection. Repeated calls append
	 * filters in request order.
	 * Use an exact value, a comparator string (e.g. `"lte:…"`) or the fluent API.
	 */
	timestamp(value: NoNeTimestampFilter): this;
	timestamp(): ComparatorApi<HederaTimestamp, this, NoNeComparatorOps>;
	timestamp(value?: NoNeTimestampFilter) {
		if (value !== undefined) {
			validateJavaTimestampFilters([...this._timestamps, value]);
			this._timestamps.push(String(value) as NoNeTimestampFilter);
			return this;
		}
		return createComparator<HederaTimestamp, this, NoNeComparatorOps>(this, (op, v) => {
			validateJavaTimestampFilter(v);
			const encoded = `${op}:${String(v)}` as NoNeTimestampFilter;
			validateJavaTimestampFilters([...this._timestamps, encoded]);
			this._timestamps.push(encoded);
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/**
	 * Allow the resource layer to return an existing cached response.
	 * Builders do not perform caching themselves.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the query.
	 * @returns Plain object suitable for the resource mapper.
	 */
	build(): NetworkExchangeRateQuery {
		let timestamp: NetworkExchangeRateQuery["timestamp"];
		if (this._timestamps.length === 1) timestamp = this._timestamps[0];
		else if (this._timestamps.length > 1) timestamp = this._timestamps.slice();
		return {
			timestamp,
			useCache: this._useCache,
		};
	}
}

/* -------------------------------------------------
 * /api/v1/network/nodes (list; never cached)
 *   - fileId: EntityId or equality comparator (`eq`)
 *   - nodeId: int or comparator, NO 'ne' (eq|gt|gte|lt|lte)
 *   - order, limit
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/network/nodes`**.
 *
 * Filters
 * -------
 * - `fileId` — request entity ID (e.g. `"111"` or `"0.0.111"`), optionally
 *   prefixed by the equality comparator (`"eq:"`) only.
 * - `nodeId` — integer or comparator string **without** `"ne"`.
 * - `order` — `"asc" | "desc"`.
 * - `limit` — number or `"default"` / `"max"`.
 *
 * Example
 * -------
 * ```ts
 * const q = new NetworkNodesQueryBuilder()
 *   .fileId().equalTo("0.0.111")       // equality only for fileId
 *   .nodeId().greaterThanOrEqualTo(10) // 'ne' not allowed
 *   .order("asc")
 *   .limit("default")
 *   .build();
 * ```
 */
export class NetworkNodesQueryBuilder {
	private _fileId?: string;
	private _nodeIds: Array<string | number> = [];
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Set or compare `file.id`.
	 *
	 * - Direct: pass a request entity ID (`"111"`, `"0.111"`, or `"0.0.111"`) or `"eq:<id>"`.
	 * - Fluent: call with no value to use `.equalTo(...)`.
	 */
	fileId(value: string): this;
	fileId(): ComparatorApi<string, this, EqualComparator>;
	fileId(value?: string) {
		if (value !== undefined) {
			validateEntityIdFilter(value, "file.id", EQUALITY_COMPARATOR_OPERATORS);
			this._fileId = value;
			return this;
		}
		return createComparator<string, this, EqualComparator>(this, (op, v) => {
			if (typeof v !== "string") throw new ValidationError(`file.id must be a string, got: ${String(v)}`);
			const filter = `${op}:${v}`;
			validateEntityIdFilter(filter, "file.id", EQUALITY_COMPARATOR_OPERATORS);
			this._fileId = filter;
		}, EQUALITY_COMPARATOR_OPERATORS);
	}

	/**
	 * Set or compare `node.id`.
	 *
	 * - Direct: pass an integer or a comparator string (excluding `"ne"`).
	 * - Fluent: call with no value to use comparator methods (no `notEqualTo`).
	 */
	nodeId(value: JavaLongRangeFilter | readonly JavaLongRangeFilter[]): this;
	nodeId(): ComparatorApi<JavaLongRangeFilter, this, NoNeComparatorOps>;
	nodeId(value?: JavaLongRangeFilter | readonly JavaLongRangeFilter[]) {
		if (value !== undefined) {
			const additions = Array.isArray(value) ? value : [value];
			if (additions.length === 0) throw new ValidationError("node.id must contain at least one value");
			const next = [...this._nodeIds, ...additions];
			validateJavaLongRangeFilters(next, "node.id", { comparators: NO_NE_COMPARATOR_OPERATORS, rejectLtZero: true, maximum: 100, orderedBounds: true });
			this._nodeIds = next;
			return this;
		}
		return createComparator<JavaLongRangeFilter, this, NoNeComparatorOps>(this, (op, v) => {
			validateJavaLongRangeFilter(v, "node.id", { comparators: NO_NE_COMPARATOR_OPERATORS, rejectLtZero: true });
			const filter = `${op}:${String(v)}` as IntegerFilter;
			const next = [...this._nodeIds, filter];
			validateJavaLongRangeFilters(next, "node.id", { comparators: NO_NE_COMPARATOR_OPERATORS, rejectLtZero: true, maximum: 100, orderedBounds: true });
			this._nodeIds = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Sort order (`"asc"` or `"desc"`). */
	order(v: Order) {
		validateOrder(v);
		this._order = v;
		return this;
	}

	/** Requested page size (number, `"default"`, or `"max"`). */
	limit(v: LimitValue) {
		this._limit = v;
		return this;
	}

	/**
	 * Finalize the query.
	 * @returns Plain object suitable for the resource mapper.
	 */
	build(): NetworkNodesQuery {
		return {
			fileId: this._fileId,
			nodeId: oneOrArray(this._nodeIds) as NetworkNodesQuery["nodeId"],
			order: this._order,
			limit: this._limit,
		};
	}
}

/* -------------------------------------------------
 * /api/v1/network/registered-nodes (paged list)
 *   - registerednode.id: int or comparator, NO 'ne'
 *   - type: registered service category
 *   - order, limit
 * ------------------------------------------------- */

/** Builder for **GET `/api/v1/network/registered-nodes`**. */
export class NetworkRegisteredNodesQueryBuilder {
	private _registeredNodeIds: Array<string | number> = [];
	private _type?: RegisteredNodeTypeFilter;
	private _order?: Order;
	private _limit?: LimitValue;

	/**
	 * Filter by `registerednode.id`.
	 *
	 * Direct values express equality and comparator strings are accepted. Calling
	 * the method without a value exposes
	 * `eq`, `gt`, `gte`, `lt`, and `lte` comparators; `ne` is not supported by
	 * this endpoint.
	 */
	registeredNodeId(value: JavaLongRangeFilter | readonly JavaLongRangeFilter[]): this;
	registeredNodeId(): ComparatorApi<JavaLongRangeFilter, this, NoNeComparatorOps>;
	registeredNodeId(value?: JavaLongRangeFilter | readonly JavaLongRangeFilter[]) {
		if (value !== undefined) {
			const additions = Array.isArray(value) ? value : [value];
			if (additions.length === 0) throw new ValidationError("registerednode.id must contain at least one value");
			const next = [...this._registeredNodeIds, ...additions];
			validateJavaLongRangeFilters(next, "registerednode.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				rejectLtZero: true,
				maximum: 2,
				equalityMustBeAlone: true,
				orderedBounds: true,
			});
			this._registeredNodeIds = next;
			return this;
		}
		return createComparator<JavaLongRangeFilter, this, NoNeComparatorOps>(this, (op, v) => {
			validateJavaLongRangeFilter(v, "registerednode.id", { comparators: NO_NE_COMPARATOR_OPERATORS, rejectLtZero: true });
			const filter = `${op}:${String(v)}` as IntegerFilter;
			const next = [...this._registeredNodeIds, filter];
			validateJavaLongRangeFilters(next, "registerednode.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				rejectLtZero: true,
				maximum: 2,
				equalityMustBeAlone: true,
				orderedBounds: true,
			});
			this._registeredNodeIds = next;
		}, NO_NE_COMPARATOR_OPERATORS);
	}

	/** Restrict results by service category (case-insensitive, including `UNKNOWN`). */
	type(value: RegisteredNodeTypeFilter): this {
		validateRegisteredNodeTypeFilter(value);
		this._type = value;
		return this;
	}

	/** Sort order (`"asc"` or `"desc"`); the server defaults to `"asc"`. */
	order(value: Order): this {
		validateOrder(value);
		this._order = value;
		return this;
	}

	/** Requested page size (number, `"default"`, or `"max"`). */
	limit(value: LimitValue): this {
		this._limit = value;
		return this;
	}

	/** Finalize the query for the resource mapper. */
	build(): NetworkRegisteredNodesQuery {
		return {
			registeredNodeId: oneOrArray(this._registeredNodeIds) as NetworkRegisteredNodesQuery["registeredNodeId"],
			type: this._type,
			order: this._order,
			limit: this._limit,
		};
	}
}

/* -------------------------------------------------
 * /api/v1/network/stake (single; cacheable)
 *   - useCache only
 * ------------------------------------------------- */

/**
 * Builder for **GET `/api/v1/network/stake`**.
 *
 * - This endpoint is a single payload (no list paging).
 * - Exposes `useCache` to permit a cached read.
 *
 * Example
 * -------
 * ```ts
 * const q = new NetworkStakeQueryBuilder()
 *   .useCache(true)
 *   .build();
 * ```
 */
export class NetworkStakeQueryBuilder {
	private _useCache?: boolean;

	/**
	 * Allow the resource layer to return an existing cached response.
	 * Builders do not perform caching themselves.
	 */
	useCache(flag: boolean) {
		validateBoolean(flag, "useCache");
		this._useCache = flag;
		return this;
	}

	/**
	 * Finalize the query.
	 * @returns Plain object suitable for the resource mapper.
	 */
	build(): NetworkStakeQuery {
		return {
			useCache: this._useCache,
		};
	}
}
