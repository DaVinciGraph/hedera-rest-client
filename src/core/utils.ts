// src/core/utils.ts
import { ValidationError } from "./errors";

/**
 * Sleep helper.
 *
 * Pauses the current async flow for the given number of milliseconds.
 * Useful in retry loops, rate‑limiting, and tests.
 *
 * @example
 * await sleep(250); // wait ~0.25s
 *
 * @param ms Milliseconds to wait (>= 0).
 * @returns Promise that resolves after the delay.
 */
export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Full‑jitter exponential backoff delay calculator.
 *
 * Produces a randomized delay in milliseconds using the "full jitter"
 * algorithm popularized by AWS:
 *
 *   delay = random(0, min(max, initial * 2^attempt))
 *
 * - `attempt` starts at 0 for the first retry.
 * - `initial` is the base delay for attempt 0 (e.g., 250ms).
 * - `max` caps the upper bound so it never grows without limit.
 *
 * Use this to compute the **wait time** before the next retry.
 *
 * @example
 * // attempt #0..#3 with initial 250ms and cap at 5s
 * const delay = computeBackoff(2, 250, 5000); // random in [0, min(5000, 250*4)]
 *
 * @param attempt Zero‑based retry attempt number (0 for first retry).
 * @param initial Base delay (ms) for attempt 0 (e.g., 250).
 * @param max Maximum cap (ms) for the upper bound.
 * @returns A randomized delay in the range [0, bound] in milliseconds.
 */
export function computeBackoff(attempt: number, initial: number, max: number): number {
	const base = Math.min(max, initial * Math.pow(2, attempt));
	return Math.floor(Math.random() * base);
}

/**
 * Detect whether the current runtime is a web browser.
 *
 * @returns `true` if `window` and `document` exist (likely a browser), otherwise `false`.
 */
export function isBrowser(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

/* -------------------------------------------------------------------------------------------------
 * Lightweight validators and parsing helpers
 * These small utilities perform input validation used across builders and mappers.
 * When a value is invalid, they throw a `ValidationError` with a user‑friendly message.
 * ------------------------------------------------------------------------------------------------- */

/** Require a public query/request value to be an object with only documented fields. */
export function assertAllowedObjectKeys(
	value: unknown,
	allowedKeys: readonly string[],
	name = "query"
): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ValidationError(`${name} must be an object`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new ValidationError(`${name} must be a plain object`);
	}
	const allowed = new Set(allowedKeys);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !allowed.has(key)) {
			throw new ValidationError(`Unknown ${name} field: ${typeof key === "symbol" ? key.toString() : key}`);
		}
	}
}

/** Validate an optional boolean without truthiness coercion. */
export function validateOptionalBoolean(value: unknown, name: string): void {
	if (value !== undefined && typeof value !== "boolean") {
		throw new ValidationError(`${name} must be a boolean`);
	}
}

/** Validate a required boolean without truthiness coercion. */
export function validateBoolean(value: unknown, name: string): asserts value is boolean {
	if (typeof value !== "boolean") {
		throw new ValidationError(`${name} must be a boolean`);
	}
}

/** Validate a string-typed public field without coercing dynamic JavaScript input. */
export function validateString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string") {
		throw new ValidationError(`${name} must be a string`);
	}
}

/** Validate a case-insensitive Mirror Node sort direction while preserving its spelling. */
export function validateOrder(value: unknown): void {
	if (typeof value !== "string" || (value.toLowerCase() !== "asc" && value.toLowerCase() !== "desc")) {
		throw new ValidationError(`order must be 'asc' or 'desc' (case-insensitive), got: ${String(value)}`);
	}
}

/** Unpadded RFC 4648 base32 shape used by account aliases. */
const accountAliasRe = /^(?:[A-Z2-7]{8})*(?:[A-Z2-7]{2}|[A-Z2-7]{4,5}|[A-Z2-7]{7,8})$/;

/** Validate unpadded RFC 4648 base32, including the required zero padding bits. */
function isCanonicalAccountAlias(value: string): boolean {
	if (!accountAliasRe.test(value)) return false;
	const remainder = value.length % 8;
	const paddingMask = remainder === 2 ? 0b11 : remainder === 4 ? 0b1111 : remainder === 5 ? 0b1 : remainder === 7 ? 0b111 : 0;
	if (paddingMask === 0) return true;
	const last = value.charCodeAt(value.length - 1);
	const symbol = last >= 65 && last <= 90 ? last - 65 : last - 50 + 26;
	return (symbol & paddingMask) === 0;
}

/** Matches an EVM address in the form: optional `0x` prefix followed by 40 hex characters. */
const evmAddressRe = /^(0x)?[A-Fa-f0-9]{40}$/;

/** Bounds imposed by Mirror Node's packed 64-bit entity-ID representation. */
const maxEntityShard = (1n << 10n) - 1n;
const maxEntityRealm = (1n << 16n) - 1n;
const maxEntityNum = (1n << 38n) - 1n;

function isBoundedDecimal(value: string, maxDigits: number, maximum: bigint): boolean {
	return /^\d+$/.test(value) && value.length <= maxDigits && BigInt(value) <= maximum;
}

function isValidShard(value: string): boolean {
	return isBoundedDecimal(value, 4, maxEntityShard);
}

function isValidRealm(value: string): boolean {
	return isBoundedDecimal(value, 5, maxEntityRealm);
}

function isValidEntityNum(value: string): boolean {
	return isBoundedDecimal(value, 12, maxEntityNum);
}

/** Validate the zero, one, or two components preceding an alias/address. */
function hasValidShardRealmPrefix(parts: string[]): boolean {
	if (parts.length === 0) return true;
	if (parts.length === 1) return isValidRealm(parts[0]);
	return parts.length === 2 && isValidShard(parts[0]) && isValidRealm(parts[1]);
}

/** OpenAPI address prefixes permit one or two unsigned components of up to ten digits. */
function hasValidAddressPrefix(parts: string[]): boolean {
	return parts.length <= 2 && parts.every((part) => /^\d{1,10}$/.test(part));
}

/** rest-java account-alias prefixes permit one or two components of up to five digits. */
function hasValidAliasPrefix(parts: string[]): boolean {
	return parts.length <= 2 && parts.every((part) => /^\d{1,5}$/.test(part));
}

/** Mirror Node request ID grammar: num, realm.num, or shard.realm.num. */
function isRequestEntityId(value: string, requireFull = false): boolean {
	const parts = value.split(".");
	if (requireFull && parts.length !== 3) return false;
	if (parts.length === 1) return isValidEntityNum(parts[0]);
	if (parts.length === 2) return isValidRealm(parts[0]) && isValidEntityNum(parts[1]);
	return parts.length === 3 && isValidShard(parts[0]) && isValidRealm(parts[1]) && isValidEntityNum(parts[2]);
}

/** Query-address form used by contract.id (no embedded `0x`). */
function isEntityAddressQueryValue(value: string): boolean {
	const parts = value.split(".");
	if (parts.length < 1 || parts.length > 3) return false;
	return hasValidAddressPrefix(parts.slice(0, -1)) && /^[A-Fa-f0-9]{40}$/.test(parts[parts.length - 1]);
}

/** Matches the Mirror Node timestamp grammar: 1..10 second digits and 1..9 fractional digits. */
const tsNumberLikeRe = /^\d{1,10}(?:\.\d{1,9})?$/;

/** Matches a transaction ID string: `shard.realm.num-seconds-nanos`. */
const txIdRe = /^(\d+)\.(\d+)\.(\d+)-(\d{1,19})-(\d{1,9})$/;

/**
 * Validate a strict Hedera `EntityId` (`shard.realm.num`).
 *
 * @example
 * validateEntityIdStrict("0.0.123"); // ok
 * validateEntityIdStrict("0.0.x");   // throws ValidationError
 *
 * @param s EntityId string to validate.
 * @throws {ValidationError} If the string does not match the strict EntityId format.
 */
export function validateEntityIdStrict(s: string): string {
	if (typeof s !== "string" || !isRequestEntityId(s, true)) throw new ValidationError(`Invalid EntityId: ${String(s)}`);
	return s;
}

/** Explicitly named alias for validating full `shard.realm.num` response values. */
export function validateFullEntityId(s: string): string {
	return validateEntityIdStrict(s);
}

/**
 * Validate a request-side entity ID without normalizing it.
 *
 * Request paths accept a numeric shorthand (`num`), `realm.num`, or the full
 * `shard.realm.num` form. Response DTOs should continue to use
 * {@link validateEntityIdStrict}, since response EntityIds are always full.
 */
