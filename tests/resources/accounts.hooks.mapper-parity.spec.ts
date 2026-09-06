import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountHooksDSL, AccountHookStorageDSL } from "../../src/dsl/accounts";
import { AccountsMapper } from "../../src/resources/accounts/mapper";
import type { AccountHooksQuery, AccountHookStorageQuery } from "../../src/types";

function withoutLimit(params: Record<string, any>) {
	const { limit: _limit, ...rest } = params;
	return rest;
}

describe("account hooks mapper and DSL", () => {
	it("map identical hook-list queries and retain precision-safe int64 strings", () => {
		const query: AccountHooksQuery = {
			idOrAliasOrEvmAddress: "0.8",
			hookId: "9223372036854775807",
			limit: "max",
			order: "desc",
		};

		const mapped = AccountsMapper.hooks(query);
		const built = new AccountHooksDSL()
			.idOrAliasOrEvmAddress("0.8")
			.hookId("9223372036854775807")
			.limit("max")
			.order("desc")
			._build();

		expect(mapped.id).toBe(built.id);
		expect(withoutLimit(mapped.params)).toEqual(built.params);
		expect(mapped.params["hook.id"]).toBe("9223372036854775807");
	});

	it("accepts the rest-java account path forms and rejects its narrower aliases/prefixes", () => {
		const evm = "ab".repeat(20);
		const alias = "A".repeat(40);
		for (const id of ["8", "0.8", "0.0.8", evm, `0x${evm}`, `0.0.${evm}`, alias, `0.${alias}`, `0.0.${alias}`]) {
			expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: id })).not.toThrow();
		}
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: `0.0.0x${evm}` })).toThrow(ValidationError);
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "ABCDEFGHII" })).toThrow(ValidationError);
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "A".repeat(71) })).toThrow(ValidationError);
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: `100000.0.${evm}` })).toThrow(ValidationError);
	});

	it("preserves repeated hook-id ranges and enforces the 100-value cap", () => {
		const mapped = AccountsMapper.hooks({ idOrAliasOrEvmAddress: "0.0.8", hookId: ["GTE:+0001", "lte:0002"] });
		const built = new AccountHooksDSL().idOrAliasOrEvmAddress("0.0.8").hookId("GTE:+0001").hookId().lessThanOrEqualTo("0002")._build();
		expect(mapped.params["hook.id"]).toEqual(["GTE:+0001", "lte:0002"]);
		expect(mapped.params).toEqual(built.params);
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "0.0.8", hookId: Array.from({ length: 101 }, () => "gte:1") })).toThrow(ValidationError);
		expect(() => new AccountHooksDSL().idOrAliasOrEvmAddress("0.0.8").hookId("ne:1")).toThrow(ValidationError);
	});

	it("accepts hook id zero and rejects out-of-range or imprecise values", () => {
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "0.0.8", hookId: 0 })).not.toThrow();
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "0.0.8", hookId: "9223372036854775808" })).toThrow(ValidationError);
		expect(() => AccountsMapper.hooks({ idOrAliasOrEvmAddress: "0.0.8", hookId: Number.MAX_SAFE_INTEGER + 1 })).toThrow(ValidationError);
		expect(() => new AccountHooksDSL().idOrAliasOrEvmAddress("0.0.8").hookId(0)).not.toThrow();
	});
});

