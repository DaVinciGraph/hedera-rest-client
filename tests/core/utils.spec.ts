// tests/core/utils.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
	// time / env helpers
	sleep,
	computeBackoff,
	isBrowser,
	// validators
	validateFullEntityId,
	validateEntityIdStrict,
	validateEntityIdRequest,
	validateEntityIdQueryValue,
	validateEntityIdFilter,
	validateAirdropAccountIdFilter,
	validateEntityIdRangeFilters,
	validateEntityIdOrAliasOrEvm,
	validateJavaAccountIdPath,
	validateAccountIdOrAliasOrEvm,
	validateAccountIdFilter,
	validateEntityIdOrEvm,
	validateEntityIdOrEvmFilter,
	validateTopicId,
	validateScheduleId,
	validateComparatorString,
	parseComparatorValue,
	validateComparatorPayload,
	validateTimestampFilter,
	validateTimestampValue,
	validateJavaTimestampFilter,
	validateJavaTimestampFilters,
	validateTimestampExact,
	validateTransactionIdStr,
	validateInteger,
	validateIntegerFilter,
	validateJavaLongRangeFilter,
	validateJavaLongRangeFilters,
	validateNonNegativeInt32,
	validateNonNegativeInt64,
	validateContractResultBlockNumber,
	NO_NE_COMPARATOR_OPERATORS,
	validatePositiveInt64,
	validateBlockHashOrNumber,
	validateEvmAddress,
	validateLogTopic,
	validateHookStorageKey,
	validateHookStorageKeyFilters,
	validateContractStateSlot,
	validateContractIdOrAddress,
	validateContractIdFilter,
	validateContractFromFilter,
	validateTokenIdOrAddress,
	validateTokenIdFilter,
	validateHex,
	enforceTopicTimestampWindow,
	buildQuery,
	validateTxHashHex32,
	validateTransactionIdOrHash,
	// small helpers
	opOf,
	forbidNe,
} from "../../src/core/utils";

import { ValidationError } from "../../src/core/errors";

describe("core/utils: computeBackoff", () => {
	const originalRandom = Math.random;

	afterEach(() => {
		Math.random = originalRandom;
	});

	it("returns values in [0, base) and clamps base to max", () => {
		// attempt=3, initial=100 => base=800 (below max=1000)
		Math.random = () => 0.0;
		expect(computeBackoff(3, 100, 1000)).toBe(0);

		Math.random = () => 0.9999;
		const v = computeBackoff(3, 100, 1000);
		expect(v).toBeLessThan(800); // floor(random * base), strictly less than base

		// attempt=10, base would exceed max => clamp to max
		Math.random = () => 0.5;
		expect(computeBackoff(10, 100, 1000)).toBe(Math.floor(0.5 * 1000));
	});
});

describe("core/utils: isBrowser", () => {
	const g: any = globalThis;
	let savedWindow: any;
	let savedDocument: any;

	beforeEach(() => {
		savedWindow = g.window;
		savedDocument = g.document;
		delete g.window;
		delete g.document;
	});

	afterEach(() => {
		if (savedWindow !== undefined) g.window = savedWindow;
		else delete g.window;
		if (savedDocument !== undefined) g.document = savedDocument;
		else delete g.document;
	});

	it("returns false in Node-like env", () => {
		expect(isBrowser()).toBe(false);
	});

	it("returns true when window & document exist", () => {
		g.window = {};
		g.document = {};
		expect(isBrowser()).toBe(true);
	});
});

describe("core/utils: validateEntityIdStrict", () => {
	it("accepts shard.realm.num", () => {
		expect(validateEntityIdStrict("0.0.123")).toBe("0.0.123");
		expect(validateFullEntityId("1023.65535.274877906943")).toBe("1023.65535.274877906943");
	});

	it("rejects request shorthand and malformed response ids", () => {
		expect(() => validateEntityIdStrict("123")).toThrow(ValidationError);
		expect(() => validateEntityIdStrict("0.123")).toThrow(ValidationError);
		expect(() => validateEntityIdStrict("0.0")).toThrow(ValidationError);
		expect(() => validateEntityIdStrict("a.b.c")).toThrow(ValidationError);
		expect(() => validateEntityIdStrict("0.0.")).toThrow(ValidationError);
	});
});