export function validateEntityIdRequest(s: string, field = "EntityId"): string {
	if (typeof s !== "string" || !isRequestEntityId(s)) {
		throw new ValidationError(`Invalid ${field}: ${String(s)} (expected num, realm.num, or shard.realm.num)`);
	}
	return s;
}

/**
 * Validate an `EntityIdQuery` payload.
 *
 * The deployed API accepts `realm.num` in addition to the bare and full forms
 * shown by the narrower OpenAPI regex, so this deliberately uses the complete
 * request-side grammar.
 */
export function validateEntityIdQueryValue(s: string, field = "EntityId"): string {
	return validateEntityIdRequest(s, field);
}

/**
 * Validate an entity ID used as an encoded database range bound.
 *
 * Range endpoints use the signed packed ID. Consequently, full IDs with a
 * shard above 511 encode as negative values, and `gt:` cannot target the
 * largest positive packed ID because conversion to an inclusive bound would
 * overflow. Path identifiers do not have these two range-only restrictions.
 */
export function validateEntityIdRangeValue(s: string, field = "EntityId", operator?: ComparatorOperator): string {
	if (typeof s !== "string") throw new ValidationError(`Invalid ${field}: ${String(s)}`);
	const parts = s.split(".");
	if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^[+-]?\d+$/.test(part))) {
		throw new ValidationError(`Invalid ${field}: ${s} (expected a decimal entity ID range value)`);
	}

	const boundedValue = (raw: string, maximum: bigint): bigint | undefined => {
		const negative = raw.startsWith("-");
		const unsigned = raw.startsWith("+") || negative ? raw.slice(1) : raw;
		const normalized = unsigned.replace(/^0+(?=\d)/, "");
		if (negative && normalized !== "0") return undefined;
		if (normalized.length > maximum.toString().length) return undefined;
		const value = BigInt(normalized);
		return value <= maximum ? value : undefined;
	};
	const rawShard = parts.length === 3 ? parts[0] : "0";
	const rawRealm = parts.length >= 2 ? parts[parts.length - 2] : "0";
	const rawNum = parts[parts.length - 1];
	const shard = boundedValue(rawShard, maxEntityShard);
	const realm = boundedValue(rawRealm, maxEntityRealm);
	const num = boundedValue(rawNum, maxEntityNum);
	if (shard === undefined || realm === undefined || num === undefined || shard > 511n) {
		throw new ValidationError(`Invalid ${field}: ${s} (not a non-negative packed entity range ID)`);
	}
	if (operator === "gt" && shard === 511n && realm === maxEntityRealm && num === maxEntityNum) {
		throw new ValidationError(`Invalid ${field} range: gt:${s} exceeds the largest inclusive packed ID`);
	}
	return s;
}

/**
 * Validate an account identifier that may be one of:
 *  - request EntityId (`num`, `realm.num`, or `shard.realm.num`), or
 *  - Base32 alias (as used by Hedera), or
 *  - EVM address (optional `0x`, 40 hex), optionally preceded by shard/realm.
 *
 * @example
 * validateEntityIdOrAliasOrEvm("0.0.123");           // ok
 * validateEntityIdOrAliasOrEvm("0x11112222...ffff"); // ok
 * validateEntityIdOrAliasOrEvm("AAAA-BASE32...");    // ok if matches base32 alias rules
 *
 * @param s Identifier string.
 * @throws {ValidationError} If none of the accepted formats match.
 */
export function validateEntityIdOrAliasOrEvm(s: string): string {
	if (typeof s !== "string") throw new ValidationError(`Invalid account id/alias/evm: ${String(s)}`);

	const parts = s.split(".");
	if (parts.length < 1 || parts.length > 3) throw new ValidationError(`Invalid account id/alias/evm: ${s}`);
	if (isRequestEntityId(s)) return s;

	const value = parts[parts.length - 1];
	const prefix = parts.slice(0, -1);
	// The legacy OpenAPI account-path union permits `0x` on the address even
	// when shard/realm components are present. Keep the narrower rest-java
	// grammar isolated in validateJavaAccountIdPath().
	const evmAddress = evmAddressRe.test(value);
	if (evmAddress && hasValidAddressPrefix(prefix)) return s;
	if (isCanonicalAccountAlias(value) && hasValidAddressPrefix(prefix)) return s;

	throw new ValidationError(`Invalid account id/alias/evm: ${s}`);
}

/** Validate an account path handled by rest-java's `EntityIdParameter`. */
export function validateJavaAccountIdPath(s: string, field = "account id"): string {
	if (typeof s !== "string") throw new ValidationError(`Invalid ${field}: ${String(s)}`);
	if (isRequestEntityId(s)) return s;

	const parts = s.split(".");
	if (parts.length < 1 || parts.length > 3) throw new ValidationError(`Invalid ${field}: ${s}`);
	const value = parts[parts.length - 1];
	const prefix = parts.slice(0, -1);
	if (!hasValidAliasPrefix(prefix)) throw new ValidationError(`Invalid ${field}: ${s}`);

	const evmAddress = parts.length === 1 ? evmAddressRe.test(value) : /^[A-Fa-f0-9]{40}$/.test(value);
	if (evmAddress) return s;
	if (value.length >= 40 && value.length <= 70 && accountAliasRe.test(value)) return s;

	throw new ValidationError(`Invalid ${field}: ${s}`);
}

/** Maximum signed 64-bit integer accepted by Mirror Node integer parameters. */
export const MAX_SIGNED_INT64 = "9223372036854775807";

/** Comparator operators understood by Mirror Node query parameters. */
export type ComparatorOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/** All comparator operators, for numeric and timestamp filters that support `ne`. */
export const ALL_COMPARATOR_OPERATORS: readonly ComparatorOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

/** The sole comparator operator supported by equality-only filters. */
export const EQUALITY_COMPARATOR_OPERATORS: readonly ComparatorOperator[] = ["eq"];

/** Comparator operators supported by integer filters that exclude `ne`. */
export const NO_NE_COMPARATOR_OPERATORS: readonly ComparatorOperator[] = ["eq", "gt", "gte", "lt", "lte"];

/** Comparator operators supported by point-in-time token lookups. */
export const EQUAL_OR_LESS_COMPARATOR_OPERATORS: readonly ComparatorOperator[] = ["eq", "lt", "lte"];

/** Parsed comparator expression. `operator` is absent for a bare value. */
export interface ParsedComparatorValue {
	operator?: ComparatorOperator;
	value: string;
}

export interface ComparatorPayloadValidationOptions {
	/** Field name used in validation errors. */
	name?: string;
	/** Allowed operators. Defaults to all Mirror Node comparator operators. */
	comparators?: readonly ComparatorOperator[];
	/** Require an explicit `op:` prefix instead of also accepting a bare value. */
	requireComparator?: boolean;
	/** Match comparator names case-insensitively (for rest-java range parameters). */
	caseInsensitive?: boolean;
}

/**
 * Split and validate the operator portion of a comparator expression.
 *
 * The returned payload and the caller's original string are never normalized.
 * Semantic payload validation is deliberately delegated to the field-specific
 * validator used by {@link validateComparatorPayload}.
 */
export function parseComparatorValue(input: string, options: ComparatorPayloadValidationOptions = {}): ParsedComparatorValue {
	const name = options.name ?? "value";
	if (typeof input !== "string" || input.length === 0) {
		throw new ValidationError(`${name} must be a non-empty string`);
	}

	const separator = input.indexOf(":");
	if (separator < 0) {
		if (options.requireComparator) throw new ValidationError(`${name} must use a comparator prefix`);
		return { value: input };
	}

	const suppliedOperator = input.slice(0, separator);
	const rawOperator = options.caseInsensitive ? suppliedOperator.toLowerCase() : suppliedOperator;
	const value = input.slice(separator + 1);
	if (!ALL_COMPARATOR_OPERATORS.includes(rawOperator as ComparatorOperator) || value.length === 0) {
		throw new ValidationError(`Invalid ${name} comparator: ${input}`);
	}

	const operator = rawOperator as ComparatorOperator;
	const allowed = options.comparators ?? ALL_COMPARATOR_OPERATORS;
	if (!allowed.includes(operator)) {
		throw new ValidationError(`'${operator}' comparator is not supported for ${name}`);
	}
	return { operator, value };
}

/**
 * Validate a bare or comparator-prefixed string and its complete payload.
 * Returns the original input unchanged for callers that want validation and
 * assignment in one expression.
 */
