import type { RequestOptions } from "../types";
import { ValidationError } from "./errors";
import { MAX_TIMER_DELAY_MS } from "./http";

const REQUEST_OPTION_KEYS = new Set(["signal", "timeoutMs"]);

function validateRequestOptions(options: unknown): asserts options is RequestOptions {
	if (typeof options !== "object" || options === null || Array.isArray(options)) {
		throw new ValidationError("request options must be a plain object");
	}
	const prototype = Object.getPrototypeOf(options);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new ValidationError("request options must be a plain object");
	}
	for (const key of Reflect.ownKeys(options)) {
		if (typeof key !== "string" || !REQUEST_OPTION_KEYS.has(key)) {
			throw new ValidationError(`Unknown request option: ${typeof key === "symbol" ? key.toString() : key}`);
		}
	}

	const { signal, timeoutMs } = options as RequestOptions;
	if (
		signal !== undefined &&
		(typeof signal !== "object" ||
			signal === null ||
			typeof signal.aborted !== "boolean" ||
			typeof signal.addEventListener !== "function" ||
			typeof signal.removeEventListener !== "function")
	) {
		throw new ValidationError("request options.signal must be an AbortSignal");
	}
	if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS)) {
		throw new ValidationError(`request options.timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`);
	}
}

/**
 * Keep the historical ProviderRegistry call shape when no request controls are
 * supplied, while still allowing timeout-only calls to occupy the fifth slot.
 */
export function requestOptionArgs(options: RequestOptions): [signal?: AbortSignal, timeoutMs?: number] {
	validateRequestOptions(options);
	if (options.signal?.aborted) {
		// Native AbortSignals preserve the exact caller-supplied reason (and create
		// the standard AbortError DOMException when no reason was supplied).
		if (typeof options.signal.throwIfAborted === "function") options.signal.throwIfAborted();

		// Retain the same semantics for structurally valid AbortSignal-compatible
		// objects on runtimes that do not yet expose throwIfAborted().
		if (options.signal.reason !== undefined) throw options.signal.reason;
		if (typeof DOMException === "function") throw new DOMException("The operation was aborted", "AbortError");
		const fallback = new Error("The operation was aborted");
		fallback.name = "AbortError";
		throw fallback;
	}
	if (options.timeoutMs !== undefined) return [options.signal, options.timeoutMs];
	if (options.signal !== undefined) return [options.signal];
	return [];
}
