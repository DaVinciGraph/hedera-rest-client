import { describe, it, expect } from "vitest";
import { BlocksMapper } from "../../src/resources/blocks/mapper";
import { BlocksListQueryBuilder } from "../../src/dsl/blocks";
import { ValidationError } from "../../src/core/errors";

const stripUndef = (o: Record<string, any>) => {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
	return out;
};

describe("BlocksMapper vs DSL — list()", () => {
	it("parity: empty query", () => {
		const mapped = BlocksMapper.list(undefined);
		const dsl = new BlocksListQueryBuilder().build();
		expect(mapped).toEqual(dsl.params);
	});

	it("parity: equality on blockNumber (number) with order & limit", () => {
		const obj = {
			blockNumber: 123, // equality numeric
			order: "desc",
			limit: 5,
		} as any;

		const mapped = BlocksMapper.list(obj);

		const dsl = new BlocksListQueryBuilder()
			.blockNumber(123) // equality numeric
			.order("desc")
			.limit(5)
			.build();

		expect(stripUndef(mapped)).toEqual(stripUndef(dsl.params));
	});

	it("parity: comparator on blockNumber and timestamp range", () => {
		const obj = {
			blockNumber: "gt:100",
			timestamp: ["gte:1700000000", "lte:1700000100"],
			order: "asc",
			limit: 25,
		} as any;

		const mapped = BlocksMapper.list(obj);

		const dsl = new BlocksListQueryBuilder().blockNumber().greaterThan(100).timestamp().greaterThanOrEqualTo(1700000000).timestamp().lessThanOrEqualTo(1700000100).order("asc").limit(25).build();

		expect(stripUndef(mapped)).toEqual(stripUndef(dsl.params));
	});

	it("parity: timestamp exact + comparator-as-string mixed", () => {
		const obj = {
			timestamp: ["1700000000.123456789", "lte:1700000100"],
		} as any;

		const mapped = BlocksMapper.list(obj);

		const dsl = new BlocksListQueryBuilder()
			.timestamp("1700000000.123456789")
			.timestamp("lte:1700000100") // comparator-as-string allowed
			.build();

		expect(stripUndef(mapped)).toEqual(stripUndef(dsl.params));
	});

	it("parity: equality blockNumber zero (edge case)", () => {
		const obj = { blockNumber: 0 } as any;

		const mapped = BlocksMapper.list(obj);

		const dsl = new BlocksListQueryBuilder().blockNumber(0).build();

		expect(stripUndef(mapped)).toEqual(stripUndef(dsl.params));
	});

	it("rejects the unsupported ne comparator for block.number", () => {
		expect(() => BlocksMapper.list({ blockNumber: "ne:1" } as any)).toThrow(ValidationError);
		expect(() => new BlocksListQueryBuilder().blockNumber("ne:1")).toThrow(ValidationError);
	});

	it("preserves repeated decimal/hex block filters and validates all occurrences", () => {
		const mapped = BlocksMapper.list({ blockNumber: ["0x0", "gte:0x10", "lte:100"] });
		const built = new BlocksListQueryBuilder().blockNumber(["0x0", "gte:0x10"]).blockNumber().lessThanOrEqualTo("100").build();
		expect(mapped).toEqual(built.params);
		expect(() => BlocksMapper.list({ blockNumber: ["1", "0x8000000000000000"] })).toThrow(ValidationError);
		expect(() => BlocksMapper.list({ blockNumber: Array.from({ length: 101 }, () => "1") })).toThrow(ValidationError);
	});
});