export function validateComparatorPayload(
	input: string,
	validatePayload: (value: string) => unknown,
	options: ComparatorPayloadValidationOptions = {}
): string {
	const parsed = parseComparatorValue(input, options);
	validatePayload(parsed.value);
	return input;
}

/** Validate a comparator-capable request EntityId and return it unchanged. */
export function validateEntityIdFilter(
	input: string,
	name = "EntityId",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	const parsed = parseComparatorValue(input, { name, comparators, caseInsensitive: true });
	validateEntityIdRangeValue(parsed.value, name, parsed.operator);
	return input;
}

/**
 * Validate the primary account range used by airdrop endpoints.
 * Their lower/upper range construction rejects an exclusive upper bound below
 * the first encoded account. Only fully qualified `lt:0.0.0` can be identified
 * as that bound without knowing the provider's configured shard and realm.
 */
export function validatePrimaryEntityIdRangeFilter(
	input: string,
	name: string,
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	validateEntityIdFilter(input, name, comparators);
	const parsed = parseComparatorValue(input, { name, comparators, caseInsensitive: true });
	const parts = parsed.value.split(".");
	if (parsed.operator === "lt" && parts.length === 3 && parts.every((part) => BigInt(part) === 0n)) {
		throw new ValidationError(`Invalid ${name} range: ${input}`);
	}
	return input;
}

/** Airdrop participant IDs are primary entity range bounds. */
export function validateAirdropAccountIdFilter(
	input: string,
	name: "receiver.id" | "sender.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	return validatePrimaryEntityIdRangeFilter(input, name, comparators);
}

/** Account path/query identifier validator with a name that mirrors the REST parameter. */
export function validateAccountIdOrAliasOrEvm(input: string): string {
	return validateEntityIdOrAliasOrEvm(input);
}

/**
 * Validate the `/balances` `account.id` filter and return it unchanged.
 *
 * Numeric request IDs support every configured comparator. Account aliases and
 * EVM addresses support either a bare exact value or `eq:` only. Other account
 * ID query parameters use {@link validateEntityIdFilter} instead.
 */
export function validateAccountIdFilter(
	input: string,
	name = "account.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	const parsed = parseComparatorValue(input, { name, comparators });
	if (isRequestEntityId(parsed.value)) return input;
	if (parsed.operator && parsed.operator !== "eq") {
		throw new ValidationError(`Only the 'eq' comparator is supported for ${name} aliases and EVM addresses`);
	}
	if (!evmAddressRe.test(parsed.value) && !isCanonicalAccountAlias(parsed.value)) {
		throw new ValidationError(`Invalid ${name}: ${input}`);
	}
	return input;
}

/**
 * Validate a numeric request EntityId or EVM address (but not a base32 alias).
 *
 * A bare address may have a `0x` prefix. When shard/realm components precede
 * the address, deployed Mirror Node parsers require the 40 hexadecimal digits
 * without an embedded `0x`.
 */
export function validateEntityIdOrEvm(input: string, name = "EntityId/EVM address"): string {
	if (typeof input !== "string") throw new ValidationError(`Invalid ${name}: ${String(input)}`);
	if (isRequestEntityId(input)) return input;

	const parts = input.split(".");
	if (parts.length < 1 || parts.length > 3) throw new ValidationError(`Invalid ${name}: ${input}`);
	const address = parts[parts.length - 1];
	const validAddress = parts.length === 1 ? evmAddressRe.test(address) : /^[A-Fa-f0-9]{40}$/.test(address);
	if (hasValidShardRealmPrefix(parts.slice(0, -1)) && validAddress) return input;

	throw new ValidationError(`Invalid ${name}: ${input}`);
}

/** Validate a comparator-capable numeric EntityId/EVM-address filter. */
export function validateEntityIdOrEvmFilter(
	input: string,
	name = "EntityId/EVM address",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	const parsed = parseComparatorValue(input, { name, comparators });
	validateEntityIdOrEvm(parsed.value, name);
	return input;
}

/** Topic path IDs use the request EntityId grammar and do not accept addresses or aliases. */
export function validateTopicId(input: string): string {
	return validateEntityIdRequest(input, "topicId");
}

/** Schedule path IDs use the request EntityId grammar and do not accept addresses or aliases. */
export function validateScheduleId(input: string): string {
	return validateEntityIdRequest(input, "scheduleId");
}

export interface IntegerValidationOptions {
	/** Inclusive lower bound. Defaults to zero. */
	minimum?: number | string;
	/** Inclusive upper bound. Defaults to signed-int64 max. */
	maximum?: number | string;
	/** Maximum number of decimal digits, including leading zeroes. Defaults to 19. */
	maxDigits?: number;
	/** Operators allowed before the integer. Use an empty array for an exact value. */
	comparators?: readonly ComparatorOperator[];
}

function validateDecimalInteger(raw: string, name: string, options: IntegerValidationOptions): void {
	const maxDigits = options.maxDigits ?? 19;
	if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(raw)) {
		throw new ValidationError(`${name} must be a decimal integer containing at most ${maxDigits} digits, got: ${raw}`);
	}

	const value = BigInt(raw);
	const minimum = BigInt(options.minimum ?? 0);
	const maximum = BigInt(options.maximum ?? MAX_SIGNED_INT64);
	if (value < minimum || value > maximum) {
		throw new ValidationError(`${name} must be between ${minimum} and ${maximum}, got: ${raw}`);
	}
}

/** Validate a decimal integer while rejecting imprecise JavaScript numbers. */
export function validateInteger(value: number | string, name = "value", options: IntegerValidationOptions = {}): void {
	if (typeof value !== "number" && typeof value !== "string") {
		throw new ValidationError(`${name} must be supplied as a number or decimal string, got: ${String(value)}`);
	}
	if (typeof value === "number" && !Number.isSafeInteger(value)) {
		throw new ValidationError(`${name} must be a safe integer; pass large integer values as decimal strings`);
	}

	const raw = String(value);
	if (raw.includes(":")) {
		throw new ValidationError(`${name} must be an exact integer without a comparator, got: ${raw}`);
	}
	validateDecimalInteger(raw, name, options);
}

/**
 * Validate an integer query filter, including both its comparator operator and
 * numeric suffix. This closes the common gap where only `op:` was validated.
 */
export function validateIntegerFilter(value: number | string, name = "value", options: IntegerValidationOptions = {}): void {
	if (typeof value !== "number" && typeof value !== "string") {
		throw new ValidationError(`${name} must be supplied as a number or decimal string, got: ${String(value)}`);
	}
	if (typeof value === "number") {
		validateInteger(value, name, options);
		return;
	}

	const raw = String(value);
	const match = /^(eq|ne|gt|gte|lt|lte):(.+)$/.exec(raw);
	if (!match) {
		if (raw.includes(":")) {
			throw new ValidationError(`Invalid ${name} comparator: ${raw}`);
		}
		validateDecimalInteger(raw, name, options);
		return;
	}

	const allowed = options.comparators ?? ALL_COMPARATOR_OPERATORS;
	const operator = match[1] as ComparatorOperator;
	if (!allowed.includes(operator)) {
		throw new ValidationError(`'${operator}' comparator is not supported for ${name}`);
	}
	validateDecimalInteger(match[2], name, options);
}

export interface JavaLongRangeValidationOptions {
	/** Operators accepted by the endpoint. */
	comparators?: readonly ComparatorOperator[];
	/** Inclusive minimum accepted by the endpoint. */
	minimum?: 0 | 1;
	/** Reject an exclusive upper bound below the first non-negative value. */
	rejectLtZero?: boolean;
}

/**
 * Validate a Java `Long` range parameter while preserving its accepted lexical
 * forms (leading zeroes, an optional `+`, and signed zero).
 */
export function validateJavaLongRangeFilter(
	value: number | string,
	name = "value",
	options: JavaLongRangeValidationOptions = {}
): void {
	const minimum = options.minimum ?? 0;
	if (typeof value === "number") {
		validateNonNegativeInt64(value, name, minimum);
		return;
	}

	const comparators = options.comparators ?? ALL_COMPARATOR_OPERATORS;
	const parsed = parseComparatorValue(value, { name, comparators, caseInsensitive: true });
	if (!/^[+-]?\d+$/.test(parsed.value)) {
		throw new ValidationError(`${name} must contain a non-negative decimal Java long, got: ${parsed.value}`);
	}
	const numeric = BigInt(parsed.value);
	if (numeric < BigInt(minimum) || numeric > BigInt(MAX_SIGNED_INT64)) {
		throw new ValidationError(`${name} must be between ${minimum} and ${MAX_SIGNED_INT64}, got: ${parsed.value}`);
	}
	if (parsed.operator === "gt" && numeric === BigInt(MAX_SIGNED_INT64)) {
		throw new ValidationError(`Invalid ${name} range: ${value}`);
	}
	if (options.rejectLtZero && parsed.operator === "lt" && numeric === 0n) {
		throw new ValidationError(`Invalid ${name} range: ${value}`);
	}
}

