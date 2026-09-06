import { describe, it, expect } from "vitest";
import { BalancesMapper } from "../../src/resources/balances/mapper";
import { BalancesListQueryBuilder } from "../../src/dsl/balances";
import { ValidationError } from "../../src/core/errors";

// helper: keep assertions focused on mapped fields we care about
const stripUndefined = (obj: Record<string, any>) => {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out;
};

describe("BalancesMapper vs DSL — list()", () => {
	it("parity: empty query", () => {
		const mapped = BalancesMapper.list(undefined);
		const dsl = new BalancesListQueryBuilder().build();
		expect(mapped).toEqual(dsl.params);
	});

	it("parity: equality on accountId + equality on accountBalance (number), plus order & limit & publickey", () => {
		const obj = {
			accountId: "0.0.100",
			accountBalance: 250, // numeric equality
			accountPublicKey: "302a300506032b6570032100deadbeef",
			order: "desc",
			limit: 10,
		} as any;

		const mapped = BalancesMapper.list(obj);

		const dsl = new BalancesListQueryBuilder()
			.accountId("0.0.100")
			.accountBalance(250) // DSL will stringify equality
			.accountPublicKey("302a300506032b6570032100deadbeef")
			.order("desc")
			.limit(10)
			.build();

		expect(stripUndefined(mapped)).toEqual(stripUndefined(dsl.params));
	});

	it("parity: comparator on accountId and comparator on accountBalance", () => {
		const obj = {
			accountId: "gte:0.0.500",
			accountBalance: "lt:1000000",
			order: "asc",
			limit: 25,
		} as any;

		const mapped = BalancesMapper.list(obj);

		const dsl = new BalancesListQueryBuilder().accountId().greaterThanOrEqualTo("0.0.500").accountBalance().lessThan(1_000_000).order("asc").limit(25).build();

		expect(stripUndefined(mapped)).toEqual(stripUndefined(dsl.params));
	});

	it("parity: timestamp exact + bounded range", () => {
		const obj = {
			// multi-timestamp: exact + comparator range
			timestamp: ["1700000000.123456789", "gte:1699999900", "lte:1700000100"],
			order: "desc",
		} as any;

		const mapped = BalancesMapper.list(obj);

		const dsl = new BalancesListQueryBuilder().timestamp("1700000000.123456789").timestamp().greaterThanOrEqualTo(1699999900).timestamp().lessThanOrEqualTo(1700000100).order("desc").build();

		expect(stripUndefined(mapped)).toEqual(stripUndefined(dsl.params));
	});

	it("parity: supports timestamp given as a single comparator string", () => {
		const obj = {
			timestamp: "gte:1700000000",
		} as any;

		const mapped = BalancesMapper.list(obj);

		const dsl = new BalancesListQueryBuilder()
			.timestamp("gte:1700000000") // DSL also accepts comparator string via validateTimestampFilter
			.build();

		expect(stripUndefined(mapped)).toEqual(stripUndefined(dsl.params));
	});

	it("parity: equality accountBalance zero (0) preserved (edge case)", () => {
		const obj = {
			accountBalance: 0, // should not be dropped
		} as any;

		const mapped = BalancesMapper.list(obj);

		const dsl = new BalancesListQueryBuilder().accountBalance(0).build();

		expect(stripUndefined(mapped)).toEqual(stripUndefined(dsl.params));
	});

	it("preserves repeated numeric account and balance filters", () => {
		const mapped = BalancesMapper.list({
			accountId: ["0.0.1", "gte:0.0.2", "lte:0.0.9"],
			accountBalance: [0, "gt:10", "lte:20"],
		});
		const built = new BalancesListQueryBuilder()
			.accountId(["0.0.1", "gte:0.0.2"])
			.accountId().lessThanOrEqualTo("0.0.9")
			.accountBalance([0, "gt:10"])
			.accountBalance().lessThanOrEqualTo(20)
			.build();
		expect(mapped).toEqual(built.params);
	});
});

describe("Balances account identifier boundaries", () => {
	const evm = `0x${"a".repeat(40)}`;
	const alias = "ABCDEFGHII";
	const extendedAlias = "A".repeat(66);

	it("accepts numeric shorthand and exact account address/alias forms", () => {
		for (const value of ["2", "0.2", "gte:0.2", evm, `eq:${evm}`, alias, `eq:${alias}`, extendedAlias, `eq:${extendedAlias}`]) {
			expect(BalancesMapper.list({ accountId: value })).toEqual({ "account.id": value });
			expect(new BalancesListQueryBuilder().accountId(value).build().params).toEqual({ "account.id": value });
		}
	});

	it("rejects malformed payloads, prefixed aliases, and range comparisons over aliases/addresses", () => {
		for (const value of ["gte:not-an-id", `gt:${evm}`, `ne:${alias}`, `0.0.${alias}`]) {
			expect(() => BalancesMapper.list({ accountId: value })).toThrow(ValidationError);
			expect(() => new BalancesListQueryBuilder().accountId(value)).toThrow(ValidationError);
		}
		expect(() => (new BalancesListQueryBuilder().accountId() as any).greaterThan(evm)).toThrow(ValidationError);
	});

	it("allows one exact alias/address occurrence but rejects a second one", () => {
		expect(BalancesMapper.list({ accountId: ["0.0.1", alias] })).toEqual({ "account.id": ["0.0.1", alias] });
		expect(() => BalancesMapper.list({ accountId: [alias, evm] })).toThrow(ValidationError);
		expect(() => new BalancesListQueryBuilder().accountId(alias).accountId(evm)).toThrow(ValidationError);
	});

	it("matches the legacy parser's ordered alias/address rule and exact deduplication", () => {
		expect(BalancesMapper.list({ accountId: ["gt:0.0.2", alias] })).toEqual({ "account.id": ["gt:0.0.2", alias] });
		expect(BalancesMapper.list({ accountId: [alias, "eq:0.0.2"] })).toEqual({ "account.id": [alias, "eq:0.0.2"] });
		expect(BalancesMapper.list({ accountId: [alias, alias] })).toEqual({ "account.id": [alias, alias] });
		expect(() => BalancesMapper.list({ accountId: [alias, "gt:0.0.2"] })).toThrow(ValidationError);

		expect(new BalancesListQueryBuilder().accountId("gt:0.0.2").accountId(alias).build().params["account.id"]).toEqual([
			"gt:0.0.2",
			alias,
		]);
		expect(() => new BalancesListQueryBuilder().accountId(alias).accountId().greaterThan("0.0.2")).toThrow(ValidationError);
	});
});