describe("core/utils: request entity identifiers", () => {
	it("accepts and preserves num, realm.num, and shard.realm.num", () => {
		for (const id of ["8", "4.8", "0.4.8"]) {
			expect(validateEntityIdRequest(id)).toBe(id);
		}
		expect(validateEntityIdQueryValue("0.2")).toBe("0.2");
	});

	it("keeps topic and schedule IDs numeric while allowing request shorthand", () => {
		expect(validateTopicId("7")).toBe("7");
		expect(validateTopicId("0.0.7")).toBe("0.0.7");
		expect(validateScheduleId("4.2000")).toBe("4.2000");
		expect(() => validateTopicId("0x" + "a".repeat(40))).toThrow(ValidationError);
		expect(() => validateScheduleId("AABBCC22")).toThrow(ValidationError);
	});

	it("rejects invalid components and non-identifier forms", () => {
		for (const id of ["", "0.", ".0", "0.0.0.1", "-1", "0.-1.1", "274877906944", "0.0.274877906944", "1024.0.1", "0.65536.1"]) {
			expect(() => validateEntityIdRequest(id)).toThrow(ValidationError);
		}
	});

	it("accepts the deployed component boundaries and 11–12 digit entity numbers", () => {
		for (const id of ["123456789012", "0.123456789012", "1023.65535.274877906943"]) {
			expect(validateEntityIdRequest(id)).toBe(id);
		}
	});

	it("applies signed packed-ID boundaries only to database range filters", () => {
		const largestRangeId = "511.65535.274877906943";
		expect(validateEntityIdFilter(`eq:${largestRangeId}`)).toBe(`eq:${largestRangeId}`);
		expect(validateEntityIdFilter("eq:0000000000000000000000000000000000000002")).toBe(
			"eq:0000000000000000000000000000000000000002"
		);
		expect(validateEntityIdFilter("eq:00000.000000.0000000000002")).toBe("eq:00000.000000.0000000000002");
		expect(validateEntityIdFilter("eq:+0.-0.+2")).toBe("eq:+0.-0.+2");
		expect(() => validateEntityIdFilter("eq:512.0.0")).toThrow(ValidationError);
		expect(() => validateEntityIdFilter("eq:-1.0.0")).toThrow(ValidationError);
		expect(() => validateEntityIdFilter("eq:1023.0.1")).toThrow(ValidationError);
		expect(() => validateEntityIdFilter(`gt:${largestRangeId}`)).toThrow(ValidationError);

		// JS-backed filters use request-ID bounds rather than packed range bounds.
		expect(validateEntityIdOrEvmFilter("eq:512.0.0")).toBe("eq:512.0.0");
		expect(validateTokenIdFilter("eq:1023.0.1")).toBe("eq:1023.0.1");
	});

	it("rejects only provider-independent zero for a primary account's empty exclusive upper range", () => {
		for (const value of ["lt:0", "lt:00", "lt:0.0"]) {
			expect(() => validateAirdropAccountIdFilter(value, "receiver.id")).not.toThrow();
		}
		for (const value of ["lt:+0.-0.000", "lt:0.0.0"]) {
			expect(() => validateAirdropAccountIdFilter(value, "receiver.id")).toThrow(ValidationError);
		}
		expect(validateTokenIdFilter("lt:0")).toBe("lt:0");
	});
});

describe("core/utils: validateEntityIdOrAliasOrEvm", () => {
	it("accepts entity id", () => {
		expect(validateEntityIdOrAliasOrEvm("0.0.123")).toBe("0.0.123");
		expect(validateAccountIdOrAliasOrEvm("123")).toBe("123");
		expect(validateAccountIdOrAliasOrEvm("4.123")).toBe("4.123");
	});

	it("accepts EVM address with and without 0x", () => {
		const prefixed = "0x" + "a".repeat(40);
		const bare = "b".repeat(40);
		expect(validateEntityIdOrAliasOrEvm(prefixed)).toBe(prefixed);
		expect(validateEntityIdOrAliasOrEvm(bare)).toBe(bare);
		expect(validateEntityIdOrAliasOrEvm("0.0." + bare)).toBe("0.0." + bare);
		expect(validateEntityIdOrAliasOrEvm("99999.99999." + bare)).toBe("99999.99999." + bare);
		expect(validateEntityIdOrAliasOrEvm("0.0.0x" + bare)).toBe("0.0.0x" + bare);
	});

	it("accepts base32 alias (with optional prefix)", () => {
		// The final symbol's unused RFC4648 bits are zero (I = binary 01000).
		const alias = "ABCDEFGHII";
		expect(() => validateEntityIdOrAliasOrEvm(alias)).not.toThrow();
		expect(() => validateEntityIdOrAliasOrEvm("0.0." + alias)).not.toThrow();
		expect(() => validateEntityIdOrAliasOrEvm("A".repeat(64))).not.toThrow();
		expect(() => validateEntityIdOrAliasOrEvm("A".repeat(66))).not.toThrow();
		expect(() => validateEntityIdOrAliasOrEvm("A".repeat(128))).not.toThrow();
	});

	it("rejects invalid strings", () => {
		expect(() => validateEntityIdOrAliasOrEvm("xyz")).toThrow(ValidationError);
		expect(() => validateEntityIdOrAliasOrEvm("aabbcc22")).toThrow(ValidationError);
		expect(() => validateEntityIdOrAliasOrEvm("ABCDEFGHIJ")).toThrow(ValidationError);
		expect(() => validateEntityIdOrAliasOrEvm("A".repeat(65))).toThrow(ValidationError);
		expect(() => validateEntityIdOrAliasOrEvm("A".repeat(67))).toThrow(ValidationError);
		expect(() => validateEntityIdOrAliasOrEvm("0.0.0.AABBCC22")).toThrow(ValidationError);
	});

	it("uses the narrower rest-java account-path grammar only where requested", () => {
		const evm = "ab".repeat(20);
		const javaAlias = "A".repeat(40);
		const nonCanonicalButJavaDecodableAlias = `${"A".repeat(41)}B`;
		expect(validateJavaAccountIdPath("0.0.8")).toBe("0.0.8");
		expect(validateJavaAccountIdPath(`99999.99999.${evm}`)).toBe(`99999.99999.${evm}`);
		expect(validateJavaAccountIdPath(javaAlias)).toBe(javaAlias);
		expect(validateJavaAccountIdPath(nonCanonicalButJavaDecodableAlias)).toBe(nonCanonicalButJavaDecodableAlias);
		expect(() => validateJavaAccountIdPath(`100000.0.${evm}`)).toThrow(ValidationError);
		expect(() => validateJavaAccountIdPath(`0.0.0x${evm}`)).toThrow(ValidationError);
		expect(() => validateJavaAccountIdPath("A".repeat(39))).toThrow(ValidationError);
		expect(() => validateJavaAccountIdPath("A".repeat(71))).toThrow(ValidationError);
	});
});

