import { isInteger, isSafeNumber, parse } from "lossless-json";

/**
 * Parse a JSON number while preserving the native shape used by the client.
 *
 * Safe integer literals, decimal literals, and exponent-form literals remain
 * JavaScript numbers. Only integer literals that cannot be represented as a
 * safe JavaScript integer are returned as their exact decimal string.
 */
function parseJsonNumber(literal: string): number | string {
	return isInteger(literal) && !isSafeNumber(literal) ? literal : Number(literal);
}

const forbiddenJsonKey = "__proto__";

function rejectForbiddenJsonKey(key: string, value: unknown): unknown {
	if (key === forbiddenJsonKey) {
		throw new SyntaxError(`Forbidden JSON key: ${forbiddenJsonKey}`);
	}
	return value;
}

/**
 * Guard the one special property that `lossless-json` cannot safely represent.
 *
 * Its parser assigns object properties directly, so an object-valued
 * `__proto__` key changes the new object's prototype before its reviver runs.
 * Native JSON parsing defines that key as an ordinary own property, allowing
 * its reviver to reject it at any nesting level without mutating a prototype.
 * The preflight is only needed when the literal key (or a possible `\u`-escaped
 * spelling of it) occurs, avoiding a second parse for ordinary responses.
 */
function rejectForbiddenJsonKeys(text: string): void {
	if (text.includes(forbiddenJsonKey) || text.includes("\\u")) {
		JSON.parse(text, rejectForbiddenJsonKey);
	}
}

/**
 * Decode Mirror Node JSON text without truncating int64 values. Duplicate keys
 * retain the native `JSON.parse` last-value behavior.
 */
export function parseJsonText<T>(text: string): T {
	rejectForbiddenJsonKeys(text);
	return parse(text, undefined, {
		parseNumber: parseJsonNumber,
		onDuplicateKey: ({ newValue }) => newValue,
	}) as T;
}

/** Decode a successful Mirror Node response using the shared lossless parser. */
export async function readJsonResponse<T>(response: Pick<Response, "text">): Promise<T> {
	return parseJsonText<T>(await response.text());
}
