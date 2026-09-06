// tests/dsl/core.comparators.spec.ts
import { describe, it, expect } from "vitest";

// Use real DSL builders that wrap createComparator()
import { TopicMessagesListQueryBuilder } from "../../src/dsl/topics";
import { TokenNftsListQueryBuilder, TokenOneQueryBuilder } from "../../src/dsl/tokens";
import { BlocksListQueryBuilder } from "../../src/dsl/blocks";
import { ContractResultsListQueryBuilder } from "../../src/dsl/contracts";
import { TokensMapper } from "../../src/resources/tokens/mapper";
import { ValidationError } from "../../src/core/errors";

describe("DSL core comparators — exercised via real DSL builders", () => {
	it("AllComparatorOps exposes and accepts eq, ne, gt, gte, lt, and lte", () => {
		const b = new TokenNftsListQueryBuilder().tokenId("0.0.1001");
		const cmp: any = b.serialNumber();

		// Methods present
		expect(typeof cmp.equalTo).toBe("function");
		expect(typeof cmp.notEqualTo).toBe("function");
		expect(typeof cmp.greaterThan).toBe("function");
		expect(typeof cmp.greaterThanOrEqualTo).toBe("function");
		expect(typeof cmp.lessThan).toBe("function");
		expect(typeof cmp.lessThanOrEqualTo).toBe("function");

		// Returns builder context for chaining
		const ret = cmp.notEqualTo(1700);
		expect(ret).toBe(b);
		expect(b.build().serialNumber).toBe("ne:1700");
	});

	it("NoNeComparatorOps rejects notEqualTo immediately through an unsafe cast", () => {
		const b = new BlocksListQueryBuilder();
		const cmp: any = b.blockNumber();

		// Allowed ops are present (runtime surface) and callable
		expect(typeof cmp.equalTo).toBe("function");
		expect(typeof cmp.greaterThan).toBe("function");
		expect(typeof cmp.greaterThanOrEqualTo).toBe("function");
		expect(typeof cmp.lessThan).toBe("function");
		expect(typeof cmp.lessThanOrEqualTo).toBe("function");

		expect(typeof cmp.notEqualTo).toBe("function");
		expect(() => cmp.notEqualTo(5)).toThrow(ValidationError);
		expect(b.build().params).toEqual({});

		cmp.lessThanOrEqualTo(100);
		expect(b.build().params["block.number"]).toBe("lte:100");
	});

	it("EqualOrLessComparator rejects gt and ne immediately through an unsafe cast", () => {
		const b = new TokenOneQueryBuilder().tokenId("0.0.3003");
		const cmp: any = b.timestamp();

		// Allowed methods (runtime)
		expect(typeof cmp.equalTo).toBe("function");
		expect(typeof cmp.lessThan).toBe("function");
		expect(typeof cmp.lessThanOrEqualTo).toBe("function");

		expect(() => cmp.greaterThan("1700.000001")).toThrow(ValidationError);
		expect(() => cmp.notEqualTo("1700.000001")).toThrow(ValidationError);
		expect(b.build().timestamp).toBeUndefined();

		cmp.equalTo("1700.000001");
		const builtEq = b.build();
		const mappedEq = TokensMapper.one(builtEq);
		expect(mappedEq.params.timestamp).toBe("eq:1700.000001");
	});

	it("EqualComparator rejects non-equality methods immediately through an unsafe cast", () => {
		const b = new ContractResultsListQueryBuilder();
		const cmp: any = b.blockHash();

		expect(() => cmp.lessThan("abc")).toThrow(ValidationError);
		expect(() => cmp.notEqualTo("abc")).toThrow(ValidationError);
		expect(b.build().blockHash).toBeUndefined();

		expect(() => cmp.equalTo("abc")).toThrow(ValidationError);
		expect(b.build().blockHash).toBeUndefined();
		const hash = "ab".repeat(32);
		expect(cmp.equalTo(hash)).toBe(b);
		expect(b.build().blockHash).toBe(`eq:${hash}`);
	});

	it("Re-invoking a comparator appends values when the REST field is repeatable", () => {
		const b = new TokenNftsListQueryBuilder().tokenId("0.0.4004");

		// First comparator
		b.serialNumber().greaterThan(10);
		expect(b.build().serialNumber).toBe("gt:10");

		// Append another comparator on the same field
		b.serialNumber().lessThanOrEqualTo(5);
		expect(b.build().serialNumber).toEqual(["gt:10", "lte:5"]);
	});

	it("Chaining via NoNeComparatorOps appends multiple timestamp filters (array)", () => {
		let b = new TopicMessagesListQueryBuilder().topicId("0.0.5005");

		// First comparator form
		b = b.timestamp().greaterThanOrEqualTo(1000);
		// Add exact value too
		b = b.timestamp("1001.000000001");
		// Add another comparator
		b = b.timestamp().lessThan(2000);

		const built = b.build();
		expect(built.timestamp).toEqual(["gte:1000", "1001.000000001", "lt:2000"]);
	});

	it("Unknown ops are not present on comparator objects", () => {
		const b = new TopicMessagesListQueryBuilder().topicId("0.0.6006");
		const cmp: any = b.timestamp();
		expect(cmp.bogus).toBeUndefined();
	});
});