describe("account hook storage mapper and DSL", () => {
	it("applies rest-java raw-nanosecond boundaries in object and direct/fluent DSL forms", () => {
		for (const timestamp of ["9223372036.9", "9223372036.85477581"]) {
			expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, timestamp })).not.toThrow();
			expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp(timestamp)).not.toThrow();
			expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp().equalTo(timestamp)).not.toThrow();
		}

		const overflow = "9223372036.854775808";
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, timestamp: overflow })).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp(overflow)).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp().equalTo(overflow)).toThrow(ValidationError);
	});

	it("map key and exploded timestamp comparators identically, including hook id zero", () => {
		const query: AccountHookStorageQuery = {
			idOrAliasOrEvmAddress: "0.0.8",
			hookId: 0,
			key: "gte:0xabc",
			timestamp: ["gte:1234567890.123456789", "lte:1234567891"],
			limit: "default",
			order: "asc",
		};

		const mapped = AccountsMapper.hookStorage(query);
		const built = new AccountHookStorageDSL()
			.idOrAliasOrEvmAddress("0.0.8")
			.hookId(0)
			.key()
			.greaterThanOrEqualTo("0xabc")
			.timestamp()
			.greaterThanOrEqualTo("1234567890.123456789")
			.timestamp()
			.lessThanOrEqualTo("1234567891")
			.limit("default")
			.order("asc")
			._build();

		expect(mapped.id).toBe(built.id);
		expect(mapped.hookId).toBe(built.hookId);
		expect(withoutLimit(mapped.params)).toEqual(built.params);
		expect(mapped.params.timestamp).toEqual(["gte:1234567890.123456789", "lte:1234567891"]);
	});

	it("accepts direct equality key and timestamp syntax", () => {
		const built = new AccountHookStorageDSL().idOrAliasOrEvmAddress("8").hookId("9223372036854775807").key("eq:f9A15").timestamp("123.000000001")._build();

		expect(built.params).toEqual({ key: "eq:f9A15", timestamp: ["123.000000001"] });
	});

	it.each(["+1", "-0", "0000000000000000000000000000000001"])("preserves Java-long hook path spelling %s", (hookId) => {
		const query: AccountHookStorageQuery = { idOrAliasOrEvmAddress: "0.0.8", hookId };
		const mapped = AccountsMapper.hookStorage(query);
		const built = new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(hookId)._build();
		expect(mapped.hookId).toBe(hookId);
		expect(built.hookId).toBe(hookId);
		expect(mapped).toEqual({ id: built.id, hookId: built.hookId, params: built.params });
	});

	it("preserves repeated storage-key ranges and enforces timestamp cardinality", () => {
		const mapped = AccountsMapper.hookStorage({
			idOrAliasOrEvmAddress: "0.0.8",
			hookId: 1,
			key: ["gte:01", "lte:ff"],
			timestamp: ["GTE:1.9", "LTE:2"],
		});
		const built = new AccountHookStorageDSL()
			.idOrAliasOrEvmAddress("0.0.8")
			.hookId(1)
			.key().greaterThanOrEqualTo("01")
			.key().lessThanOrEqualTo("ff")
			.timestamp("GTE:1.9")
			.timestamp("LTE:2")
			._build();
		expect(mapped.params).toEqual(built.params);
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, timestamp: ["gte:1", "lte:2", "eq:1"] })).toThrow(ValidationError);
	});

	it.each(["ne:01", "0x", "xyz", "a".repeat(65)])("rejects invalid hook storage key %s", (key) => {
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, key })).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).key(key)).toThrow(ValidationError);
	});

	it.each(["12345678901", "1.1234567890", "foo:1", "gte:-1"])("rejects invalid timestamp filter %s", (timestamp) => {
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, timestamp })).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp(timestamp)).toThrow(ValidationError);
	});

	it("rejects the unsupported ne timestamp comparator", () => {
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: 1, timestamp: "ne:1" })).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp("ne:1")).toThrow(ValidationError);
		expect(() =>
			(new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8").hookId(1).timestamp() as any).notEqualTo("1")
		).toThrow(ValidationError);
	});

	it("enforces the storage path id range and required DSL fields", () => {
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: -1 })).toThrow(ValidationError);
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: "9223372036854775808" })).toThrow(ValidationError);
		expect(() => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: "0.0.8", hookId: "eq:1" })).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().hookId(1)._build()).toThrow(ValidationError);
		expect(() => new AccountHookStorageDSL().idOrAliasOrEvmAddress("0.0.8")._build()).toThrow(ValidationError);
	});
});