/** Validate repeated query-parameter cardinality and each occurrence. */
export function validateRepeatedValues<T>(
	value: T | readonly T[],
	name: string,
	validateValue: (value: T) => unknown,
	maximum = 100
): T[] {
	const values = Array.isArray(value) ? [...(value as readonly T[])] : [value as T];
	if (values.length === 0 || values.length > maximum) {
		throw new ValidationError(`${name} accepts between one and ${maximum} values`);
	}
	for (const item of values) validateValue(item);
	return values;
}

export interface RepeatedComparatorShapeOptions {
	/** Transport-level occurrence cap. Defaults to 100. */
	maximum?: number;
	/** Reject equality when any other occurrence is present. */
	equalityMustBeAlone?: boolean;
	/** Optional cap for equality occurrences. */
	maximumEqualities?: number;
	/** Optional cap shared by `gt` and `gte` occurrences. */
	maximumLowerBounds?: number;
	/** Optional cap shared by `lt` and `lte` occurrences. */
	maximumUpperBounds?: number;
}

/**
 * Validate repeated legacy comparator parameters whose value grammar is
 * supplied by the caller, then enforce the endpoint's occurrence shape.
 */
export function validateRepeatedComparatorFilters<T extends string | number>(
	value: T | readonly T[],
	name: string,
	validateValue: (value: T) => unknown,
	options: RepeatedComparatorShapeOptions = {}
): T[] {
	const values = validateRepeatedValues(value, name, validateValue, options.maximum ?? 100);
	const operators = values.map((filter) => {
		if (typeof filter === "number") return "eq" as ComparatorOperator;
		return parseComparatorValue(filter, { name }).operator ?? "eq";
	});
	const equalities = operators.filter((operator) => operator === "eq").length;
	const lowers = operators.filter((operator) => operator === "gt" || operator === "gte").length;
	const uppers = operators.filter((operator) => operator === "lt" || operator === "lte").length;

	if (options.equalityMustBeAlone && equalities > 0 && values.length > 1) {
		throw new ValidationError(`${name} equality must be supplied alone`);
	}
	if (options.maximumEqualities !== undefined && equalities > options.maximumEqualities) {
		throw new ValidationError(`${name} accepts at most ${options.maximumEqualities} equality filter(s)`);
	}
	if (options.maximumLowerBounds !== undefined && lowers > options.maximumLowerBounds) {
		throw new ValidationError(`${name} accepts at most ${options.maximumLowerBounds} lower bound(s)`);
	}
	if (options.maximumUpperBounds !== undefined && uppers > options.maximumUpperBounds) {
		throw new ValidationError(`${name} accepts at most ${options.maximumUpperBounds} upper bound(s)`);
	}
	return values;
}

/** Validate repeated comparator-capable numeric EntityId/EVM-address filters. */
export function validateEntityIdOrEvmFilters(
	value: string | readonly string[],
	name = "EntityId/EVM address",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS,
	maximum = 100
): string[] {
	return validateRepeatedValues(value, name, (filter) => validateEntityIdOrEvmFilter(filter, name, comparators), maximum);
}

/** Validate repeated `/balances` account filters, including its one-address limit. */
export function validateAccountIdFilters(
	value: string | readonly string[],
	name = "account.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS,
	maximum = 100
): string[] {
	const values = validateRepeatedValues(value, name, (filter) => validateAccountIdFilter(filter, name, comparators), maximum);
	let addressOrAliasCount = 0;
	let addressOrAliasSeen = false;
	// The legacy parser removes exact duplicate strings before processing and
	// then applies its alias/address rule in insertion order.
	for (const filter of new Set(values)) {
		const parsed = parseComparatorValue(filter, { name, comparators });
		if (!isRequestEntityId(parsed.value)) {
			addressOrAliasCount += 1;
			addressOrAliasSeen = true;
			if (addressOrAliasCount > 1) {
				throw new ValidationError(`${name} accepts at most one distinct alias or EVM-address occurrence`);
			}
		} else if (addressOrAliasSeen && parsed.operator !== undefined && parsed.operator !== "eq") {
			throw new ValidationError(`${name} range comparators cannot follow an alias or EVM-address occurrence`);
		}
	}
	return values;
}

/** Validate repeated integer filters with one shared numeric policy. */
export function validateIntegerFilters(
	value: number | string | readonly (number | string)[],
	name = "value",
	options: IntegerValidationOptions = {},
	maximum = 100
): Array<number | string> {
	return validateRepeatedValues<number | string>(value, name, (filter) => validateIntegerFilter(filter, name, options), maximum);
}

/** Validate a `/blocks` block-number filter, including lowercase-`0x` input. */
export function validateBlockNumberFilter(value: number | string, name = "block.number"): void {
	if (typeof value === "number") {
		validateNonNegativeInt64(value, name);
		return;
	}
	const parsed = parseComparatorValue(value, { name, comparators: NO_NE_COMPARATOR_OPERATORS });
	if (/^0x[0-9A-Fa-f]+$/.test(parsed.value)) {
		if (BigInt(parsed.value) > BigInt(MAX_SIGNED_INT64)) {
			throw new ValidationError(`${name} must not exceed ${MAX_SIGNED_INT64}, got: ${parsed.value}`);
		}
		return;
	}
	validateNonNegativeInt64(parsed.value, name);
}

/** Validate every repeated `/blocks` block-number occurrence. */
export function validateBlockNumberFilters(value: number | string | readonly (number | string)[], name = "block.number"): Array<number | string> {
	return validateRepeatedValues<number | string>(value, name, (filter) => validateBlockNumberFilter(filter, name), 100);
}

/** Validate repeated comparator-capable token ID/Solidity-address filters. */
export function validateTokenIdFilters(
	value: string | readonly string[],
	name = "token.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS,
	maximum = 100
): string[] {
	return validateRepeatedValues(value, name, (filter) => validateTokenIdFilter(filter, name, comparators), maximum);
}

export interface EntityIdRangeListValidationOptions {
	comparators?: readonly ComparatorOperator[];
	/** Apply primary-range handling, including rejection of an explicit `lt:0.0.0`. */
	primary?: boolean;
	/** Enforce at most one equality, lower, or upper bound, with equality used alone. */
	structured?: boolean;
	/** Maximum repeated occurrences accepted by the endpoint. Defaults to two. */
	maximum?: number;
	/** Reject a lower bound that is greater than the corresponding upper bound. */
	orderedBounds?: boolean;
}

function packedEntityIdRangeValue(value: string): bigint {
	const parts = value.split(".").map((part) => BigInt(part));
	const shard = parts.length === 3 ? parts[0] : 0n;
	const realm = parts.length >= 2 ? parts[parts.length - 2] : 0n;
	const num = parts[parts.length - 1];
	return (shard << 54n) | (realm << 38n) | num;
}