describe("core/utils: contract and token identifiers", () => {
	it("accepts and preserves contract ID shorthand and EVM-address forms", () => {
		const address = "a".repeat(40);
		for (const id of ["500", "4.500", "0.4.500", address, `0x${address}`, `0.0.${address}`, `0.0.0x${address}`]) {
			expect(validateContractIdOrAddress(id)).toBe(id);
		}
	});

	it("rejects malformed contract identifiers", () => {
		expect(() => validateContractIdOrAddress("0.0.0X" + "a".repeat(40))).toThrow(ValidationError);
		expect(() => validateContractIdOrAddress("AABBCC22")).toThrow(ValidationError);
		expect(() => validateContractIdOrAddress("0.0.1.2")).toThrow(ValidationError);
	});

	it("accepts token IDs and documented Solidity-address forms", () => {
		const solidityAddress = "0".repeat(24) + "000000000000046f";
		for (const id of ["1135", "0.1135", "0.0.1135", solidityAddress, `0x${solidityAddress}`, `0.0.${solidityAddress}`, `1.2.${solidityAddress}`]) {
			expect(validateTokenIdOrAddress(id)).toBe(id);
		}

		expect(() => validateTokenIdOrAddress("0.0.0x" + solidityAddress)).toThrow(ValidationError);
		expect(() => validateTokenIdOrAddress("1024.0." + solidityAddress)).toThrow(ValidationError);
		expect(() => validateTokenIdOrAddress("0.65536." + solidityAddress)).toThrow(ValidationError);
		expect(() => validateTokenIdOrAddress("06bd279138d5918402fc8ad500526cb2ee0eb985")).toThrow(ValidationError);
	});

	it("enforces the token-num alias range", () => {
		const maxAddress = "0".repeat(24) + ((1n << 38n) - 1n).toString(16).padStart(16, "0");
		const overflowAddress = "0".repeat(24) + (1n << 38n).toString(16).padStart(16, "0");
		expect(validateTokenIdOrAddress(`0x${maxAddress}`)).toBe(`0x${maxAddress}`);
		expect(() => validateTokenIdOrAddress(`0x${overflowAddress}`)).toThrow(ValidationError);
	});
});

describe("core/utils: validateComparatorString", () => {
	it("accepts valid comparator forms", () => {
		expect(() => validateComparatorString("gt:100")).not.toThrow();
		expect(() => validateComparatorString("lte:abc")).not.toThrow();
		expect(() => validateComparatorString("ne:0x1234")).not.toThrow();
	});

	it("rejects invalid comparators", () => {
		expect(() => validateComparatorString("foo:1")).toThrow(ValidationError);
		expect(() => validateComparatorString("gt:")).toThrow(ValidationError);
		expect(() => validateComparatorString(":100")).toThrow(ValidationError);
	});
});

