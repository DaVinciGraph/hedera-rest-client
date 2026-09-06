// src/resources/network/mapper.ts

import type {
	NetworkSupplyQuery,
	NetworkFeesQuery,
	NetworkFeeEstimateRequest,
	NetworkExchangeRateQuery,
	NetworkNodesQuery,
	NetworkRegisteredNodesQuery,
	NetworkStakeQuery,
	NetworkSupplyType,
	ProtobufContentType,
} from "../../types";

import {
	NO_NE_COMPARATOR_OPERATORS,
	EQUALITY_COMPARATOR_OPERATORS,
	assertAllowedObjectKeys,
	validateEntityIdFilter,
	validateFeeEstimateMode,
	validateHighVolumeThrottle,
	validateJavaLongRangeFilter,
	validateJavaLongRangeFilters,
	validateProtobufContentType,
	validateProtobufTransactionBytes,
	snapshotProtobufTransactionBytes,
	validateJavaTimestampFilters,
	validateNetworkSupplyType,
	validateOptionalBoolean,
	validateOrder,
	validateRegisteredNodeTypeFilter,
} from "../../core/utils";
import { ValidationError } from "../../core/errors";

function timestampCacheFragment(timestamp: NetworkSupplyQuery["timestamp"]): string {
	if (timestamp === undefined) return "";
	return (Array.isArray(timestamp) ? timestamp : [timestamp]).map(String).join(",");
}

/**
 * Maps high‑level **Network** queries into the exact request parameters
 * expected by the Mirror Node REST API.
 *
 * Design
 * ------
 * - **Pure transformation & validation** only: no HTTP, paging, caching, or failover logic.
 * - Centralizes field validation and parameter naming so the rest of the codebase
 *   remains consistent whether queries were built via object literals or the DSL.
 *
 * Return shapes
 * -------------
 * - Methods that correspond to **single** endpoints may return `{ params, cacheKey }`
 *   so callers can optionally perform read‑through caching.
 * - Methods that correspond to **list** endpoints return only the params object.
 *
 * Error model
 * -----------
 * - Invalid filters throw {@link ValidationError} with human‑readable messages
 *   that mirror Mirror Node constraints (e.g., timestamp format, comparator rules).
 *
 * Examples
 * --------
 * ```ts
 * // supply
 * const { params } = NetworkMapper.supply({ timestamp: "lte:1700000000.123" });
 * // -> { timestamp: "lte:1700000000.123" }
 *
 * // nodes
 * const p = NetworkMapper.nodes({ fileId: "0.0.111", nodeId: "gte:3", order: "desc", limit: 50 });
 * // -> { "file.id": "0.0.111", "node.id": "gte:3", order: "desc", limit: 50 }
 * ```
 */
export class NetworkMapper {
	/**
	 * Map `GET /api/v1/network/supply` (single; cacheable).
	 *
	 * Mapping
	 * -------
	 * - `timestamp` → `"timestamp"` (accepts up to two rest-java exact/comparator filters).
	 * - `q` → `"q"` (`circulating` or `totalcoins`, case-insensitively).
	 * - Produces a stable `cacheKey` that incorporates every timestamp and the normalized `q` mode.
	 *
	 * @param q Optional {@link NetworkSupplyQuery}.
	 * @returns `{ params, cacheKey }`
	 * @throws {ValidationError} If `timestamp` or `q` is malformed.
	 */
	static supply(q?: NetworkSupplyQuery) {
		if (q !== undefined) {
			assertAllowedObjectKeys(q, ["timestamp", "q", "useCache"], "network supply query");
			validateOptionalBoolean(q.useCache, "useCache");
		}
		const params: Record<string, any> = {};
		if (q?.timestamp !== undefined) {
			const timestamps = Array.isArray(q.timestamp) ? q.timestamp : [q.timestamp];
			validateJavaTimestampFilters(timestamps);
			params["timestamp"] = Array.isArray(q.timestamp) ? [...q.timestamp] : q.timestamp;
		}
		let supplyType: NetworkSupplyType | undefined;
		if (q?.q !== undefined) {
			validateNetworkSupplyType(q.q);
			supplyType = q.q;
			params["q"] = q.q;
		}
		const qCacheFragment = supplyType === undefined ? "" : `:q=${supplyType.toLowerCase()}`;
		const cacheKey = `network:supply:${timestampCacheFragment(q?.timestamp)}${qCacheFragment}`;
		return { params, cacheKey };
	}

