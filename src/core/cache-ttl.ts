import { ValidationError } from "./errors";

/** Validate a TTL against one captured clock value and return milliseconds. */
function validatedTtlMilliseconds(ttlSeconds: number, label: string, now: number): number {
	if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
		throw new ValidationError(`${label} must be a finite, non-negative number of seconds`);
	}

	const ttlMilliseconds = ttlSeconds * 1_000;
	if (!Number.isFinite(ttlMilliseconds) || now + ttlMilliseconds > Number.MAX_SAFE_INTEGER) {
		throw new ValidationError(`${label} is too large to represent a safe expiration time`);
	}
	return ttlMilliseconds;
}

/** Validate a cache TTL supplied directly to an adapter. Zero expires immediately. */
export function assertValidCacheTtl(ttlSeconds: number, label = "ttlSeconds"): void {
	validatedTtlMilliseconds(ttlSeconds, label, Date.now());
}

/** Return an absolute millisecond expiration after validating the TTL. */
export function cacheExpiresAt(ttlSeconds: number): number {
	const now = Date.now();
	const ttlMilliseconds = validatedTtlMilliseconds(ttlSeconds, "ttlSeconds", now);
	return now + Math.floor(ttlMilliseconds);
}

/** Return whether a stored absolute expiration is a finite, safely representable number. */
export function isValidCacheExpiration(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}
