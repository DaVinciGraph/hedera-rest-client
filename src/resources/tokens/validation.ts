import { ValidationError } from "../../core/errors";
import { EQUAL_OR_LESS_COMPARATOR_OPERATORS, validateRepeatedValues, validateTimestampFilter } from "../../core/utils";
import type { EqualOrLessTimestampFilter, TokenTypeFilter } from "../../types";

/** Validate a forward-compatible `type` query parameter accepted by `/tokens`. */
export function validateTokenTypeFilter(value: unknown): asserts value is TokenTypeFilter {
	if (typeof value !== "string" || value.length === 0) {
		throw new ValidationError("type must be a non-empty string");
	}
}

/** Validate the Mirror Node token-name constraint in UTF-8 bytes. */
export function validateTokenName(value: unknown): asserts value is string {
	if (typeof value !== "string") throw new ValidationError("name must be a string");
	const bytes = new TextEncoder().encode(value).byteLength;
	if (bytes < 3 || bytes > 100) {
		throw new ValidationError(`name must be between 3 and 100 UTF-8 bytes, got ${bytes}`);
	}
}

/** Validate the one-to-100 repeated `type` occurrences accepted by `/tokens`. */
export function validateTokenTypeFilters(value: TokenTypeFilter | readonly TokenTypeFilter[]): TokenTypeFilter[] {
	return validateRepeatedValues<TokenTypeFilter>(value, "type", validateTokenTypeFilter, 100);
}

/** Validate repeated token-info timestamps while retaining their request order. */
export function validateTokenInfoTimestampFilters(
	value: EqualOrLessTimestampFilter | readonly EqualOrLessTimestampFilter[]
): EqualOrLessTimestampFilter[] {
	return validateRepeatedValues<EqualOrLessTimestampFilter>(
		value,
		"timestamp",
		(timestamp) => validateTimestampFilter(timestamp, EQUAL_OR_LESS_COMPARATOR_OPERATORS),
		100
	);
}