describe("core/utils: validateTimestampFilter", () => {
	it("accepts numeric and string raw timestamps", () => {
		expect(() => validateTimestampFilter(0)).not.toThrow();
		expect(() => validateTimestampFilter(123)).not.toThrow();
		expect(() => validateTimestampFilter("123")).not.toThrow();
		expect(() => validateTimestampFilter("123.456789")).not.toThrow();
	});

	it("accepts comparator timestamps", () => {
		expect(() => validateTimestampFilter("gt:123")).not.toThrow();
		expect(() => validateTimestampFilter("lte:123.45")).not.toThrow();
		expect(() => validateTimestampFilter("ne:1")).not.toThrow();
	});

	it("rejects invalid timestamps", () => {
		expect(() => validateTimestampFilter(-1)).toThrow(ValidationError);
		expect(() => validateTimestampFilter(123.456)).toThrow(ValidationError);
		expect(() => validateTimestampFilter("abc")).toThrow(ValidationError);
		expect(() => validateTimestampFilter("gt:-2")).toThrow(ValidationError);
		expect(() => validateTimestampFilter("10000000000")).toThrow(ValidationError);
		expect(() => validateTimestampFilter("1.1234567890")).toThrow(ValidationError);
		expect(() => validateTimestampFilter(" 1")).toThrow(ValidationError);
		expect(() => validateTimestampFilter("gt:lte:1")).toThrow(ValidationError);
		expect(() => validateTimestampFilter(1n as any)).toThrow(ValidationError);
		expect(() => validateTimestampFilter([1] as any)).toThrow(ValidationError);
	});

	it("validates comparator availability and requires bare fluent values", () => {
		expect(() => validateTimestampFilter("lte:1", ["eq", "lt", "lte"])).not.toThrow();
		expect(() => validateTimestampFilter("gte:1", ["eq", "lt", "lte"])).toThrow(ValidationError);
		expect(() => validateTimestampValue("gte:1")).toThrow(ValidationError);
	});

	it("caps legacy timestamps at signed-int64 nanoseconds", () => {
		expect(() => validateTimestampValue("9223372036.854775807")).not.toThrow();
		expect(() => validateTimestampValue(9_223_372_036)).not.toThrow();
		expect(() => validateTimestampValue("9223372036.854775808")).toThrow(ValidationError);
		expect(() => validateTimestampValue("9999999999.999999999")).toThrow(ValidationError);
		expect(() => validateTimestampValue(9_999_999_999)).toThrow(ValidationError);
		expect(() => validateTimestampValue("10000000000")).toThrow(ValidationError);
		expect(() => validateTimestampValue(10_000_000_000)).toThrow(ValidationError);
		expect(() => validateTimestampFilter("lte:9223372036.854775807")).not.toThrow();
		expect(() => validateTimestampFilter("lte:9999999999")).toThrow(ValidationError);
	});

	it("matches rest-java timestamp parsing and range bounds", () => {
		expect(() => validateJavaTimestampFilter("GTE:00000000000000001.9")).not.toThrow();
		expect(() => validateJavaTimestampFilter("9223372036.854775807")).not.toThrow();
		expect(() => validateJavaTimestampFilter("9223372036.8")).not.toThrow();
		expect(() => validateJavaTimestampFilter("9223372036.9")).not.toThrow();
		expect(() => validateJavaTimestampFilter("9223372036.85477581")).not.toThrow();
		expect(() => validateJavaTimestampFilter("lt:0")).not.toThrow();
		expect(() => validateJavaTimestampFilter("gt:9223372036.854775807")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilter("9223372036.854775808")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilter("9999999999")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilter("NE:1")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilters(["gte:1", "lte:2", "eq:1"])).toThrow(ValidationError);
	});

	it("keeps legacy fractional timestamp scaling separate from rest-java raw nanoseconds", () => {
		expect(() => validateTimestampValue("9223372036.9")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilter("9223372036.9")).not.toThrow();
		expect(() => validateTimestampValue("9223372036.85477581")).toThrow(ValidationError);
		expect(() => validateJavaTimestampFilter("9223372036.85477581")).not.toThrow();
	});
});

describe("core/utils: comparator payload validation", () => {
	it("splits comparator expressions without changing the operator or payload", () => {
		expect(parseComparatorValue("gte:0.0.001")).toEqual({ operator: "gte", value: "0.0.001" });
		expect(parseComparatorValue("0.0.001")).toEqual({ value: "0.0.001" });
	});

	it("validates allowed operators before delegating the complete payload", () => {
		const seen: string[] = [];
		expect(validateComparatorPayload("gte:0.0.001", (value) => seen.push(value), { name: "entity.id", comparators: NO_NE_COMPARATOR_OPERATORS })).toBe("gte:0.0.001");
		expect(seen).toEqual(["0.0.001"]);
		expect(() => validateComparatorPayload("ne:0.0.1", () => undefined, { name: "entity.id", comparators: NO_NE_COMPARATOR_OPERATORS })).toThrow(ValidationError);
		expect(() => validateComparatorPayload("gte:", () => undefined)).toThrow(ValidationError);
		expect(() => validateComparatorPayload("wat:0.0.1", () => undefined)).toThrow(ValidationError);
	});

	it("identifier filters reject malformed and nested comparator payloads", () => {
		expect(validateEntityIdFilter("gte:0.0.5")).toBe("gte:0.0.5");
		expect(validateEntityIdFilter("gte:0.5")).toBe("gte:0.5");
		for (const operator of ["eq", "ne", "gt", "gte", "lt", "lte"]) {
			expect(validateAccountIdFilter(`${operator}:0.2`)).toBe(`${operator}:0.2`);
		}
		const accountEvmAddress = "0x" + "a".repeat(40);
		const accountAlias = "ABCDEFGHII";
		expect(validateAccountIdFilter(accountEvmAddress)).toBe(accountEvmAddress);
		expect(validateAccountIdFilter(`eq:${accountEvmAddress}`)).toBe(`eq:${accountEvmAddress}`);
		expect(validateAccountIdFilter(accountAlias)).toBe(accountAlias);
		expect(validateAccountIdFilter(`eq:${accountAlias}`)).toBe(`eq:${accountAlias}`);
		expect(validateEntityIdOrEvm("0.2")).toBe("0.2");
		expect(validateEntityIdOrEvmFilter(`gte:${accountEvmAddress}`)).toBe(`gte:${accountEvmAddress}`);
		expect(validateContractIdFilter("lt:500")).toBe("lt:500");
		const tokenAddress = "0".repeat(24) + "000000000000046f";
		expect(validateContractIdFilter(tokenAddress)).toBe(tokenAddress);
		expect(validateContractIdFilter(`0.0.${tokenAddress}`)).toBe(`0.0.${tokenAddress}`);
		expect(validateTokenIdFilter(tokenAddress)).toBe(tokenAddress);
		expect(validateTokenIdFilter(`gte:0x${tokenAddress}`)).toBe(`gte:0x${tokenAddress}`);
		expect(validateTokenIdFilter(`eq:1.2.${tokenAddress}`)).toBe(`eq:1.2.${tokenAddress}`);
		expect(validateContractIdFilter(`eq:${tokenAddress}`)).toBe(`eq:${tokenAddress}`);
		expect(validateContractFromFilter(`ne:${accountEvmAddress}`)).toBe(`ne:${accountEvmAddress}`);

		expect(() => validateEntityIdFilter("gte:not-an-id")).toThrow(ValidationError);
		expect(() => validateEntityIdFilter("gte:lte:0.0.5")).toThrow(ValidationError);
		expect(() => validateAccountIdFilter(`gt:${accountEvmAddress}`)).toThrow(ValidationError);
		expect(() => validateAccountIdFilter(`ne:${accountAlias}`)).toThrow(ValidationError);
		expect(() => validateAccountIdFilter(`0.0.${accountAlias}`)).toThrow(ValidationError);
		expect(() => validateEntityIdOrEvmFilter("gte:not-an-id")).toThrow(ValidationError);
		expect(() => validateContractIdFilter("gt:AABBCC22")).toThrow(ValidationError);
		expect(() => validateContractIdFilter("0x" + "a".repeat(40))).toThrow(ValidationError);
		expect(() => validateContractIdFilter(`gt:${tokenAddress}`)).toThrow(ValidationError);
		expect(() => validateTokenIdFilter("ne:06bd279138d5918402fc8ad500526cb2ee0eb985")).toThrow(ValidationError);
		expect(() => validateContractFromFilter("eq:0.0." + "a".repeat(40))).toThrow(ValidationError);
	});
});