	/**
	 * Map `GET /api/v1/network/fees` (list; never cached).
	 *
	 * Mapping
	 * -------
	 * - `timestamp` → `"timestamp"`; supports single value or array (exact or comparator).
	 * - `order`     → `"order"` (server default is ascending when omitted).
	 *
	 * @param q Optional {@link NetworkFeesQuery}.
	 * @returns Query params object.
	 * @throws {ValidationError} If any timestamp filter is malformed.
	 */
	static fees(q?: NetworkFeesQuery) {
		if (q !== undefined) assertAllowedObjectKeys(q, ["timestamp", "order"], "network fees query");
		const params: Record<string, any> = {};
		if (q?.timestamp !== undefined) {
			const arr = Array.isArray(q.timestamp) ? q.timestamp : [q.timestamp];
			validateJavaTimestampFilters(arr);
			params["timestamp"] = arr;
		}
		if (q?.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}
		return params;
	}

	/**
	 * Map `GET /api/v1/network/exchangerate` (single; cacheable).
	 *
	 * Mapping
	 * -------
	 * - `timestamp` → `"timestamp"` (up to two rest-java exact/comparator filters).
	 * - Produces `cacheKey` based on every timestamp to support optional caching.
	 *
	 * @param q Optional {@link NetworkExchangeRateQuery}.
	 * @returns `{ params, cacheKey }`
	 * @throws {ValidationError} If `timestamp` is malformed.
	 */
	static exchangeRate(q?: NetworkExchangeRateQuery) {
		if (q !== undefined) {
			assertAllowedObjectKeys(q, ["timestamp", "useCache"], "network exchange-rate query");
			validateOptionalBoolean(q.useCache, "useCache");
		}
		const params: Record<string, any> = {};
		if (q?.timestamp !== undefined) {
			const timestamps = Array.isArray(q.timestamp) ? q.timestamp : [q.timestamp];
			validateJavaTimestampFilters(timestamps);
			params["timestamp"] = Array.isArray(q.timestamp) ? [...q.timestamp] : q.timestamp;
		}
		const cacheKey = `network:exchangerate:${timestampCacheFragment(q?.timestamp)}`;
		return { params, cacheKey };
	}