/** Validate one or more repeated EntityId range parameters and return a copy. */
export function validateEntityIdRangeFilters(
	value: string | readonly string[],
	name: string,
	options: EntityIdRangeListValidationOptions = {}
): string[] {
	const values = validateRepeatedValues(value, name, () => undefined, options.maximum ?? 2);
	const comparators = options.comparators ?? ALL_COMPARATOR_OPERATORS;
	const operators: ComparatorOperator[] = [];
	for (const filter of values) {
		if (options.primary) validatePrimaryEntityIdRangeFilter(filter, name, comparators);
		else validateEntityIdFilter(filter, name, comparators);
		operators.push(parseComparatorValue(filter, { name, comparators, caseInsensitive: true }).operator ?? "eq");
	}

	if (options.structured) {
		const equalities = operators.filter((operator) => operator === "eq").length;
		const lowers = operators.filter((operator) => operator === "gt" || operator === "gte").length;
		const uppers = operators.filter((operator) => operator === "lt" || operator === "lte").length;
		if ((equalities > 0 && values.length > 1) || equalities > 1 || lowers > 1 || uppers > 1) {
			throw new ValidationError(`${name} accepts one equality or one lower and one upper bound`);
		}
	}
	if (options.orderedBounds) {
		// Shorthand IDs inherit a provider's configured shard/realm. Compare only
		// equally-qualified values; otherwise a client-side ordering decision could
		// be wrong for a private network or fork with non-zero coordinates.
		const boundsByArity = new Map<number, { lower?: bigint; upper?: bigint }>();
		for (let index = 0; index < values.length; index += 1) {
			const operator = operators[index];
			const parsed = parseComparatorValue(values[index], { name, comparators, caseInsensitive: true });
			const arity = parsed.value.split(".").length;
			const bounds = boundsByArity.get(arity) ?? {};
			const numeric = packedEntityIdRangeValue(parsed.value);
			if (operator === "eq" || operator === "gt" || operator === "gte") {
				const candidate = operator === "gt" ? numeric + 1n : numeric;
				bounds.lower = bounds.lower === undefined || candidate > bounds.lower ? candidate : bounds.lower;
			}
			if (operator === "lt" || operator === "lte") {
				const candidate = operator === "lt" ? numeric - 1n : numeric;
				bounds.upper = bounds.upper === undefined || candidate < bounds.upper ? candidate : bounds.upper;
			}
			boundsByArity.set(arity, bounds);
		}
		for (const { lower, upper } of boundsByArity.values()) {
			if (lower !== undefined && upper !== undefined && lower > upper) {
				throw new ValidationError(`Invalid ${name} range: lower bound exceeds upper bound`);
			}
		}
	}
	return values;
}

export interface JavaLongRangeListValidationOptions extends JavaLongRangeValidationOptions {
	/** Maximum repeated occurrences accepted by the endpoint. Defaults to two. */
	maximum?: number;
	/** Reject an equality filter when any second range occurrence is present. */
	equalityMustBeAlone?: boolean;
	/** Reject a lower bound that is greater than the corresponding upper bound. */
	orderedBounds?: boolean;
}

/** Validate repeated Java `Long` range parameters and return a copy. */
export function validateJavaLongRangeFilters(
	value: string | number | readonly (string | number)[],
	name = "value",
	options: JavaLongRangeListValidationOptions = {}
): Array<string | number> {
	const values = validateRepeatedValues<string | number>(value, name, () => undefined, options.maximum ?? 2);
	for (const filter of values) validateJavaLongRangeFilter(filter, name, options);
	if (
		options.equalityMustBeAlone &&
		values.length > 1 &&
		values.some((filter) =>
			typeof filter === "number"
				? true
				: (parseComparatorValue(filter, { name, comparators: options.comparators, caseInsensitive: true }).operator ?? "eq") === "eq"
		)
	) {
		throw new ValidationError(`${name} equality must be supplied alone`);
	}
	if (options.orderedBounds) {
		let lower: bigint | undefined;
		let upper: bigint | undefined;
		for (const filter of values) {
			const parsed =
				typeof filter === "number"
					? { operator: undefined, value: String(filter) }
					: parseComparatorValue(filter, { name, comparators: options.comparators, caseInsensitive: true });
			const numeric = BigInt(parsed.value);
			if (parsed.operator === "gt" || parsed.operator === "gte") {
				const candidate = parsed.operator === "gt" ? numeric + 1n : numeric;
				lower = lower === undefined || candidate > lower ? candidate : lower;
			}
			if (parsed.operator === "lt" || parsed.operator === "lte") {
				const candidate = parsed.operator === "lt" ? numeric - 1n : numeric;
				upper = upper === undefined || candidate < upper ? candidate : upper;
			}
		}
		if (lower !== undefined && upper !== undefined && lower > upper) {
			throw new ValidationError(`Invalid ${name} range: lower bound exceeds upper bound`);
		}
	}
	return values;
}

/** Validate a non-negative Mirror Node signed-int64 value. */
export function validateNonNegativeInt64(value: number | string, name = "value", minimum: 0 | 1 = 0): void {
	validateInteger(value, name, { minimum, maximum: MAX_SIGNED_INT64, maxDigits: 19 });
}

/** Validate the `key` query parameter used by hook-storage listings. */
export function validateHookStorageKey(value: string): void {
	if (typeof value !== "string") {
		throw new ValidationError(`Invalid hook storage key: ${String(value)}`);
	}
	const parsed = parseComparatorValue(value, { name: "key", comparators: NO_NE_COMPARATOR_OPERATORS });
	if (!/^(?:0x)?[0-9A-Fa-f]{1,64}$/.test(parsed.value)) {
		throw new ValidationError(`Invalid hook storage key: ${value}`);
	}
	const numeric = BigInt(parsed.value.startsWith("0x") ? parsed.value : `0x${parsed.value}`);
	const maximum = (1n << 256n) - 1n;
	if ((parsed.operator === "gt" && numeric === maximum) || (parsed.operator === "lt" && numeric === 0n)) {
		throw new ValidationError(`Invalid key range: ${value}`);
	}
}

/** Validate the up-to-100 repeated slot ranges accepted by hook storage. */
export function validateHookStorageKeyFilters(value: string | readonly string[]): string[] {
	const values = validateRepeatedValues(value, "key", () => undefined, 100);
	for (const filter of values) validateHookStorageKey(filter);
	return values;
}

/** Validate the raw body container accepted by the protobuf fee endpoint. */
export function validateProtobufTransactionBytes(value: unknown): asserts value is Uint8Array | ArrayBuffer {
	let isArrayBuffer = false;
	try {
		// Calling the intrinsic getter verifies the internal ArrayBuffer slot and
		// remains valid across realms; Symbol.toStringTag alone is spoofable.
		const byteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
		if (typeof byteLengthGetter === "function") {
			byteLengthGetter.call(value);
			isArrayBuffer = true;
		}
	} catch {}

	let isUint8Array = false;
	if (ArrayBuffer.isView(value)) {
		try {
			const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
			const tagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
			const intrinsicTag = typeof tagGetter === "function" ? tagGetter.call(value) : undefined;
			isUint8Array = intrinsicTag === "Uint8Array";
		} catch {}
	}
	if (!isArrayBuffer && !isUint8Array) {
		throw new ValidationError("transaction must be protobuf bytes supplied as a Uint8Array or ArrayBuffer");
	}
}

/**
 * Snapshot a protobuf request body into an owned byte array.
 *
 * A `Uint8Array` can expose only a subrange of a larger backing buffer, so the
 * copy must honor its byte offset and length. Owning the returned storage also
 * keeps limiter queueing, retries, and provider failover from observing caller
 * mutations made after request dispatch begins.
 */
export function snapshotProtobufTransactionBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
	validateProtobufTransactionBytes(value);
	const source = ArrayBuffer.isView(value)
		? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
		: new Uint8Array(value);
	const snapshot = new Uint8Array(source.byteLength);
	snapshot.set(source);
	return snapshot;
}

/** Validate the case-insensitive fee-estimation mode accepted by Mirror Node. */
export function validateFeeEstimateMode(value: unknown): void {
	if (typeof value !== "string" || (value.toUpperCase() !== "INTRINSIC" && value.toUpperCase() !== "STATE")) {
		throw new ValidationError(`mode must be "INTRINSIC" or "STATE" (case-insensitive), got: ${String(value)}`);
	}
}

/** Validate the optional case-insensitive scalar mode of `/network/supply`. */
export function validateNetworkSupplyType(value: unknown): void {
	const normalized = typeof value === "string" ? value.toLowerCase() : "";
	if (normalized !== "circulating" && normalized !== "totalcoins") {
		throw new ValidationError(`q must be "circulating" or "totalcoins" (case-insensitive), got: ${String(value)}`);
	}
}

/** Validate simulated high-volume throttle utilization in basis points. */
export function validateHighVolumeThrottle(value: number): void {
	if (!Number.isInteger(value) || value < 0 || value > 10_000) {
		throw new ValidationError("highVolumeThrottle must be an integer from 0 through 10000");
	}
}

/** Validate one of the case-insensitive protobuf media types accepted by fee estimation. */
export function validateProtobufContentType(value: unknown): void {
	const normalized = typeof value === "string" ? value.toLowerCase() : "";
	if (normalized !== "application/protobuf" && normalized !== "application/x-protobuf") {
		throw new ValidationError(`Invalid protobuf content type: ${String(value)}`);
	}
}

const REGISTERED_NODE_TYPE_FILTERS = new Set(["BLOCK_NODE", "GENERAL_SERVICE", "MIRROR_NODE", "RPC_RELAY", "UNKNOWN"]);