describe("core/utils: validateTimestampExact", () => {
	it("accepts exact 's' or 's.ns'", () => {
		expect(() => validateTimestampExact("0")).not.toThrow();
		expect(() => validateTimestampExact("123")).not.toThrow();
		expect(() => validateTimestampExact("123.456")).not.toThrow();
	});

	it("rejects comparator or malformed values", () => {
		expect(() => validateTimestampExact("gt:123")).toThrow(ValidationError);
		expect(() => validateTimestampExact("abc")).toThrow(ValidationError);
	});
});

describe("core/utils: validateTransactionIdStr & validateTransactionIdOrHash", () => {
	it("accepts transaction id string 0.0.x-<seconds>-<nanos>", () => {
		expect(() => validateTransactionIdStr("0.0.123-1700000000-123")).not.toThrow();
		expect(() => validateTransactionIdStr("1023.65535.274877906943-9223372036854775807-999999999")).not.toThrow();
	});

	it("rejects malformed tx id", () => {
		expect(() => validateTransactionIdStr("0.0.123-1700000000")).toThrow(ValidationError);
		expect(() => validateTransactionIdStr("abc")).toThrow(ValidationError);
	});

	it("rejects transaction IDs whose entity components exceed request bounds", () => {
		for (const transactionId of [
			"1024.0.1-1700000000-1",
			"0.65536.1-1700000000-1",
			"0.0.274877906944-1700000000-1",
		]) {
			expect(() => validateTransactionIdStr(transactionId)).toThrow(ValidationError);
			expect(() => validateTransactionIdOrHash(transactionId)).toThrow(ValidationError);
		}
	});

	it("rejects transaction-ID seconds above the signed-int64 maximum", () => {
		const transactionId = "0.0.123-9223372036854775808-1";
		expect(() => validateTransactionIdStr(transactionId)).toThrow(ValidationError);
		expect(() => validateTransactionIdOrHash(transactionId)).toThrow(ValidationError);
	});

	it("validateTransactionIdOrHash accepts txId or 32-byte hash", () => {
		expect(() => validateTransactionIdOrHash("0.0.123-1700000000-1")).not.toThrow();
		expect(() => validateTransactionIdOrHash("0x" + "a".repeat(64))).not.toThrow();
		expect(() => validateTransactionIdOrHash("b".repeat(64))).not.toThrow();
	});

	it("validateTransactionIdOrHash rejects invalid", () => {
		expect(() => validateTransactionIdOrHash("not-a-txid")).toThrow(ValidationError);
	});
});

