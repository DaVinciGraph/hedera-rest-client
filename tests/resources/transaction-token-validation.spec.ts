import { describe, expect, it } from "vitest";

import { ConfigError, HttpError, ValidationError } from "../../src/core/errors";
import { validateTransactionIdOrHederaHash } from "../../src/core/utils";
import { TransactionByIdQueryBuilder } from "../../src/dsl/transactions";
import { TokensListQueryBuilder } from "../../src/dsl/tokens";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";
import { TokensMapper } from "../../src/resources/tokens/mapper";

describe("transaction selectors", () => {
	const selectors = [
		"0.0.123-1700000000-123456789",
		"ab".repeat(48),
		`0x${"AB".repeat(48)}`,
		`${"A".repeat(62)}+/`,
		`${"A".repeat(62)}-_`,
	];

	it.each(selectors)("accepts Mirror Node transaction selector %s", (selector) => {
		expect(() => validateTransactionIdOrHederaHash(selector)).not.toThrow();
		expect(TransactionsMapper.byId({ transactionId: selector }).id).toBe(selector);
		expect(new TransactionByIdQueryBuilder().transactionId(selector).build().transactionId).toBe(selector);
	});

	it.each([`0x${"ab".repeat(32)}`, "A".repeat(63), "A".repeat(65), `${"A".repeat(62)}+_`, "not-a-selector"])(
		"rejects malformed transaction selector %s",
		(selector) => expect(() => validateTransactionIdOrHederaHash(selector)).toThrow(ValidationError)
	);
});

describe("forward-compatible token validation", () => {
	it("validates token names by UTF-8 byte length in both object and DSL forms", () => {
		expect(TokensMapper.list({ name: "ℏ" })).toEqual({ name: "ℏ" });
		expect(TokensMapper.list({ name: "a".repeat(100) })).toEqual({ name: "a".repeat(100) });
		expect(new TokensListQueryBuilder().name("ℏ".repeat(33)).build().name).toBe("ℏ".repeat(33));

		for (const name of ["ab", "a".repeat(101), "ℏ".repeat(34)]) {
			expect(() => TokensMapper.list({ name })).toThrow(ValidationError);
			expect(() => new TokensListQueryBuilder().name(name)).toThrow(ValidationError);
		}
	});

	it("passes unknown future or fork token types through unchanged", () => {
		expect(TokensMapper.list({ type: ["FUNGIBLE_COMMON", "FUTURE_TOKEN_TYPE"] })).toEqual({
			type: ["FUNGIBLE_COMMON", "FUTURE_TOKEN_TYPE"],
		});
		expect(new TokensListQueryBuilder().type("PROVIDER_SPECIFIC_TYPE").build().type).toBe("PROVIDER_SPECIFIC_TYPE");
		expect(() => TokensMapper.list({ type: "" })).toThrow(ValidationError);
	});
});

describe("public error identity", () => {
	it("sets stable names for each exported error class", () => {
		expect(new HttpError(400, "https://example.test").name).toBe("HttpError");
		expect(new ConfigError("bad config").name).toBe("ConfigError");
		expect(new ValidationError("bad input").name).toBe("ValidationError");
	});
});