/** Validate the case-insensitive service-type filter used by registered nodes. */
export function validateRegisteredNodeTypeFilter(value: unknown): void {
	if (typeof value !== "string" || !REGISTERED_NODE_TYPE_FILTERS.has(value.toUpperCase())) {
		throw new ValidationError(`Invalid registered node type: ${String(value)}`);
	}
}

/**
 * Validate a comparator string of the form `<op>:<value>`, where
 * `<op>` is one of `gt|gte|lt|lte|eq|ne`.
 *
 * Does not validate the semantics of the value itself; that happens elsewhere.
 *
 * @param s Comparator string to check.
 * @throws {ValidationError} If the string does not match the comparator pattern.
 */
export function validateComparatorString(s: string): string {
	parseComparatorValue(s, { name: "comparator string", requireComparator: true });
	return s;
}

/**
 * Validate a timestamp filter used by list endpoints.
 *
 * Accepts:
 *  - number: seconds (>= 0)
 *  - string: `"seconds"` or `"seconds.fraction"`
 *  - string comparator: `"op:seconds[.fraction]"` with `op ∈ {gt,gte,lt,lte,eq,ne}`
 *
 * @example
 * validateTimestampFilter(1700000000);
 * validateTimestampFilter("1700000000.123");
 * validateTimestampFilter("gte:1700000000");
 *
 * @param v Timestamp value or comparator expression.
 * @throws {ValidationError} If the value is not a recognized form.
 */
export function validateTimestampFilter(v: string | number, comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS): void {
	if (typeof v === "number") {
		validateTimestampValue(v);
		return;
	}
	if (typeof v !== "string") {
		throw new ValidationError(`Invalid timestamp filter: ${String(v)}`);
	}

	const match = /^(eq|ne|gt|gte|lt|lte):(.+)$/.exec(v);
	if (!match) {
		if (v.includes(":")) throw new ValidationError(`Invalid timestamp comparator: ${v}`);
		validateTimestampValue(v);
		return;
	}

	const operator = match[1] as ComparatorOperator;
	if (!comparators.includes(operator)) {
		throw new ValidationError(`'${operator}' comparator is not supported for this timestamp filter`);
	}
	validateTimestampValue(match[2]);
}

/** Validate the legacy REST API's repeated timestamp parameter (1..100 occurrences). */
export function validateTimestampFilters<T extends string | number>(
	value: T | readonly T[],
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS,
	name = "timestamp"
): T[] {
	return validateRepeatedValues<T>(value, name, (filter) => validateTimestampFilter(filter, comparators), 100);
}

/** Validate a bare timestamp value (no comparator). */
export function validateTimestampValue(v: string | number): void {
	if (typeof v === "number") {
		if (!Number.isSafeInteger(v) || v < 0 || v > 9_223_372_036) {
			throw new ValidationError(`Timestamp numbers must be safe integer seconds from 0 through 9223372036; use a string for fractional timestamps`);
		}
		return;
	}
	if (typeof v !== "string" || !tsNumberLikeRe.test(v)) {
		throw new ValidationError(`Timestamp must contain 1..10 second digits and at most 9 fractional digits, got: ${String(v)}`);
	}
	const [seconds, fraction = ""] = v.split(".");
	const encoded = BigInt(seconds) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0") || "0");
	if (encoded > BigInt(MAX_SIGNED_INT64)) {
		throw new ValidationError(`Timestamp exceeds the signed-int64 nanosecond maximum, got: ${v}`);
	}
}

/** Validate one timestamp handled by rest-java's `TimestampParameter`. */
export function validateJavaTimestampFilter(value: string | number, name = "timestamp"): void {
	let operator: ComparatorOperator | undefined;
	let rawValue: string;

	if (typeof value === "number") {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new ValidationError(`${name} must be non-negative safe integer seconds, or a timestamp string`);
		}
		rawValue = String(value);
	} else if (typeof value === "string") {
		const separator = value.indexOf(":");
		if (separator < 0) {
			rawValue = value;
		} else {
			const rawOperator = value.slice(0, separator).toLowerCase();
			rawValue = value.slice(separator + 1);
			if (!NO_NE_COMPARATOR_OPERATORS.includes(rawOperator as ComparatorOperator) || rawValue.length === 0) {
				throw new ValidationError(`Invalid ${name} comparator: ${value}`);
			}
			operator = rawOperator as ComparatorOperator;
		}
	} else {
		throw new ValidationError(`Invalid ${name}: ${String(value)}`);
	}

	if (!/^\d{1,17}(?:\.\d{1,9})?$/.test(rawValue)) {
		throw new ValidationError(`${name} must contain 1..17 second digits and at most 9 nanosecond digits, got: ${rawValue}`);
	}

	const [seconds, nanos = "0"] = rawValue.split(".");
	// TimestampParameter parses the suffix directly as a nanosecond count. It
	// therefore treats `.9` as 9 ns (not 900,000,000 ns as the legacy REST
	// timestamp parser does).
	const encoded = BigInt(seconds) * 1_000_000_000n + BigInt(nanos);
	const maximum = BigInt(MAX_SIGNED_INT64);
	if (encoded > maximum) {
		throw new ValidationError(`${name} exceeds the signed-int64 nanosecond maximum, got: ${rawValue}`);
	}
	if (operator === "gt" && encoded === maximum) {
		throw new ValidationError(`Invalid ${name} range: ${String(value)}`);
	}
}

/** Validate the at-most-two timestamp bounds accepted by rest-java endpoints. */
export function validateJavaTimestampFilters(value: string | number | readonly (string | number)[], name = "timestamp"): void {
	const values = validateRepeatedValues<string | number>(value, name, () => undefined, 2);
	for (const timestamp of values) validateJavaTimestampFilter(timestamp, name);
}

/**
 * Validate an exact timestamp (`seconds` or `seconds.fraction`).
 * Comparators (e.g., `gte:...`) are NOT allowed here.
 *
 * @example
 * validateTimestampExact("1700000000.000000123"); // ok
 * validateTimestampExact("gte:1700");             // throws
 *
 * @param v Exact timestamp as a string, or safe integer seconds as a number.
 * @throws {ValidationError} If the value is not a pure numeric timestamp.
 */
export function validateTimestampExact(v: string | number): void {
	validateTimestampValue(v);
}

/**
 * Validate a Hedera TransactionId string: `shard.realm.num-seconds-nanos`.
 *
 * @example
 * validateTransactionIdStr("0.0.123-1700000000-123456789"); // ok
 *
 * @param v TransactionId string.
 * @throws {ValidationError} If the format is invalid.
 */
export function validateTransactionIdStr(v: string): void {
	const match = typeof v === "string" ? txIdRe.exec(v) : null;
	const entityId = match ? `${match[1]}.${match[2]}.${match[3]}` : "";
	const secondsInRange = match ? BigInt(match[4]) <= BigInt(MAX_SIGNED_INT64) : false;
	if (!match || !isRequestEntityId(entityId, true) || !secondsInRange) {
		throw new ValidationError(`Invalid TransactionId: ${String(v)} (expected '0.0.x-<seconds>-<nanos>')`);
	}
}

/**
 * Validate the path selector accepted by `GET /transactions/{transactionId}`.
 *
 * Mirror Node accepts either a Hedera transaction ID or its 48-byte consensus
 * hash encoded as hex (with an optional `0x` prefix), standard Base64, or
 * Base64URL. A 48-byte value is exactly 96 hex digits or 64 Base64 characters.
 */
export function validateTransactionIdOrHederaHash(v: string): void {
	if (typeof v !== "string") {
		throw new ValidationError("transactionId must be a Hedera transaction ID or 48-byte transaction hash");
	}

	try {
		validateTransactionIdStr(v);
		return;
	} catch (error) {
		if (!(error instanceof ValidationError)) throw error;
	}

	const isHex = /^(?:0x)?[0-9A-Fa-f]{96}$/.test(v);
	const isStandardBase64 = /^[A-Za-z0-9+/]{64}$/.test(v);
	const isBase64Url = /^[A-Za-z0-9_-]{64}$/.test(v);
	if (!isHex && !isStandardBase64 && !isBase64Url) {
		throw new ValidationError(
			`Invalid transactionId: ${String(v)} (expected a Hedera transaction ID or a 48-byte hash encoded as hex, Base64, or Base64URL)`
		);
	}
}

