// src/core/limits.ts

import type { LimitValue } from "../types";
import { ValidationError } from "./errors";
import type { ResolvedTarget } from "./provider";

/** Original (possibly symbolic) limits retained while query objects are routed. */
const requestedQueryLimits = new WeakMap<object, LimitValue>();

function describeLimitValue(value: unknown): string {
	try {
		return String(value);
	} catch {
		return "<unprintable>";
	}
}

/** Infer the logical endpoint whose paging policy applies to a request path. */
export function inferPageEndpoint(path: string): string | undefined {
	let pathname: string;
	try {
		pathname = new URL(path, "https://hedera-rest-client.invalid").pathname;
	} catch {
		return undefined;
	}
	return /\/api\/v1\/network\/nodes\/?$/.test(pathname) ? "network.nodes" : undefined;
}

function pageLimits(target: ResolvedTarget, endpoint?: string): { defaultLimit: number; maxLimit: number } {
	const override = endpoint === undefined ? undefined : target.page.endpoints?.[endpoint];
	return {
		defaultLimit: override?.defaultLimit ?? target.page.defaultLimit,
		maxLimit: override?.maxLimit ?? target.page.maxLimit,
	};
}

/**
 * Resolve a user‑supplied list `limit` into a concrete number that is safe to send
 * to the Mirror Node, honoring the provider/network’s pagination rules.
 *
 * @description
 * Many list endpoints accept a `limit` query parameter that controls how many
 * items are returned per page. Callers can pass:
 *
 * - a **number** (e.g. `25`) – the desired page size,
 * - the string **`"default"`** – use the service’s recommended default page size
 *   for the current provider/network,
 * - the string **`"max"`** – use the maximum page size allowed for the current
 *   provider/network,
 * - or `undefined` – omit the `limit` parameter entirely and let the server
 *   choose its default.
 *
 * This helper translates those inputs to a final number and **clamps** it to the
 * valid range for the active target:
 *
 * - Minimum of **`1`** (values below 1 are raised to 1),
 * - Maximum of the active endpoint's `maxLimit`, falling back to
 *   **`target.page.maxLimit`** (values above the maximum are lowered to the max).
 *
 * The clamping ensures a well‑formed value is sent even if a user provides an
 * overly small/large number. When `limit` is `undefined` the function returns
 * `undefined`, signaling the caller **not** to include a `limit` query param.
 *
 * @param target - The resolved provider/network context. The `page` property
 *                 supplies {@link ResolvedTarget.page.defaultLimit defaultLimit}
 *                 and {@link ResolvedTarget.page.maxLimit maxLimit} for the active
 *                 Mirror Node instance.
 * @param limit  - The requested page size. May be a number, `"default"`, `"max"`,
 *                 or `undefined` to omit the parameter.
 * @param endpoint - Optional logical endpoint key for an operation-specific policy.
 *
 * @returns
 * - A clamped, concrete numeric page size to use in the request, or
 * - `undefined` if `limit` was `undefined` (omit the query param).
 *
 * @example
 * ```ts
 * // Given: target.page.defaultLimit = 25, target.page.maxLimit = 100
 *
 * resolveLimitValue(target, undefined) // → undefined (do not send ?limit=)
 * resolveLimitValue(target, "default") // → 25
 * resolveLimitValue(target, "max")     // → 100
 * resolveLimitValue(target, 10)        // → 10
 * resolveLimitValue(target, 0)         // → 1      (clamped up)
 * resolveLimitValue(target, 999)       // → 100    (clamped down)
 * ```
 *
 * @remarks
 * - This function is **pure** and performs no I/O.
 * - Use it in resource builders just before constructing the final query object.
 * - `LimitValue` is defined in {@link ../types | types} to centralize typing
 *   across the DSL and resource layers.
 */
export function resolveLimitValue(target: ResolvedTarget, limit?: LimitValue, endpoint?: string): number | undefined {
	if (limit === undefined) return undefined;

	const { defaultLimit, maxLimit } = pageLimits(target, endpoint);
	const scope = endpoint === undefined ? "target.page" : `target.page.endpoints[${JSON.stringify(endpoint)}]`;
	if (!Number.isSafeInteger(maxLimit) || maxLimit < 1) {
		throw new ValidationError(`${scope}.maxLimit must be a positive safe integer, got: ${describeLimitValue(maxLimit)}`);
	}
	if (!Number.isSafeInteger(defaultLimit) || defaultLimit < 1) {
		throw new ValidationError(`${scope}.defaultLimit must be a positive safe integer, got: ${describeLimitValue(defaultLimit)}`);
	}

	let n: number;
	if (limit === "default") n = defaultLimit;
	else if (limit === "max") n = maxLimit;
	else {
		if (!Number.isSafeInteger(limit)) {
			throw new ValidationError(`limit must be a safe integer, "default", or "max", got: ${describeLimitValue(limit)}`);
		}
		n = limit;
	}

	// Clamp to [1, maxLimit]
	const clamped = Math.max(1, Math.min(n, maxLimit));
	return clamped;
}

/**
 * Resolve a query's limit for the currently selected target while retaining the
 * caller's original intent for later overflow/failover routing.
 *
 * Builders use the mutating form to preserve their long-standing observable
 * mapper contract (the registry receives a numeric limit). The registry uses
 * {@link resolvedQueryLimit} to re-resolve the remembered value for every
 * actual provider without mutating caller-owned input again.
 */
export function prepareQueryLimit(target: ResolvedTarget, query: Record<string, any>, explicitLimit?: LimitValue, endpoint?: string): void {
	if (explicitLimit !== undefined) {
		requestedQueryLimits.set(query, explicitLimit);
		query.limit = explicitLimit;
	}
	if (!Object.prototype.hasOwnProperty.call(query, "limit") || query.limit === undefined) return;
	const requested = requestedQueryLimits.get(query) ?? (query.limit as LimitValue);
	requestedQueryLimits.set(query, requested);
	query.limit = resolveLimitValue(target, requested, endpoint);
}

/** Return the effective limit for `target`, honoring retained symbolic intent. */
export function resolvedQueryLimit(target: ResolvedTarget, query: Record<string, any>, endpoint?: string): number | undefined {
	if (!Object.prototype.hasOwnProperty.call(query, "limit")) return undefined;
	const requested = requestedQueryLimits.get(query) ?? (query.limit as LimitValue | undefined);
	return resolveLimitValue(target, requested, endpoint);
}