describe("core/utils: integer validators", () => {
	it("accepts exact signed-int64 boundaries without losing precision", () => {
		expect(() => validatePositiveInt64(123, "n")).not.toThrow();
		expect(() => validatePositiveInt64("9223372036854775807", "n")).not.toThrow();
		expect(() => validateNonNegativeInt64(0, "n")).not.toThrow();
	});

	it("rejects zero for positive values, signed-int64 overflow, and unsafe numbers", () => {
		expect(() => validatePositiveInt64(0, "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64(-1, "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64("1.1", "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64("abc", "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64("9223372036854775808", "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64(Number.MAX_SAFE_INTEGER + 1, "n")).toThrow(ValidationError);
		expect(() => validatePositiveInt64("00000000000000000001", "n")).toThrow(ValidationError);
	});

	it("validates the numeric suffix and allowed operator of integer filters", () => {
		expect(() => validateIntegerFilter("gte:42", "serial", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS })).not.toThrow();
		expect(() => validateIntegerFilter("gte:abc", "serial", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS })).toThrow(ValidationError);
		expect(() => validateIntegerFilter("gte:1.5", "serial", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS })).toThrow(ValidationError);
		expect(() => validateIntegerFilter("gte:lte:1", "serial", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS })).toThrow(ValidationError);
		expect(() => validateIntegerFilter("ne:1", "serial", { minimum: 1, comparators: NO_NE_COMPARATOR_OPERATORS })).toThrow(ValidationError);
		expect(() => validateIntegerFilter("gt:9223372036854775807", "serial", { comparators: NO_NE_COMPARATOR_OPERATORS })).not.toThrow();
		expect(() => validateInteger("eq:1", "serial")).toThrow(ValidationError);
	});

	it("rejects runtime values that merely stringify to integers", () => {
		expect(() => validateInteger(1n as any, "serial")).toThrow(ValidationError);
		expect(() => validateInteger([1] as any, "serial")).toThrow(ValidationError);
		expect(() => validateIntegerFilter({ toString: () => "gte:1" } as any, "serial")).toThrow(ValidationError);
	});

	it("matches Java long-range lexical and boundary behavior", () => {
		for (const value of ["+1", "-0", "0000000000000000000000000000000001", "gte:+2", "GTE:2"]) {
			expect(() => validateJavaLongRangeFilter(value, "node.id", { comparators: NO_NE_COMPARATOR_OPERATORS })).not.toThrow();
		}
		expect(() => validateJavaLongRangeFilter("gt:9223372036854775807", "node.id")).toThrow(ValidationError);
		expect(() => validateJavaLongRangeFilter("lt:-0", "node.id", { rejectLtZero: true })).toThrow(ValidationError);
		expect(() => validateJavaLongRangeFilter("lt:0", "serialnumber")).not.toThrow();
		expect(() => validateJavaLongRangeFilter("-1", "node.id")).toThrow(ValidationError);
	});

	it("validates repeated rest-java ranges with endpoint-specific structure", () => {
		expect(validateEntityIdRangeFilters(["GTE:0.0.2", "LTE:0.0.5"], "account.id", { structured: true, orderedBounds: true })).toEqual([
			"GTE:0.0.2",
			"LTE:0.0.5",
		]);
		expect(() => validateEntityIdRangeFilters(["gte:0.0.5", "lte:0.0.4"], "account.id", { orderedBounds: true })).toThrow(ValidationError);
		expect(() => validateEntityIdRangeFilters(["gte:1.2.5", "lte:10"], "account.id", { orderedBounds: true })).not.toThrow();
		expect(() => validateEntityIdRangeFilters(["eq:0.0.5", "lte:0.0.4"], "account.id", { orderedBounds: true })).toThrow(ValidationError);
		expect(() => validateEntityIdRangeFilters(["eq:1", "gte:1"], "token.id", { structured: true })).toThrow(ValidationError);
		expect(() => validateEntityIdRangeFilters(["gte:1", "lte:2", "eq:1"], "token.id")).toThrow(ValidationError);

		expect(validateJavaLongRangeFilters(["GTE:+1", "LTE:0002"], "registerednode.id", { orderedBounds: true })).toEqual(["GTE:+1", "LTE:0002"]);
		expect(() => validateJavaLongRangeFilters(["gte:5", "lte:4"], "node.id", { orderedBounds: true })).toThrow(ValidationError);
		expect(() => validateJavaLongRangeFilters(["eq:1", "gte:1"], "registerednode.id", { equalityMustBeAlone: true })).toThrow(ValidationError);
	});

	it("validates repeated hook-storage key ranges and wraparound bounds", () => {
		expect(validateHookStorageKeyFilters(["gte:0x01", "lte:ff"])).toEqual(["gte:0x01", "lte:ff"]);
		expect(() => validateHookStorageKey("GTE:01")).toThrow(ValidationError);
		expect(() => validateHookStorageKey("lt:0")).toThrow(ValidationError);
		expect(() => validateHookStorageKey(`gt:${"f".repeat(64)}`)).toThrow(ValidationError);
		expect(() => validateHookStorageKeyFilters(Array.from({ length: 101 }, () => "eq:01"))).toThrow(ValidationError);
	});

	it("validates int32 decimal strings canonically", () => {
		expect(() => validateNonNegativeInt32("2147483647", "nonce")).not.toThrow();
		expect(() => validateNonNegativeInt32("2147483648", "nonce")).toThrow(ValidationError);
		expect(() => validateNonNegativeInt32("1e2", "nonce")).toThrow(ValidationError);
		expect(() => validateNonNegativeInt32(" 1", "nonce")).toThrow(ValidationError);
	});
});