/**
 * Validate a positive signed-int64 integer (as a safe number or decimal string).
 * Decimal strings preserve exact values above JavaScript's safe-integer range.
 *
 * @example
 * validatePositiveInt64(1);
 * validatePositiveInt64("123456");
 *
 * @param n The numeric value or its decimal string.
 * @param name Optional field name for nicer error messages.
 * @throws {ValidationError} If outside the inclusive range 1..2^63-1.
 */
export function validatePositiveInt64(n: number | string, name = "value"): void {
	validateNonNegativeInt64(n, name, 1);
}

/** Validate an OpenAPI `int32` value whose minimum is zero. */
export function validateNonNegativeInt32(n: number | string, name = "value"): void {
	if (typeof n === "string" && !/^\d{1,10}$/.test(n)) {
		throw new ValidationError(`${name} must be a non-negative 32-bit integer, got: ${String(n)}`);
	}
	const numeric = typeof n === "string" ? Number(n) : n;
	if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0x7fffffff) {
		throw new ValidationError(`${name} must be a non-negative 32-bit integer, got: ${String(n)}`);
	}
}

/** Validate the equality-only block-number filter used by contract-result lists. */
export function validateContractResultBlockNumber(value: number | string, name = "block.number"): void {
	if (typeof value === "number") {
		validateNonNegativeInt64(value, name);
		return;
	}
	if (typeof value !== "string") {
		throw new ValidationError(`${name} must be supplied as a number or string, got: ${String(value)}`);
	}

	const raw = value.startsWith("eq:") ? value.slice(3) : value;
	if (value.includes(":") && !value.startsWith("eq:")) {
		throw new ValidationError(`${name} supports only the 'eq' comparator`);
	}
	if (/^0x[0-9A-Fa-f]+$/.test(raw)) {
		if (BigInt(raw) > BigInt(MAX_SIGNED_INT64)) {
			throw new ValidationError(`${name} must not exceed ${MAX_SIGNED_INT64}, got: ${raw}`);
		}
		return;
	}
	validateNonNegativeInt64(raw, name);
}

/**
 * Validate a "block hash or number" selector used by some endpoints.
 *
 * Accepts:
 *  - A decimal block number in the non-negative signed-int64 range, or
 *  - A 32-byte or 48-byte block hash, with or without `0x`.
 *
 * @param idRaw Block hash or number.
 * @throws {ValidationError} If the value does not match any accepted form.
 */
export function validateBlockHashOrNumber(idRaw: string | number): void {
	if (typeof idRaw === "number") {
		validateNonNegativeInt64(idRaw, "hashOrNumber", 0);
		return;
	}
	const id = String(idRaw);
	if (!id) {
		throw new ValidationError("hashOrNumber must be a non-empty string");
	}

	// Block hashes are exactly 32 or 48 bytes, with an optional 0x prefix.
	if (/^(?:0x)?(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{96})$/.test(id)) return;

	// The public Mirror Node accepts decimal block numbers throughout the
	// non-negative signed-int64 range (despite a narrower stale OAS pattern).
	try {
		validateNonNegativeInt64(id, "hashOrNumber", 0);
		return;
	} catch {
		throw new ValidationError("hashOrNumber must be a decimal block number from 0 through 9223372036854775807, or a 32-byte / 48-byte block hash (with or without 0x)");
	}
}

/* ---------------------------------- Contracts‑related helpers ---------------------------------- */

/**
 * Validate an EVM address: optional `0x` prefix followed by exactly 40 hex characters.
 *
 * @param addr Address string to validate.
 * @param field Field name to include in error messages (default: `"address"`).
 * @throws {ValidationError} If the address is invalid.
 */
export function validateEvmAddress(addr: string, field = "address"): void {
	if (typeof addr !== "string" || !evmAddressRe.test(addr)) {
		throw new ValidationError(`Invalid ${field}: ${String(addr)} (expected 40 hex characters with an optional 0x prefix)`);
	}
}

/**
 * Validate a contract-log topic filter: 1–64 hex digits with an optional `0x` prefix.
 *
 * @param topic Topic hex.
 * @param field Field name for error messages (default: `"topic"`).
 * @throws {ValidationError} If the topic hex is invalid.
 */
export function validateLogTopic(topic: string, field = "topic"): void {
	const re = /^(?:0x)?[0-9A-Fa-f]{1,64}$/;
	if (typeof topic !== "string" || !re.test(topic)) {
		throw new ValidationError(`Invalid ${field}: ${String(topic)} (expected 1..64 hex digits with optional 0x prefix)`);
	}
}

/** Validate a contract-state slot query, including its optional comparator. */
export function validateContractStateSlot(slot: string): void {
	if (typeof slot !== "string" || !/^(?:(?:eq|gt|gte|lt|lte):)?(?:0x)?[0-9A-Fa-f]{1,64}$/.test(slot)) {
		throw new ValidationError(`Invalid slot: ${String(slot)} (expected optional eq|gt|gte|lt|lte followed by 1..64 hex digits)`);
	}
}

/**
 * Validate a contract identifier that is either:
 *  - a request-side Hedera `EntityId` (`num`, `realm.num`, or `shard.realm.num`), or
 *  - an EVM address (optional `0x`, 40 hex), with optional shard/realm components.
 *
 * @param v Contract id or address.
 * @throws {ValidationError} If neither format matches.
 */
export function validateContractIdOrAddress(v: string): string {
	if (typeof v !== "string") throw new ValidationError(`Invalid contract id/address: ${String(v)}`);
	if (isRequestEntityId(v)) return v;

	const parts = v.split(".");
	const address = parts[parts.length - 1];
	// Accept the OpenAPI path union, including its shard/realm + 0x form. The
	// public parser currently rejects that last spelling, but a conforming fork
	// may implement it and client-side validation should not make it unreachable.
	const validAddress = evmAddressRe.test(address);
	if (parts.length <= 3 && hasValidAddressPrefix(parts.slice(0, -1)) && validAddress) return v;

	throw new ValidationError(`Invalid contract id/address: ${v}`);
}

/** Whether a token identifier uses one of the documented Solidity-address forms. */
function isTokenSolidityAddress(v: string): boolean {
	const parts = v.split(".");
	if (parts.length > 3) return false;
	const addressPart = parts[parts.length - 1];
	// The long-zero suffix is a token-num alias within the provider's configured
	// shard/realm. A client can validate the prefix shape but cannot require 0.0,
	// since forks may use different system coordinates.
	if (!hasValidShardRealmPrefix(parts.slice(0, -1))) return false;

	const address = parts.length === 1 && addressPart.startsWith("0x") ? addressPart.slice(2) : addressPart;
	if (!/^[A-Fa-f0-9]{40}$/.test(address)) return false;
	if (parts.length > 1 && addressPart.startsWith("0x")) return false;
	if (!/^0{24}/.test(address)) return false;
	return BigInt(`0x${address.slice(24)}`) <= maxEntityNum;
}

/** Validate a token numeric ID or a documented Solidity-address form. */
export function validateTokenIdOrAddress(v: string): string {
	if (typeof v === "string" && (isRequestEntityId(v) || isTokenSolidityAddress(v))) return v;
	throw new ValidationError(`Invalid token id/Solidity address: ${String(v)}`);
}

/** Validate a comparator-capable contract ID/address and return it unchanged. */
export function validateContractIdFilter(
	input: string,
	name = "contract.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	const parsed = parseComparatorValue(input, { name, comparators });
	if (isRequestEntityId(parsed.value)) return input;
	if ((!parsed.operator || parsed.operator === "eq") && isEntityAddressQueryValue(parsed.value)) return input;
	if (parsed.operator && isEntityAddressQueryValue(parsed.value)) {
		throw new ValidationError(`Only the 'eq' comparator is supported for ${name} EVM addresses`);
	}
	if (!isRequestEntityId(parsed.value)) {
		throw new ValidationError(`Invalid ${name}: ${input}`);
	}
	return input;
}

/** Validate a comparator-capable token ID/Solidity address and return it unchanged. */
export function validateTokenIdFilter(
	input: string,
	name = "token.id",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	const parsed = parseComparatorValue(input, { name, comparators });
	validateTokenIdOrAddress(parsed.value);
	return input;
}

/**
 * Validate the `from` filter used by contract-result list endpoints.
 * Numeric IDs and bare EVM addresses both support comparator prefixes; unlike
 * contract path IDs, an EVM address here cannot carry shard/realm components.
 */
