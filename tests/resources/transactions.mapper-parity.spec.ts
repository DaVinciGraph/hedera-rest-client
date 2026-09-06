import { describe, it, expect } from "vitest";

import { TransactionsMapper } from "../../src/resources/transactions/mapper";
import { TransactionByIdQueryBuilder, TransactionsListQueryBuilder } from "../../src/dsl/transactions";
import { ValidationError } from "../../src/core/errors";

// Simple helper: make array w/out caring about order
const asArr = (v: any) => (Array.isArray(v) ? v.slice() : v);

describe("TransactionsMapper — parity (object vs DSL)", () => {
	const TXID = "0.0.100-1700000000-000000123";

	it("list: empty → {}", () => {
		const obj = undefined;
		const paramsObj = TransactionsMapper.list(obj);

		const dsl = new TransactionsListQueryBuilder();
		const paramsDsl = TransactionsMapper.list(dsl.build());

		expect(paramsObj).toEqual({});
		expect(paramsDsl).toEqual({});
	});

	it("list: accountId comparator + timestamp range + transactiontype + result + type + order/limit", () => {
		const obj = {
			accountId: "gte:0.0.500",
			timestamp: ["gte:1700000000", "lte:1700001000"],
			transactiontype: "CRYPTOTRANSFER",
			result: "success",
			type: "credit",
			order: "desc",
			limit: 50,
		} as const;
		//@ts-ignore
		const paramsObj = TransactionsMapper.list(obj);

		const dsl = new TransactionsListQueryBuilder()
			.accountId()
			.greaterThanOrEqualTo("0.0.500")
			.timestamp()
			.greaterThanOrEqualTo("1700000000")
			.timestamp()
			.lessThanOrEqualTo("1700001000")
			.transactionType("CRYPTOTRANSFER")
			.result("success")
			.transferType("credit")
			.order("desc")
			.limit(50);

		const paramsDsl = TransactionsMapper.list(dsl.build());

		// Same content
		expect(asArr(paramsDsl.timestamp)).toEqual(asArr(paramsObj.timestamp));
		expect(paramsDsl).toEqual(paramsObj);
	});

	it("list: accountId eq + single timestamp exact + result 'fail' + type 'debit'", () => {
		const obj = {
			accountId: "0.0.111",
			timestamp: "1700000000.000000123",
			transactiontype: "CONSENSUSSUBMITMESSAGE",
			result: "fail",
			type: "debit",
			order: "asc",
			limit: 13,
		} as const;
		const paramsObj = TransactionsMapper.list(obj);

		const dsl = new TransactionsListQueryBuilder()
			.accountId("0.0.111")
			.timestamp("1700000000.000000123")
			.transactionType("CONSENSUSSUBMITMESSAGE")
			.result("fail")
			.transferType("debit")
			.order("asc")
			.limit(13);

		const paramsDsl = TransactionsMapper.list(dsl.build());
		expect(paramsDsl).toEqual(paramsObj);
	});

	it("list: invalid result throws (object + DSL->mapper)", () => {
		const badObj = { result: "maybe" } as any;
		expect(() => TransactionsMapper.list(badObj)).toThrow(ValidationError);

		const badDsl = new TransactionsListQueryBuilder();
		// Builder types prevent this statically; runtime callers are rejected early.
		expect(() => (badDsl as any).result("maybe")).toThrow(ValidationError);
	});

	it("list: invalid transfer type throws (object + DSL->mapper)", () => {
		const badObj = { type: "both" } as any;
		expect(() => TransactionsMapper.list(badObj)).toThrow(ValidationError);

		const badDsl = new TransactionsListQueryBuilder();
		expect(() => (badDsl as any).transferType("both")).toThrow(ValidationError);
	});

	it("list: accepts case-insensitive result/type values and preserves their casing", () => {
		expect(TransactionsMapper.list({ result: "SUCCESS", type: "DEBIT" })).toEqual({ result: "SUCCESS", type: "DEBIT" });
		expect(TransactionsMapper.list({ result: "SuCcEsS", type: "CrEdIt" } as any)).toEqual({
			result: "SuCcEsS",
			type: "CrEdIt",
		});

		const mixedCase = new TransactionsListQueryBuilder();
		(mixedCase as any).result("SuCcEsS").transferType("CrEdIt");
		expect(TransactionsMapper.list(mixedCase.build())).toEqual({ result: "SuCcEsS", type: "CrEdIt" });
	});

	it("list: rejects non-string result/type values without coercion", () => {
		expect(() => TransactionsMapper.list({ result: true } as any)).toThrow(ValidationError);
		expect(() => TransactionsMapper.list({ type: 1 } as any)).toThrow(ValidationError);
		expect(() => (new TransactionsListQueryBuilder() as any).result(true)).toThrow(ValidationError);
		expect(() => (new TransactionsListQueryBuilder() as any).transferType(1)).toThrow(ValidationError);
	});

	it("list: invalid comparator string for accountId throws (object + DSL)", () => {
		const badObj = { accountId: "bogus:0.0.1" } as any;
		expect(() => TransactionsMapper.list(badObj)).toThrow(ValidationError);

		// direct-string form
		const badDsl1 = new TransactionsListQueryBuilder();
		expect(() => badDsl1.accountId("bogus:0.0.1")).toThrow(ValidationError);

		// comparator-API form (if .as is available in your comparator impl):
		// const badDsl2 = new TransactionsListQueryBuilder().accountId().as("bogus" as any, "0.0.1");
		// expect(() => TransactionsMapper.list(badDsl2.build())).toThrow(ValidationError);
	});

	it("byId: token by transactionId with no nonce/scheduled", () => {
		const obj = { transactionId: TXID } as const;
		const mapObj = TransactionsMapper.byId(obj);

		const dsl = new TransactionByIdQueryBuilder().transactionId(TXID);
		const mapDsl = TransactionsMapper.byId(dsl.build());

		expect(mapObj.id).toBe(TXID);
		expect(mapObj.params).toEqual({});
		expect(mapObj.cacheKey).toBe(`tx:${TXID}::`);
		expect(mapDsl).toEqual(mapObj);
	});

	it("byId: with nonce and scheduled true", () => {
		const obj = { transactionId: TXID, nonce: 2, scheduled: true } as const;
		const mapObj = TransactionsMapper.byId(obj);

		const dsl = new TransactionByIdQueryBuilder().transactionId(TXID).nonce(2).scheduled(true);
		const mapDsl = TransactionsMapper.byId(dsl.build());

		expect(mapObj.id).toBe(TXID);
		expect(mapObj.params).toEqual({ nonce: 2, scheduled: true });
		expect(mapObj.cacheKey).toBe(`tx:${TXID}:2:true`);
		expect(mapDsl).toEqual(mapObj);
	});

	it("byId: preserves repeated scheduled flags and keys the cache by the final effective value", () => {
		const objectMapped = TransactionsMapper.byId({ transactionId: TXID, scheduled: [true, false, true] });
		const dslQuery = new TransactionByIdQueryBuilder()
			.transactionId(TXID)
			.scheduled([true, false])
			.scheduled(true)
			.build();
		const dslMapped = TransactionsMapper.byId(dslQuery);
		const singletonMapped = TransactionsMapper.byId({ transactionId: TXID, scheduled: true });

		expect(objectMapped.params).toEqual({ scheduled: [true, false, true] });
		expect(dslMapped).toEqual(objectMapped);
		expect(objectMapped.cacheKey).toBe(`tx:${TXID}::true`);
		expect(objectMapped.cacheKey).toBe(singletonMapped.cacheKey);
	});

	it("byId: validates every scheduled occurrence and enforces its 1..100 cardinality", () => {
		expect(() => TransactionsMapper.byId({ transactionId: TXID, scheduled: [] })).toThrow(ValidationError);
		expect(() => TransactionsMapper.byId({ transactionId: TXID, scheduled: [true, "false"] } as any)).toThrow(ValidationError);
		expect(() => TransactionsMapper.byId({ transactionId: TXID, scheduled: Array(101).fill(true) })).toThrow(ValidationError);
		expect(() => new TransactionByIdQueryBuilder().scheduled([])).toThrow(ValidationError);
		expect(() => new TransactionByIdQueryBuilder().scheduled([true, "false"] as any)).toThrow(ValidationError);
		expect(() => new TransactionByIdQueryBuilder().scheduled(Array(101).fill(true))).toThrow(ValidationError);
	});

	it("byId: invalid transactionId throws (object + DSL)", () => {
		const obj = { transactionId: "not-a-txid" } as any;
		expect(() => TransactionsMapper.byId(obj)).toThrow(ValidationError);

		const dsl = new TransactionByIdQueryBuilder();
		expect(() => dsl.transactionId("not-a-txid")).toThrow(ValidationError);
	});

	it("byId: enforces entity component and signed-int64 seconds bounds", () => {
		const largest = "1023.65535.274877906943-9223372036854775807-999999999";
		expect(TransactionsMapper.byId({ transactionId: largest }).id).toBe(largest);
		expect(new TransactionByIdQueryBuilder().transactionId(largest).build().transactionId).toBe(largest);

		for (const transactionId of [
			"1024.0.1-1700000000-1",
			"0.65536.1-1700000000-1",
			"0.0.274877906944-1700000000-1",
			"0.0.1-9223372036854775808-1",
		]) {
			expect(() => TransactionsMapper.byId({ transactionId })).toThrow(ValidationError);
			expect(() => new TransactionByIdQueryBuilder().transactionId(transactionId)).toThrow(ValidationError);
		}
	});

	it("byId: invalid nonce throws (object + DSL)", () => {
		const obj = { transactionId: TXID, nonce: "abc" } as any;
		expect(() => TransactionsMapper.byId(obj)).toThrow(ValidationError);

		const dsl = new TransactionByIdQueryBuilder().transactionId(TXID);
		expect(() => dsl.nonce("abc" as any)).toThrow(ValidationError);
		expect(() => dsl.nonce(0x80000000)).toThrow(ValidationError);
	});
});

describe("Transactions account identifier boundaries", () => {
	const evm = `0x${"b".repeat(40)}`;

	it("accepts shorthand and comparator-prefixed EVM account filters", () => {
		for (const value of ["2", "0.2", "gte:0.2", `ne:${evm}`]) {
			expect(TransactionsMapper.list({ accountId: value })).toEqual({ "account.id": value });
			expect(TransactionsMapper.list(new TransactionsListQueryBuilder().accountId(value).build())).toEqual({ "account.id": value });
		}
	});

	it("rejects malformed direct and fluent comparator payloads", () => {
		expect(() => TransactionsMapper.list({ accountId: "gte:not-an-id" })).toThrow(ValidationError);
		expect(() => new TransactionsListQueryBuilder().accountId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new TransactionsListQueryBuilder().accountId().greaterThan("not-an-id")).toThrow(ValidationError);
	});
});