describe("core/utils: validateBlockHashOrNumber", () => {
	it("accepts decimal numbers throughout the signed-int64 range", () => {
		expect(() => validateBlockHashOrNumber("123")).not.toThrow();
		expect(() => validateBlockHashOrNumber("9223372036854775807")).not.toThrow();
	});

	it("accepts 32-byte or 48-byte hashes (with or without 0x)", () => {
		expect(() => validateBlockHashOrNumber("0x" + "a".repeat(64))).not.toThrow();
		expect(() => validateBlockHashOrNumber("b".repeat(64))).not.toThrow();
		expect(() => validateBlockHashOrNumber("0x" + "c".repeat(96))).not.toThrow();
		expect(() => validateBlockHashOrNumber("d".repeat(96))).not.toThrow();
	});

	it("rejects invalid forms", () => {
		expect(() => validateBlockHashOrNumber("")).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber("0x")).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber("g".repeat(64))).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber("0x" + "z".repeat(64))).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber("0x10")).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber("9223372036854775808")).toThrow(ValidationError);
		expect(() => validateBlockHashOrNumber(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
	});

	it("keeps contract result block filters equality-only while supporting hex", () => {
		expect(() => validateContractResultBlockNumber("eq:9223372036854775807")).not.toThrow();
		expect(() => validateContractResultBlockNumber("0x10")).not.toThrow();
		expect(() => validateContractResultBlockNumber("gt:1")).toThrow(ValidationError);
		expect(() => validateContractResultBlockNumber("9223372036854775808")).toThrow(ValidationError);
		expect(() => validateContractResultBlockNumber(1n as any)).toThrow(ValidationError);
		expect(() => validateContractResultBlockNumber(null as any)).toThrow(ValidationError);
	});
});

describe("core/utils: EVM/hex validators", () => {
	it("validateEvmAddress accepts 40-hex with/without 0x", () => {
		expect(() => validateEvmAddress("0x" + "a".repeat(40))).not.toThrow();
		expect(() => validateEvmAddress("b".repeat(40))).not.toThrow();
	});

	it("validateEvmAddress rejects invalid", () => {
		expect(() => validateEvmAddress("0x" + "a".repeat(39))).toThrow(ValidationError);
		expect(() => validateEvmAddress("0x" + "g".repeat(40))).toThrow(ValidationError);
		expect(() => validateEvmAddress(BigInt("1".repeat(40)) as any)).toThrow(ValidationError);
	});

	it("validateLogTopic accepts the OAS topic-filter range and optional prefix", () => {
		expect(() => validateLogTopic("0x" + "a".repeat(64))).not.toThrow();
		expect(() => validateLogTopic("a".repeat(64))).not.toThrow();
		expect(() => validateLogTopic("0x1")).not.toThrow();
		expect(() => validateLogTopic("f")).not.toThrow();
	});

	it("validateLogTopic rejects invalid", () => {
		expect(() => validateLogTopic("")).toThrow(ValidationError);
		expect(() => validateLogTopic("0x")).toThrow(ValidationError);
		expect(() => validateLogTopic("a".repeat(65))).toThrow(ValidationError);
		expect(() => validateLogTopic("0xgg")).toThrow(ValidationError);
	});

	it("validateContractStateSlot accepts no-ne comparators", () => {
		expect(() => validateContractStateSlot("0x01")).not.toThrow();
		expect(() => validateContractStateSlot("gte:0x01")).not.toThrow();
		expect(() => validateContractStateSlot("ne:0x01")).toThrow(ValidationError);
	});

	it("validateContractIdOrAddress accepts entity id or evm address", () => {
		expect(() => validateContractIdOrAddress("0.0.123")).not.toThrow();
		expect(() => validateContractIdOrAddress("0.0")).not.toThrow();
		expect(() => validateContractIdOrAddress("0x" + "a".repeat(40))).not.toThrow();
	});

	it("validateContractIdOrAddress rejects invalid", () => {
		expect(() => validateContractIdOrAddress("0..0")).toThrow(ValidationError);
		expect(() => validateContractIdOrAddress("0x" + "a".repeat(39))).toThrow(ValidationError);
	});

	it("validateHex accepts hex with/without 0x", () => {
		expect(() => validateHex("0xabc")).not.toThrow();
		expect(() => validateHex("abc123")).not.toThrow();
	});

	it("validateHex rejects non-hex", () => {
		expect(() => validateHex("0xz1")).toThrow(ValidationError);
	});

	it("validateTxHashHex32 accepts 32-byte hex", () => {
		expect(() => validateTxHashHex32("0x" + "a".repeat(64))).not.toThrow();
		expect(() => validateTxHashHex32("b".repeat(64))).not.toThrow();
	});

	it("validateTxHashHex32 rejects invalid length/content", () => {
		expect(() => validateTxHashHex32("0x" + "a".repeat(63))).toThrow(ValidationError);
		expect(() => validateTxHashHex32("0x" + "z".repeat(64))).toThrow(ValidationError);
	});
});