export function validateContractFromFilter(
	input: string,
	name = "from",
	comparators: readonly ComparatorOperator[] = ALL_COMPARATOR_OPERATORS
): string {
	return validateComparatorPayload(
		input,
		(value) => {
			if (!isRequestEntityId(value) && !evmAddressRe.test(value)) {
				throw new ValidationError(`Invalid ${name}: ${input}`);
			}
		},
		{ name, comparators }
	);
}

/**
 * Validate any hex string, with an optional `0x` prefix.
 *
 * @param s Hex string.
 * @param field Field name for error messages (default: `"hex"`).
 * @throws {ValidationError} If the string is not hex.
 */
export function validateHex(s: string, field = "hex"): void {
	const re = /^(0x)?[0-9A-Fa-f]+$/;
	if (typeof s !== "string" || !re.test(s)) throw new ValidationError(`Invalid ${field}: ${String(s)} (expected hex string)`);
}

interface InclusiveTimestampBounds {
	lower?: bigint;
	upper?: bigint;
}

/** Convert a validated Mirror Node timestamp to its exact nanosecond value. */
function timestampToNanoseconds(timestamp: string | number): bigint {
	validateTimestampValue(timestamp);
	const [seconds, fraction = ""] = String(timestamp).split(".");
	return BigInt(seconds) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0") || "0");
}

/** Collapse timestamp filters into the inclusive bounds used by the REST API. */
function getInclusiveTimestampBounds(filters: readonly (string | number)[]): InclusiveTimestampBounds {
	let lower: bigint | undefined;
	let upper: bigint | undefined;

	for (const filter of filters) {
		validateTimestampFilter(filter);
		const parsed =
			typeof filter === "number"
				? { operator: undefined, value: String(filter) }
				: parseComparatorValue(filter, { name: "timestamp" });
		const timestamp = timestampToNanoseconds(parsed.value);
		const operator = parsed.operator ?? "eq";

		if (operator === "eq" || operator === "gt" || operator === "gte") {
			const candidate = operator === "gt" ? timestamp + 1n : timestamp;
			lower = lower === undefined || candidate > lower ? candidate : lower;
		}
		if (operator === "eq" || operator === "lt" || operator === "lte") {
			const candidate = operator === "lt" ? timestamp - 1n : timestamp;
			upper = upper === undefined || candidate < upper ? candidate : upper;
		}
	}

	return { lower, upper };
}

/** Whether timestamp filters reduce to one exact nanosecond after inclusive-bound adjustment. */
export function hasEffectiveTimestampEquality(filters: readonly (string | number)[]): boolean {
	if (filters.length === 0) return false;
	const { lower, upper } = getInclusiveTimestampBounds(filters);
	return lower !== undefined && upper !== undefined && lower === upper;
}

/**
 * Enforce the Mirror Node rule for **contract log topic searches**:
 *
 * When any `topicX` filter is present, a **timestamp** filter must also be present and
 * the covered time window must be **≤ maxWindowSec** (defaults to 7 days).
 *
 * Accepted timestamp forms:
 *  - a single exact timestamp (window = 0), or
 *  - a bounded range using comparators (`gte/gt` for lower, `lte/lt` for upper),
 *  - `eq:<ts>` also tightens both bounds to the same instant.
 *
 * @example
 * // OK: exact
 * enforceTopicTimestampWindow("1700000000.000000000", true);
 *
 * // OK: bounded range
 * enforceTopicTimestampWindow(["gte:1700000000", "lte:1700600000"], true);
 *
 * // Throws: missing timestamp when topic filters are used
 * enforceTopicTimestampWindow(undefined, true);
 *
 * @param timestamp A single timestamp or an array of comparator strings and/or exacts.
 * @param hasTopic Whether any topic filter is being used.
 * @param maxWindowSec Maximum allowed window in seconds (default: 7 days).
 * @throws {ValidationError} If `hasTopic` is true but timestamp is missing, unbounded, or exceeds the window.
 */
export function enforceTopicTimestampWindow(timestamp: number | string | readonly (string | number)[] | undefined, hasTopic: boolean, maxWindowSec = 7 * 24 * 3600): void {
	if (!hasTopic) return;

	if (timestamp === undefined || (Array.isArray(timestamp) && timestamp.length === 0)) {
		throw new ValidationError("When filtering contract logs by topic, a timestamp filter spanning at most 7 days is required.");
	}
	const arr = Array.isArray(timestamp) ? timestamp : [timestamp];
	const { lower, upper } = getInclusiveTimestampBounds(arr);

	if (lower === undefined || upper === undefined) {
		throw new ValidationError("When filtering logs by topic, provide a bounded timestamp range (gte/gt and lte/lt) not exceeding 7 days.");
	}
	const size = upper - lower + 1n;
	if (size <= 0n) {
		throw new ValidationError("Topic log search timestamp range must not be empty or reversed.");
	}
	if (!Number.isSafeInteger(maxWindowSec) || maxWindowSec < 0) {
		throw new ValidationError("Topic log search maximum window must be a non-negative integer number of seconds.");
	}
	if (size > BigInt(maxWindowSec) * 1_000_000_000n) {
		throw new ValidationError("Topic log search window must be ≤ 7 days.");
	}
}

/**
 * Build a URL query string from a plain object.
 *
 * - `undefined` and `null` values are skipped.
 * - Arrays add multiple entries with the same key (e.g., `k=v1&k=v2`).
 * - All values are stringified.
 *
 * @example
 * buildQuery({ a: 1, b: undefined })      // '?a=1'
 * buildQuery({ k: ['x', 'y'] })           // '?k=x&k=y'
 * buildQuery({})                          // ''
 *
 * @param params Key‑value pairs to encode.
 * @returns A query string prefixed with `?`, or an empty string if nothing to encode.
 */
export function buildQuery(params: Record<string, unknown>): string {
	const qp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v)) {
			for (const item of v) qp.append(k, String(item));
		} else {
			qp.set(k, String(v));
		}
	}
	const s = qp.toString();
	return s ? `?${s}` : "";
}

/**
 * Validate a transaction hash (32 bytes) as hex, optional `0x` prefix.
 *
 * @param v Transaction hash string.
 * @throws {ValidationError} If the hash is not 64 hex characters (optionally prefixed with `0x`).
 */
export function validateTxHashHex32(v: string): void {
	const re = /^(0x)?[0-9A-Fa-f]{64}$/;
	if (typeof v !== "string" || !re.test(v)) {
		throw new ValidationError(`Invalid transaction hash: ${String(v)} (expected 32-byte hex, optional 0x)`);
	}
}

/** Validate an equality-only 32-byte or 48-byte contract result/log hash filter. */
export function validateContractHashFilter(value: string, name: "block.hash" | "transaction.hash"): string {
	if (typeof value !== "string" || !/^(?:eq:)?(?:(?:0x)?[0-9A-Fa-f]{64}|(?:0x)?[0-9A-Fa-f]{96})$/.test(value)) {
		throw new ValidationError(`${name} must be a 32-byte (64 hex) or 48-byte (96 hex) hash, with optional 0x and eq: prefixes`);
	}
	return value;
}

/**
 * Validate a value that may be either:
 *  - Hedera `TransactionIdStr` (`shard.realm.num-seconds-nanos`), or
 *  - 32‑byte transaction hash (hex, optional `0x`).
 *
 * @param v Transaction id or hash.
 * @throws {ValidationError} If neither format matches.
 */
export function validateTransactionIdOrHash(v: string): void {
	try {
		validateTransactionIdStr(v);
		return;
	} catch {
		/* ignore */
	}
	validateTxHashHex32(v);
}

/**
 * Extract the comparator operator from a string of the form `<op>:<value>`.
 *
 * @example
 * opOf("gte:100")  // 'gte'
 * opOf("100")      // undefined
 *
 * @param s Comparator string.
 * @returns The operator (`gt|gte|lt|lte|eq|ne`) if present, otherwise `undefined`.
 */
export const opOf = (s: string): string | undefined => {
	const i = s.indexOf(":");
	return i > 0 ? s.slice(0, i) : undefined;
};

/**
 * Forbid usage of the `ne` (not equal) comparator for endpoints that do not support it.
 *
 * @example
 * forbidNe("ne:10"); // throws
 * forbidNe("gt:10"); // ok
 *
 * @param s Comparator string.
 * @throws {ValidationError} If the operator is `ne`.
 */
export const forbidNe = (s: string) => {
	const op = opOf(s);
	if (op === "ne") throw new ValidationError(`'ne' comparator is not supported for this endpoint`);
};
