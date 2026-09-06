// src/resources/contracts/mapper.ts

import type {
	// queries
	ContractsListQuery,
	ContractOneQuery,
	ContractResultsListQuery,
	ContractResultsByContractQuery,
	ContractResultByTransactionQuery,
	ContractResultByTimestampQuery,
	ContractLogsListQuery,
	ContractLogsByContractQuery,
	ContractStateQuery,
	ContractCallRequest,
	ContractResultActionsQuery,
	ContractResultStateChangesQuery,
	ContractOpcodesQuery,
	IntegerFilter,
	NoNeTimestampFilter,
} from "../../types";

import {
	NO_NE_COMPARATOR_OPERATORS,
	assertAllowedObjectKeys,
	parseComparatorValue,
	validateContractIdFilter,
	validateContractFromFilter,
	validateContractResultBlockNumber,
	validateIntegerFilters,
	validateNonNegativeInt32,
	validateNonNegativeInt64,
	validateRepeatedComparatorFilters,
	validateRepeatedValues,
	validateTimestampFilter,
	validateTimestampFilters,
	validateTimestampExact,
	validateTransactionIdStr,
	validateEvmAddress,
	validateLogTopic,
	validateContractIdOrAddress,
	validateHex,
	enforceTopicTimestampWindow,
	hasEffectiveTimestampEquality,
	validateTransactionIdOrHash,
	validateContractStateSlot,
	validateContractHashFilter,
	validateOptionalBoolean,
	validateOrder,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";
import { LosslessNumber } from "lossless-json";

function oneOrArray<T>(values: readonly T[]): T | T[] {
	return values.length === 1 ? values[0] : [...values];
}

function assignOrder(params: Record<string, any>, order: unknown): void {
	if (order === undefined) return;
	validateOrder(order);
	params["order"] = order;
}

function validateContractIdFilters(value: string | readonly string[]): string[] {
	return validateRepeatedValues(value, "contract.id", (filter) => validateContractIdFilter(filter), 100);
}

function validateContractFromFilters(value: string | readonly string[]): string[] {
	return validateRepeatedValues(value, "from", (filter) => validateContractFromFilter(filter), 100);
}

function validateContractResultBlockHashes(value: string | readonly string[]): string[] {
	return validateRepeatedValues(value, "block.hash", (filter) => validateContractHashFilter(filter, "block.hash"), 100);
}

function validateContractResultBlockNumbers(value: string | number | readonly (string | number)[]): Array<string | number> {
	return validateRepeatedValues(value, "block.number", (filter) => validateContractResultBlockNumber(filter), 100);
}

function validateTransactionIndexes(value: number | readonly number[]): number[] {
	return validateRepeatedValues(
		value,
		"transaction.index",
		(filter) => {
			if (typeof filter !== "number") throw new ValidationError("transaction.index must be supplied as a number");
			validateNonNegativeInt32(filter, "transaction.index");
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

function validateLogTimestampFilters(value: NoNeTimestampFilter | readonly NoNeTimestampFilter[]): NoNeTimestampFilter[] {
	return validateRepeatedComparatorFilters(
		value,
		"timestamp",
		(filter) => validateTimestampFilter(filter, NO_NE_COMPARATOR_OPERATORS),
		LOG_BOUND_SHAPE
	);
}

function validateLogIndexFilters(value: IntegerFilter | readonly IntegerFilter[], timestamps?: readonly NoNeTimestampFilter[]): IntegerFilter[] {
	const values = validateRepeatedComparatorFilters(
		value,
		"index",
		(filter) =>
			validateIntegerFilters(filter, "index", {
				minimum: 0,
				maximum: "2147483647",
				maxDigits: 10,
				comparators: NO_NE_COMPARATOR_OPERATORS,
			}),
		LOG_BOUND_SHAPE
	);

	if (!timestamps) {
		throw new ValidationError(`'index' requires a 'timestamp' filter for /contracts/results/logs`);
	}

	const timestampOperators = timestamps.map((filter) =>
		typeof filter === "number"
			? "eq"
			: (parseComparatorValue(filter, { name: "timestamp", comparators: NO_NE_COMPARATOR_OPERATORS }).operator ?? "eq")
	);
	const timestampHasEquality = hasEffectiveTimestampEquality(timestamps);
	const timestampHasInclusiveLower = timestampOperators.includes("gte");
	const timestampHasInclusiveUpper = timestampOperators.includes("lte");

	for (const filter of values) {
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

	return values;
}

/** Map only the query fields shared by global and contract-scoped log routes. */
function mapSharedContractLogFilters(q?: ContractLogsListQuery | ContractLogsByContractQuery): Record<string, any> {
	const params: Record<string, any> = {};
	if (!q) return params;

	let hasTopic = false;
	const setTopic = (name: "topic0" | "topic1" | "topic2" | "topic3", value?: string | readonly string[]) => {
		if (value === undefined) return;
		const topics = validateRepeatedValues(value, name, (topic) => validateLogTopic(topic, name), 100);
		params[name] = topics;
		hasTopic = true;
	};
	setTopic("topic0", q.topic0);
	setTopic("topic1", q.topic1);
	setTopic("topic2", q.topic2);
	setTopic("topic3", q.topic3);

	const timestampValues = q.timestamp === undefined ? undefined : validateLogTimestampFilters(q.timestamp);
	if (timestampValues) params["timestamp"] = timestampValues.map(String);
	enforceTopicTimestampWindow(q.timestamp, hasTopic);

	if (q.index !== undefined) {
		const values = validateLogIndexFilters(q.index, timestampValues);
		params["index"] = oneOrArray(values);
	}
	if (q.limit !== undefined) params["limit"] = q.limit;
	assignOrder(params, q.order);

	return params;
}

/**
 * Map high‑level query objects for **Contracts** into the exact request
 * parameters expected by the Mirror Node REST API.
 *
 * Scope of this class
 * -------------------
 * - **Pure mapping + validation only.**
 * - No HTTP, no paging, no caching, no failover decisions.
 * - Ensures each field conforms to the API’s accepted formats and encodes
 *   them under the parameter names used by Mirror Node endpoints.
 *
 * Why a dedicated mapper?
 * -----------------------
 * - Keeps business rules (validation, parameter normalization) in one place.
 * - Makes request building consistent across the legacy object path and the DSL.
 * - Eases testing: you can test mapper outputs without issuing HTTP calls.
 */
export class ContractsMapper {
	/**
	 * Map a list query for `GET /api/v1/contracts`.
	 *
	 * Field translation
	 * -----------------
	 * - `contractId` → `"contract.id"` (supports comparator strings)
	 * - `limit`      → `"limit"` (unchanged; clamped later)
	 * - `order`      → `"order"`
	 *
	 * Validation
	 * ----------
	 * - `contractId` may be a request EntityId, an unprefixed EVM address, or a supported comparator form.
	 *
	 * @param q Optional {@link ContractsListQuery}.
	 * @returns An object of query params suitable for the transport layer.
	 * @throws {ValidationError} On malformed comparator strings or invalid ids.
	 */
	static list(q?: ContractsListQuery) {
		if (q !== undefined) assertAllowedObjectKeys(q, ["contractId", "limit", "order"], "contracts list query");
		const p: Record<string, any> = {};
		if (!q) return p;
		if (q.contractId !== undefined) {
			const values = validateContractIdFilters(q.contractId);
			p["contract.id"] = oneOrArray(values);
		}
		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return p;
	}

	/**
	 * Map a single‑contract query for `GET /api/v1/contracts/{idOrAddress}`.
	 *
	 * Behavior
	 * --------
	 * - Validates id (entity id or 0x‑address).
	 * - Normalizes `timestamp` to an array of strings.
	 * - Produces a stable `cacheKey` that ignores the order of timestamp filters.
	 *
	 * @param q {@link ContractOneQuery}
	 * @returns `{ id, params, cacheKey }`
	 * @throws {ValidationError} On invalid id or timestamp values.
	 */
	static one(q: ContractOneQuery) {
		assertAllowedObjectKeys(q, ["idOrAddress", "timestamp", "useCache"], "contract query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateContractIdOrAddress(q.idOrAddress);

		const params: Record<string, any> = {};
		let tsKey = "";

		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			params["timestamp"] = arr.map(String);

			// Normalize for cache key (stable regardless of insertion order).
			const norm = arr.map(String).slice().sort();
			tsKey = norm.join("&");
		}

		const cacheKey = `contract:${q.idOrAddress}${tsKey ? `:ts=${tsKey}` : ""}`;
		return { id: q.idOrAddress, params, cacheKey };
	}

	/**
	 * Map a global results list for `GET /api/v1/contracts/results`.
	 *
	 * Key points
	 * ----------
	 * - Supports timestamp arrays (exact or comparator).
	 * - Accepts `from` as AccountId or 0x‑address.
	 * - `block.hash`/`block.number` are mutually exclusive and eq‑only; the
	 *   last occurrence of the selected parameter wins.
	 * - Validates `transaction.index` as a 32‑bit non‑negative integer.
	 *
	 * @param q Optional {@link ContractResultsListQuery}
	 * @returns Query params for the request.
	 * @throws {ValidationError} On malformed filters.
	 */
	static resultsList(q?: ContractResultsListQuery) {
		if (q !== undefined) assertAllowedObjectKeys(q, ["from", "internal", "hbar", "timestamp", "limit", "order", "transactionIndex", "blockHash", "blockNumber"], "contract results query");
		const p: Record<string, any> = {};
		if (!q) return p;
		if (q.blockHash !== undefined && q.blockNumber !== undefined) {
			throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
		}

		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			p["timestamp"] = arr.map(String);
		}

		if (q.from !== undefined) {
			const values = validateContractFromFilters(q.from);
			p["from"] = oneOrArray(values);
		}

		if (q.blockHash !== undefined) {
			const values = validateContractResultBlockHashes(q.blockHash);
			const last = values[values.length - 1];
			p["block.hash"] = last;
		}

		if (q.blockNumber !== undefined) {
			const values = validateContractResultBlockNumbers(q.blockNumber);
			p["block.number"] = String(values[values.length - 1]);
		}

		validateOptionalBoolean(q.internal, "internal");
		if (q.internal !== undefined) {
			p["internal"] = q.internal;
		}

		if (q.hbar !== undefined) {
			if (typeof q.hbar !== "boolean") {
				throw new ValidationError(`hbar must be a boolean`);
			}
			p["hbar"] = q.hbar;
		}

		if (q.transactionIndex !== undefined) {
			const values = validateTransactionIndexes(q.transactionIndex);
			if (q.blockHash === undefined && q.blockNumber === undefined) {
				throw new ValidationError(`'transactionIndex' requires either 'blockHash' or 'blockNumber' to be provided`);
			}
			p["transaction.index"] = oneOrArray(values);
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return p;
	}

	/**
	 * Map a per‑contract results list for `GET /api/v1/contracts/{id}/results`.
	 *
	 * Additional rule
	 * ---------------
	 * - If `transactionIndex` is set, either `blockHash` or `blockNumber` must be provided.
	 *
	 * @param q {@link ContractResultsByContractQuery}
	 * @returns `{ id, params }` with the validated path id and query params.
	 * @throws {ValidationError} On invalid id or when index is used without a block filter.
	 */
	static resultsByContract(q: ContractResultsByContractQuery) {
		assertAllowedObjectKeys(q, ["idOrAddress", "from", "internal", "timestamp", "limit", "order", "transactionIndex", "blockHash", "blockNumber"], "contract results-by-contract query");
		validateContractIdOrAddress(q.idOrAddress);
		const p: Record<string, any> = {};
		if (q.blockHash !== undefined && q.blockNumber !== undefined) {
			throw new ValidationError("'blockHash' and 'blockNumber' are mutually exclusive");
		}

		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp);
			p["timestamp"] = arr.map(String);
		}

		if (q.from !== undefined) {
			const values = validateContractFromFilters(q.from);
			p["from"] = oneOrArray(values);
		}

		if (q.blockHash !== undefined) {
			const values = validateContractResultBlockHashes(q.blockHash);
			const last = values[values.length - 1];
			p["block.hash"] = last;
		}

		if (q.blockNumber !== undefined) {
			const values = validateContractResultBlockNumbers(q.blockNumber);
			p["block.number"] = String(values[values.length - 1]);
		}

		validateOptionalBoolean(q.internal, "internal");
		if (q.internal !== undefined) {
			p["internal"] = q.internal;
		}

		if (q.transactionIndex !== undefined) {
			const values = validateTransactionIndexes(q.transactionIndex);
			if (q.blockHash === undefined && q.blockNumber === undefined) {
				throw new ValidationError(`'transactionIndex' requires either 'blockHash' or 'blockNumber' to be provided`);
			}
			p["transaction.index"] = oneOrArray(values);
		}

		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);

		return { id: q.idOrAddress, params: p };
	}

	/**
	 * Map a single result by transaction id or hash:
	 * `GET /api/v1/contracts/results/{transactionIdOrHash}`.
	 *
	 * Notes
	 * -----
	 * - Accepts either a TransactionId string (`0.0.x-<seconds>-<nanos>`)
	 *   or a 32‑byte tx hash (with or without `0x`).
	 * - Optional `nonce` is normalized to a non‑negative 32‑bit integer.
	 * - `hbar` selects tinybars (`true`, the server default) or weibars (`false`).
	 * - Produces a stable `cacheKey` reflecting nonce and non-default monetary units.
	 *
	 * @param q {@link ContractResultByTransactionQuery}
	 * @returns `{ id, params, cacheKey }`
	 * @throws {ValidationError} On invalid id or nonce.
	 */
	static resultByTransaction(q: ContractResultByTransactionQuery) {
		assertAllowedObjectKeys(q, ["transactionIdOrHash", "nonce", "hbar", "useCache"], "contract result query");
		validateOptionalBoolean(q.useCache, "useCache");
		const id = q.transactionIdOrHash;
		if (!id) throw new ValidationError("transactionIdOrHash is required");

		try {
			validateTransactionIdOrHash(id);
		} catch {
			validateTransactionIdStr(id);
		}

		const params: Record<string, any> = {};
		let nonceFrag = "";
		let hbarFrag = "";

		if (q.nonce !== undefined) {
			const values = validateRepeatedValues(q.nonce, "nonce", (value) => validateNonNegativeInt32(value, "nonce"), 100);
			const lastRaw = values[values.length - 1];
			const n = Number(lastRaw);
			params["nonce"] = n;
			nonceFrag = `:nonce=${n}`;
		}

		if (q.hbar !== undefined) {
			if (typeof q.hbar !== "boolean") {
				throw new ValidationError(`hbar must be a boolean`);
			}
			params["hbar"] = q.hbar;
			// Omitted and explicit true are equivalent because the server defaults to true.
			if (!q.hbar) hbarFrag = ":hbar=false";
		}

		const cacheKey = `contractResult:${id}${nonceFrag}${hbarFrag}`;
		return { id, params, cacheKey };
	}

	/**
	 * Map a single result by timestamp:
	 * `GET /api/v1/contracts/{id}/results/{timestamp}`.
	 *
	 * @param q {@link ContractResultByTimestampQuery}
	 * `hbar` selects tinybars (`true`, the server default) or weibars (`false`).
	 *
	 * @returns `{ id, ts, params, cacheKey }`
	 * @throws {ValidationError} On invalid id or when timestamp is not exact.
	 */
	static resultByTimestamp(q: ContractResultByTimestampQuery) {
		assertAllowedObjectKeys(q, ["idOrAddress", "timestamp", "hbar", "useCache"], "contract result-by-timestamp query");
		validateOptionalBoolean(q.useCache, "useCache");
		validateContractIdOrAddress(q.idOrAddress);
		validateTimestampExact(q.timestamp);

		const params: Record<string, any> = {};
		let hbarFrag = "";
		if (q.hbar !== undefined) {
			if (typeof q.hbar !== "boolean") {
				throw new ValidationError(`hbar must be a boolean`);
			}
			params["hbar"] = q.hbar;
			// Omitted and explicit true are equivalent because the server defaults to true.
			if (!q.hbar) hbarFrag = ":hbar=false";
		}

		const cacheKey = `contractResultTs:${q.idOrAddress}:${q.timestamp}${hbarFrag}`;
		return { id: q.idOrAddress, ts: q.timestamp, params, cacheKey };
	}

	/**
	 * Map a global logs query: `GET /api/v1/contracts/results/logs`.
	 *
	 * Rules enforced
	 * --------------
	 * - Topic filters (`topic0..topic3`) accept 1–64 hex digits with optional `0x`.
	 * - If any topic is present, a `timestamp` filter is **required** and its
	 *   window must be ≤ 7 days.
	 * - `index` requires a `timestamp` and accepts `eq|gt|gte|lt|lte` (no `ne`).
	 * - `transaction.hash` is an equality-only singleton filter.
	 *
	 * @param q {@link ContractLogsListQuery}
	 * @returns Query params for the request.
	 * @throws {ValidationError} On invalid topic/index/tx hash constraints.
	 */
	static logsList(q?: ContractLogsListQuery) {
		if (q !== undefined) assertAllowedObjectKeys(q, ["topic0", "topic1", "topic2", "topic3", "index", "timestamp", "transactionHash", "limit", "order"], "contract logs query");
		const p = mapSharedContractLogFilters(q);
		if (!q) return p;

		if (q.transactionHash !== undefined) {
			validateContractHashFilter(q.transactionHash, "transaction.hash");
			p["transaction.hash"] = q.transactionHash;
		}
		return p;
	}

	/**
	 * Map a logs‑by‑contract query:
	 * `GET /api/v1/contracts/{id}/results/logs`.
	 *
	 * @param q {@link ContractLogsByContractQuery}
	 * @returns `{ id, params }` with validated id and log filters.
	 */
	static logsByContract(q: ContractLogsByContractQuery) {
		assertAllowedObjectKeys(q, ["idOrAddress", "topic0", "topic1", "topic2", "topic3", "index", "timestamp", "limit", "order"], "contract logs-by-contract query");
		validateContractIdOrAddress(q.idOrAddress);
		const params = mapSharedContractLogFilters(q);
		return { id: q.idOrAddress, params };
	}

	/**
	 * Map a contract state query: `GET /api/v1/contracts/{id}/state`.
	 *
	 * Rules
	 * -----
	 * - `slot` accepts one or more 1–64 digit hex keys and `eq|gt|gte|lt|lte`.
	 * - `timestamp` supports exact or `eq|gt|gte|lt|lte`; single or multiple.
	 *
	 * @param q {@link ContractStateQuery}
	 * @returns `{ id, params }` with validated id and state filters.
	 * @throws {ValidationError} On invalid id or slot.
	 */
	static stateQuery(q: ContractStateQuery) {
		assertAllowedObjectKeys(q, ["idOrAddress", "slot", "timestamp", "limit", "order"], "contract state query");
		validateContractIdOrAddress(q.idOrAddress);
		const p: Record<string, any> = {};
		if (q.slot !== undefined) {
			const slots = validateRepeatedValues(q.slot, "slot", validateContractStateSlot, 100);
			p["slot"] = oneOrArray(slots);
		}
		if (q.timestamp !== undefined) {
			const arr = validateTimestampFilters(q.timestamp, NO_NE_COMPARATOR_OPERATORS);
			p["timestamp"] = arr;
		}
		if (q.limit !== undefined) p["limit"] = q.limit;
		assignOrder(p, q.order);
		return { id: q.idOrAddress, params: p };
	}

	/**
	 * Validate and normalize a body for `POST /api/v1/contracts/call`.
	 *
	 * Requirements
	 * ------------
	 * - `to` is required (0x address).
	 * - `from`, `data`, `block` are optional but validated if present.
	 * - When `estimate === true`, `block` must be `"latest"` (or omitted).
	 * - `gas`, `gasPrice`, `value` are validated as non-negative int64. Safe
	 *   decimal strings retain the historical number coercion; larger values use
	 *   an internal lossless number so their exact digits remain a JSON number on
	 *   the wire.
	 * - `data` must be hex (even number of digits, ≤ 131072 bytes).
	 *
	 * @param q {@link ContractCallRequest}
	 * @returns A sanitized payload ready for transport.
	 * @throws {ValidationError} On any invalid constraint above.
	 */
	static callQuery(q: ContractCallRequest) {
		assertAllowedObjectKeys(q, ["block", "data", "estimate", "from", "gas", "gasPrice", "to", "value"], "contract call request");
		const body = q ?? ({} as ContractCallRequest);
		const cleaned: Record<string, any> = {};

		if (!body.to) {
			throw new ValidationError(`'to' is required for /contracts/call`);
		}
		validateEvmAddress(body.to, "to");
		cleaned.to = body.to;

		if (body.from !== undefined) {
			if (body.from !== null) {
				if (typeof body.from !== "string") throw new ValidationError("from must be an EVM address");
				validateEvmAddress(body.from, "from");
			}
			cleaned.from = body.from;
		}

		if (body.data !== undefined) {
			if (body.data !== null) {
				if (typeof body.data !== "string") throw new ValidationError("data must be a hexadecimal string");
				const v = body.data;
				validateHex(v, "data");
				const hex = v.startsWith("0x") ? v.slice(2) : v;
				if (hex.length % 2 !== 0) throw new ValidationError(`'data' hex must have an even number of digits`);
				if (hex.length > 262_144) throw new ValidationError(`'data' exceeds 131072 bytes (262144 hex chars)`);
			}
			cleaned.data = body.data;
		}

		if (body.block !== undefined) {
			if (body.block !== null) {
				if (typeof body.block !== "string") throw new ValidationError("block must be a string");
				const ok = /^(earliest|pending|latest)$/i.test(body.block) || /^(0x)?[0-9A-Fa-f]+$/.test(body.block);
				if (!ok) throw new ValidationError(`Invalid block tag: ${body.block}`);
			}
			cleaned.block = body.block;
		}

		if (body.estimate !== undefined) {
			if (body.estimate !== null) validateOptionalBoolean(body.estimate, "estimate");
			cleaned.estimate = body.estimate;
		}

		if (cleaned.estimate === true && cleaned.block && !/^latest$/i.test(cleaned.block)) {
			throw new ValidationError(`When 'estimate' is true, 'block' must be 'latest' (or omitted).`);
		}

		const coerceInt64 = (name: string, v: number | string | null | undefined) => {
			if (v === undefined) return undefined;
			if (v === null) return null;
			validateNonNegativeInt64(v, name, 0);
			if (typeof v === "number") return v;
			const normalized = v.replace(/^0+(?=\d)/, "");
			const numeric = Number(normalized);
			return Number.isSafeInteger(numeric) ? numeric : new LosslessNumber(normalized);
		};

		const gas = coerceInt64("gas", body.gas);
		if (gas !== undefined) {
			cleaned.gas = gas;
		}

		const gasPrice = coerceInt64("gasPrice", body.gasPrice);
		if (gasPrice !== undefined) {
			cleaned.gasPrice = gasPrice;
		}

		const value = coerceInt64("value", body.value);
		if (value !== undefined) {
			cleaned.value = value;
		}

		return cleaned;
	}

	/**
	 * Map actions list for a transaction result:
	 * `GET /api/v1/contracts/results/{id}/actions`.
	 *
	 * @param q {@link ContractResultActionsQuery}
	 * @returns `{ id, params }` with optional `index` and paging controls.
	 * @throws {ValidationError} On invalid id or index comparator.
	 */
	static actionsByResult(q: ContractResultActionsQuery) {
		assertAllowedObjectKeys(q, ["transactionIdOrHash", "index", "limit", "order"], "contract actions query");
		validateTransactionIdOrHash(q.transactionIdOrHash);
		const params: Record<string, any> = {};
		if (q.index !== undefined) {
			const values = validateIntegerFilters(
				q.index,
				"index",
				{ minimum: 0, maximum: "2147483647", maxDigits: 10, comparators: NO_NE_COMPARATOR_OPERATORS },
				100
			);
			params["index"] = oneOrArray(values);
		}
		if (q.limit !== undefined) params["limit"] = q.limit;
		assignOrder(params, q.order);
		return { id: q.transactionIdOrHash, params };
	}

	/**
	 * Map state‑changes request for a result:
	 * `GET /api/v1/contracts/results/{id}/state-changes`.
	 *
	 * @param q {@link ContractResultStateChangesQuery}
	 * @returns `{ id }`
	 * @throws {ValidationError} On invalid id format.
	 */
	static stateChangesByResult(q: ContractResultStateChangesQuery) {
		assertAllowedObjectKeys(q, ["transactionIdOrHash"], "contract state-changes query");
		validateTransactionIdOrHash(q.transactionIdOrHash);
		return { id: q.transactionIdOrHash };
	}

	/**
	 * Map opcodes request:
	 * `GET /api/v1/contracts/results/{id}/opcodes`.
	 *
	 * @param q {@link ContractOpcodesQuery}
	 * @returns `{ id, params }` with optional flags: `stack`, `memory`, `storage`.
	 * @throws {ValidationError} On invalid id format.
	 */
	static opcodes(q: ContractOpcodesQuery) {
		assertAllowedObjectKeys(q, ["transactionIdOrHash", "stack", "memory", "storage"], "contract opcodes query");
		validateTransactionIdOrHash(q.transactionIdOrHash);
		const params: Record<string, any> = {};
		for (const key of ["stack", "memory", "storage"] as const) {
			validateOptionalBoolean(q[key], key);
			if (q[key] !== undefined) params[key] = q[key];
		}
		return { id: q.transactionIdOrHash, params };
	}
}