describe("core/utils: enforceTopicTimestampWindow", () => {
	const DAY = 24 * 3600;

	it("no topic → no enforcement", () => {
		expect(() => enforceTopicTimestampWindow(undefined, false)).not.toThrow();
		expect(() => enforceTopicTimestampWindow("gte:100", false)).not.toThrow();
	});

	it("topic present without timestamp → throws", () => {
		expect(() => enforceTopicTimestampWindow(undefined, true)).toThrow(ValidationError);
	});

	it("exact timestamp allowed (window 0)", () => {
		expect(() => enforceTopicTimestampWindow("1700000000.0001", true)).not.toThrow();
		// also accepts numeric exact
		expect(() => enforceTopicTimestampWindow(1700000000, true)).not.toThrow();
	});

	it("bounded range within 7 days is allowed", () => {
		const lower = 1_700_000_000;
		const upper = lower + 6 * DAY; // 6 days
		expect(() => enforceTopicTimestampWindow([`gte:${lower}`, `lte:${upper}`], true)).not.toThrow();
	});

	it("allows an exact seven-day inclusive nanosecond range", () => {
		const lower = 1_700_000_000;
		const finalWholeSecond = lower + 7 * DAY - 1;
		expect(() =>
			enforceTopicTimestampWindow([`gte:${lower}.000000000`, `lte:${finalWholeSecond}.999999999`], true)
		).not.toThrow();
	});

	it("rejects a range just one nanosecond over seven days", () => {
		const lower = 1_700_000_000;
		const upper = lower + 7 * DAY;
		expect(() => enforceTopicTimestampWindow([`gte:${lower}.000000000`, `lte:${upper}.000000000`], true)).toThrow(ValidationError);
	});

	it("applies exclusive gt/lt adjustments before measuring the range", () => {
		const lower = 1_700_000_000;
		const upper = lower + 7 * DAY;
		expect(() => enforceTopicTimestampWindow([`gt:${lower}`, `lte:${upper}`], true)).not.toThrow();
		expect(() => enforceTopicTimestampWindow([`gte:${lower}`, `lt:${upper}`], true)).not.toThrow();
	});

	it("rejects reversed and empty effective ranges", () => {
		expect(() => enforceTopicTimestampWindow(["gte:1700000001", "lte:1700000000"], true)).toThrow(ValidationError);
		expect(() => enforceTopicTimestampWindow(["gt:1700000000", "lte:1700000000"], true)).toThrow(ValidationError);
		expect(() => enforceTopicTimestampWindow(["gte:1700000000", "lt:1700000000"], true)).toThrow(ValidationError);
	});

	it("unbounded (only lower or only upper) is rejected", () => {
		expect(() => enforceTopicTimestampWindow([`gte:1700000000`], true)).toThrow(ValidationError);
		expect(() => enforceTopicTimestampWindow([`lte:1700000000`], true)).toThrow(ValidationError);
	});

	it("eq:timestamp is treated as exact and allowed", () => {
		expect(() => enforceTopicTimestampWindow([`eq:1700000000.1`], true)).not.toThrow();
	});
});

describe("core/utils: buildQuery", () => {
	it("drops undefined/null and repeats array keys", () => {
		const q = buildQuery({
			a: ["x", "y"],
			b: 1,
			c: undefined,
			d: null,
			e: false,
		});
		// ?a=x&a=y&b=1&e=false (order of keys may vary)
		const s = new URLSearchParams(q.startsWith("?") ? q.slice(1) : q);
		expect(s.getAll("a").sort()).toEqual(["x", "y"].sort());
		expect(s.get("b")).toBe("1");
		expect(s.get("e")).toBe("false");
		expect(s.has("c")).toBe(false);
		expect(s.has("d")).toBe(false);
	});

	it("returns empty string when no params", () => {
		expect(buildQuery({})).toBe("");
		expect(buildQuery({ x: undefined, y: null })).toBe("");
	});
});

describe("core/utils: small helpers", () => {
	it("opOf extracts comparator op", () => {
		expect(opOf("lt:100")).toBe("lt");
		expect(opOf("ne:1")).toBe("ne");
		expect(opOf("100")).toBeUndefined();
	});

	it("forbidNe throws only on 'ne'", () => {
		expect(() => forbidNe("ne:1")).toThrow(ValidationError);
		expect(() => forbidNe("lt:1")).not.toThrow();
		expect(() => forbidNe("eq:1")).not.toThrow();
		expect(() => forbidNe("100")).not.toThrow();
	});
});

describe("core/utils: sleep", () => {
	it("resolves after the given delay (fake timers)", async () => {
		vi.useFakeTimers();
		const p = sleep(50);
		// No resolution yet
		let done = false;
		p.then(() => (done = true));
		expect(done).toBe(false);

		vi.advanceTimersByTime(49);
		await Promise.resolve(); // allow any microtasks
		expect(done).toBe(false);

		vi.advanceTimersByTime(1);
		await Promise.resolve();
		expect(done).toBe(true);

		vi.useRealTimers();
	});
});