	/**
	 * Map `GET /api/v1/network/nodes` (list; never cached).
	 *
	 * Mapping
	 * -------
	 * - `fileId` → `"file.id"`:
	 *   - Accepts a request **EntityId** (e.g., `"111"` or `"0.0.111"`), optionally prefixed by `"eq:"`.
	 * - `nodeId` → `"node.id"`:
	 *   - Accepts a **non‑negative integer** or a comparator string **without** `ne`
	 *     (`"eq|gt|gte|lt|lte:<int>"`).
	 * - `order`  → `"order"`; `limit` → `"limit"` (the numeric limit is later clamped by the builder).
	 *
	 * Validation rules
	 * ----------------
	 * - `fileId` accepts request-ID shorthand and the equality comparator only.
	 * - `nodeId`:
	 *   - Plain numbers must be non‑negative integers.
	 *   - Comparator strings cannot use `ne` and must target an integer (up to 19 digits).
	 *
	 * @param q Optional {@link NetworkNodesQuery}.
	 * @returns Query params object.
	 * @throws {ValidationError} If any constraint above is violated.
	 */
	static nodes(q?: NetworkNodesQuery) {
		const params: Record<string, any> = {};
		if (q === undefined) return params;
		assertAllowedObjectKeys(q, ["fileId", "nodeId", "order", "limit"], "network nodes query");

		// file.id (EntityId or equality comparator)
		if (q.fileId !== undefined) {
			validateEntityIdFilter(q.fileId, "file.id", EQUALITY_COMPARATOR_OPERATORS);
			params["file.id"] = q.fileId;
		}

		// node.id (integer or comparator; NO 'ne')
		if (q.nodeId !== undefined) {
			const nodeIds = validateJavaLongRangeFilters(q.nodeId, "node.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				rejectLtZero: true,
				maximum: 100,
				orderedBounds: true,
			});
			params["node.id"] = Array.isArray(q.nodeId) ? nodeIds.map(String) : String(nodeIds[0]);
		}

		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}
		// The builder resolves this against the endpoint policy (public: default 10, max 25).
		if (q.limit !== undefined) params["limit"] = q.limit;

		return params;
	}

	/** Map and validate `POST /api/v1/network/fees`. */
	static estimateFees(q: NetworkFeeEstimateRequest) {
		if (!q || q.transaction === undefined) {
			throw new ValidationError("transaction protobuf bytes are required");
		}
		assertAllowedObjectKeys(q, ["transaction", "mode", "highVolumeThrottle", "contentType"], "network fee estimate request");
		validateProtobufTransactionBytes(q.transaction);

		const params: Record<string, any> = {};
		if (q.mode !== undefined) {
			validateFeeEstimateMode(q.mode);
			params["mode"] = q.mode;
		}
		if (q.highVolumeThrottle !== undefined) {
			validateHighVolumeThrottle(q.highVolumeThrottle);
			params["high_volume_throttle"] = q.highVolumeThrottle;
		}

		const contentType: ProtobufContentType = q.contentType === undefined ? "application/protobuf" : q.contentType;
		validateProtobufContentType(contentType);

		return { body: snapshotProtobufTransactionBytes(q.transaction), params, contentType };
	}

	/**
	 * Map `GET /api/v1/network/registered-nodes` (paged list; never cached).
	 *
	 * Mapping
	 * -------
	 * - `registeredNodeId` -> `"registerednode.id"`; accepts a non-negative
	 *   integer or `eq|gt|gte|lt|lte:<integer>` (but not `ne`).
	 * - `type` -> `"type"`; accepts a known or unknown service type,
	 *   case-insensitively.
	 * - `order` and `limit` retain their REST names.
	 */
	static registeredNodes(q?: NetworkRegisteredNodesQuery) {
		const params: Record<string, any> = {};
		if (q === undefined) return params;
		assertAllowedObjectKeys(q, ["registeredNodeId", "type", "limit", "order"], "registered nodes query");

		if (q.registeredNodeId !== undefined) {
			const registeredNodeIds = validateJavaLongRangeFilters(q.registeredNodeId, "registerednode.id", {
				comparators: NO_NE_COMPARATOR_OPERATORS,
				rejectLtZero: true,
				maximum: 2,
				equalityMustBeAlone: true,
				orderedBounds: true,
			});
			params["registerednode.id"] = Array.isArray(q.registeredNodeId) ? registeredNodeIds.map(String) : String(registeredNodeIds[0]);
		}

		if (q.type !== undefined) {
			validateRegisteredNodeTypeFilter(q.type);
			params["type"] = q.type;
		}

		if (q.order !== undefined) {
			validateOrder(q.order);
			params["order"] = q.order;
		}
		if (q.limit !== undefined) params["limit"] = q.limit;

		return params;
	}

	/** Validate `GET /api/v1/network/stake` options and provide its stable cache key. */
	static stake(q?: NetworkStakeQuery) {
		if (q !== undefined) {
			assertAllowedObjectKeys(q, ["useCache"], "network stake query");
			validateOptionalBoolean(q.useCache, "useCache");
		}
		return { cacheKey: "network:stake" };
	}
}
