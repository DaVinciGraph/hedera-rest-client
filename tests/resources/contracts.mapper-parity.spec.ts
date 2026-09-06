import { describe, it, expect } from "vitest";
import { ContractsMapper } from "../../src/resources/contracts/mapper";
import {
	ContractsListQueryBuilder,
	ContractOneQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractResultByTransactionQueryBuilder,
	ContractResultByTimestampQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractLogsByContractQueryBuilder,
	ContractStateQueryBuilder,
	ContractCallRequestBuilder,
	ContractActionsQueryBuilder,
	ContractOpcodesQueryBuilder,
} from "../../src/dsl/contracts";
import { ValidationError } from "../../src/core/errors";
import { LosslessNumber, stringify as stringifyLosslessJson } from "lossless-json";

const HEX32 = "0x" + "ab".repeat(32); // 64 hex chars
const HEX48 = "0x" + "cd".repeat(48); // 96 hex chars
const EVM40 = "0x" + "ee".repeat(20); // 40 hex chars
const RAW_EVM40 = "ee".repeat(20); // contract.id accepts this unprefixed form
const ACCOUNT = "0.0.123";
const TX_HASH = "0x" + "aa".repeat(32);
const TX_ID = "0.0.123-1700000000-123456789";

const stripUndef = (o: Record<string, any>) => {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
	return out;
};

describe("Contracts identifier/filter boundaries", () => {
	it("accepts request shorthand and equality-only query addresses without normalizing them", () => {
		expect(ContractsMapper.list({ contractId: "0.13236" })).toEqual({ "contract.id": "0.13236" });
		expect(ContractsMapper.list({ contractId: `eq:${RAW_EVM40}` })).toEqual({ "contract.id": `eq:${RAW_EVM40}` });
		expect(ContractsMapper.list(new ContractsListQueryBuilder().contractId().greaterThan("13236").build())).toEqual({ "contract.id": "gt:13236" });

		expect(ContractsMapper.one({ idOrAddress: "13236" } as any).id).toBe("13236");
		expect(new ContractOneQueryBuilder().idOrAddress(`0.0.0x${RAW_EVM40}`).build().idOrAddress).toBe(`0.0.0x${RAW_EVM40}`);
	});

	it("rejects invalid comparator payloads and range comparisons over query addresses", () => {
		expect(() => ContractsMapper.list({ contractId: "gte:not-an-id" } as any)).toThrow(ValidationError);
		expect(() => new ContractsListQueryBuilder().contractId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => ContractsMapper.list({ contractId: `gt:${RAW_EVM40}` } as any)).toThrow(ValidationError);
		expect(() => new ContractsListQueryBuilder().contractId().greaterThan(RAW_EVM40)).toThrow(ValidationError);
	});

	it("supports validated comparator filters for contract-result senders", () => {
		expect(ContractsMapper.resultsList({ from: "gte:0.2" })).toMatchObject({ from: "gte:0.2" });
		const dsl = new ContractResultsListQueryBuilder().from().notEqualTo(EVM40).build();
		expect(ContractsMapper.resultsList(dsl)).toMatchObject({ from: `ne:${EVM40}` });
		expect(() => ContractsMapper.resultsList({ from: "lt:not-an-account" })).toThrow(ValidationError);
		expect(() => new ContractResultsByContractQueryBuilder().idOrAddress("13236").from("eq:not-an-account")).toThrow(ValidationError);
	});
});

describe("ContractsMapper — list()", () => {
	it("parity: no args", () => {
		const obj = undefined;
		const mapped = ContractsMapper.list(obj);

		const dsl = new ContractsListQueryBuilder().build();
		expect(mapped).toEqual({});
		expect(mapped).toEqual(stripUndef(dsl as any));
	});

	it("parity: contractId comparator, order, limit", () => {
		const obj = { contractId: "gt:0.0.100", order: "desc", limit: 5 } as any;
		const mapped = ContractsMapper.list(obj);

		const dsl = new ContractsListQueryBuilder().contractId().greaterThan("0.0.100").order("desc").limit(5).build();

		expect(mapped).toEqual(
			stripUndef({
				"contract.id": "gt:0.0.100",
				order: "desc",
				limit: 5,
			})
		);
		// Mapper maps to params; DSL returns query (not params), so we remap DSL too:
		const mappedFromDsl = ContractsMapper.list(dsl);
		expect(mappedFromDsl).toEqual(mapped);
	});

	it("accepts an unprefixed EVM address for contract.id and rejects a prefixed one", () => {
		expect(ContractsMapper.list({ contractId: RAW_EVM40 })).toEqual({ "contract.id": RAW_EVM40 });
		expect(ContractsMapper.list(new ContractsListQueryBuilder().contractId(RAW_EVM40).build())).toEqual({ "contract.id": RAW_EVM40 });

		expect(() => ContractsMapper.list({ contractId: EVM40 } as any)).toThrow(ValidationError);
		expect(() => new ContractsListQueryBuilder().contractId(EVM40)).toThrow(ValidationError);
	});
});

it("parity: idOrAddress with timestamp array (order-agnostic in cacheKey)", () => {
	const obj = { idOrAddress: ACCOUNT, timestamp: ["lte:1700000010", "gte:1700000000"], useCache: true } as any;
	const mapObj = ContractsMapper.one(obj);

	const dsl = new ContractOneQueryBuilder().idOrAddress(ACCOUNT).timestamp().greaterThanOrEqualTo(1700000000).timestamp().lessThanOrEqualTo(1700000010).useCache(true).build();
	const mapDsl = ContractsMapper.one(dsl);

	// id must match
	expect(mapDsl.id).toBe(mapObj.id);

	// cacheKey is order-agnostic; both should be equal
	expect(mapDsl.cacheKey).toBe(mapObj.cacheKey);

	// params.timestamp is not normalized by the mapper; compare ignoring order
	const tsObj = [...(mapObj.params.timestamp ?? [])].sort();
	const tsDsl = [...(mapDsl.params.timestamp ?? [])].sort();
	expect(tsDsl).toEqual(tsObj);
});

describe("ContractsMapper — resultsList()", () => {
	it("maps timestamps, from (account), blockHash (eq:), internal, and transaction index", () => {
		const obj = {
			timestamp: ["gte:1700000000", "lte:1700001000"],
			from: ACCOUNT,
			blockHash: "eq:" + HEX32,
			internal: true,
			hbar: false,
			transactionIndex: 3,
			order: "asc",
			limit: 10,
		} as any;
		const mapped = ContractsMapper.resultsList(obj);
		expect(mapped).toEqual({
			timestamp: ["gte:1700000000", "lte:1700001000"],
			from: ACCOUNT,
			"block.hash": "eq:" + HEX32,
			internal: true,
			hbar: false,
			"transaction.index": 3,
			order: "asc",
			limit: 10,
		});

		// DSL parity
		const dsl = new ContractResultsListQueryBuilder()
			.timestamp()
			.greaterThanOrEqualTo(1700000000)
			.timestamp()
			.lessThanOrEqualTo(1700001000)
			.from(ACCOUNT)
			.blockHash("eq:" + HEX32)
			.internal(true)
			.hbar(false)
			.transactionIndex(3)
			.order("asc")
			.limit(10)
			.build();
		const mapped2 = ContractsMapper.resultsList(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("maps an equality-only hexadecimal block number", () => {
		const query = new ContractResultsListQueryBuilder().blockNumber("eq:0x2a").transactionIndex(3).build();
		expect(ContractsMapper.resultsList(query)).toEqual({ "block.number": "eq:0x2a", "transaction.index": 3 });
	});

	it("accepts 'from' as EVM address", () => {
		const mapped = ContractsMapper.resultsList({ from: EVM40 } as any);
		expect(mapped.from).toBe(EVM40);
	});

	it("rejects invalid blockHash", () => {
		expect(() => ContractsMapper.resultsList({ blockHash: "eq:0x1234" } as any)).toThrow(ValidationError);
	});

	it("rejects invalid blockNumber", () => {
		expect(() => ContractsMapper.resultsList({ blockNumber: "eq:not-a-num" } as any)).toThrow(ValidationError);
	});

	it("rejects non-integer transactionIndex", () => {
		expect(() => ContractsMapper.resultsList({ transactionIndex: -1 } as any)).toThrow(ValidationError);
	});

	it("enforces transactionIndex requires a block filter in object and DSL forms", () => {
		expect(() => ContractsMapper.resultsList({ transactionIndex: 0 } as any)).toThrow(ValidationError);
		expect(() => new ContractResultsListQueryBuilder().transactionIndex(0).build()).toThrow(ValidationError);
	});

	it("rejects simultaneous block hash and block number selectors", () => {
		expect(() => ContractsMapper.resultsList({ blockHash: HEX32, blockNumber: 42 } as any)).toThrow(ValidationError);
		expect(() => new ContractResultsListQueryBuilder().blockHash(HEX32).blockNumber(42)).toThrow(ValidationError);
		expect(() => new ContractResultsListQueryBuilder().blockNumber(42).blockHash().equalTo(HEX32)).toThrow(ValidationError);
	});
});

describe("ContractsMapper — resultsByContract()", () => {
	it("parity: same fields as resultsList, plus id return", () => {
		const obj = {
			idOrAddress: ACCOUNT,
			timestamp: ["gte:1700000000", "lte:1700001000"],
			from: EVM40,
			blockHash: HEX48,
			internal: false,
			transactionIndex: 2,
			order: "desc",
			limit: 2,
		} as any;

		const mapped = ContractsMapper.resultsByContract(obj);
		expect(mapped.id).toBe(ACCOUNT);
		expect(mapped.params).toEqual({
			timestamp: ["gte:1700000000", "lte:1700001000"],
			from: EVM40,
			"block.hash": HEX48,
			internal: false,
			"transaction.index": 2,
			order: "desc",
			limit: 2,
		});

		// DSL parity
		const dsl = new ContractResultsByContractQueryBuilder()
			.idOrAddress(ACCOUNT)
			.timestamp()
			.greaterThanOrEqualTo(1700000000)
			.timestamp()
			.lessThanOrEqualTo(1700001000)
			.from(EVM40)
			.blockHash(HEX48)
			.internal(false)
			.transactionIndex(2)
			.order("desc")
			.limit(2)
			.build();

		const mapped2 = ContractsMapper.resultsByContract(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("maps a block-number selector for contract-scoped results", () => {
		const query = new ContractResultsByContractQueryBuilder().idOrAddress(ACCOUNT).blockNumber("eq:42").transactionIndex(2).build();
		expect(ContractsMapper.resultsByContract(query).params).toEqual({ "block.number": "eq:42", "transaction.index": 2 });
	});

	it("enforces transactionIndex requires blockHash or blockNumber", () => {
		expect(() =>
			ContractsMapper.resultsByContract({
				idOrAddress: ACCOUNT,
				transactionIndex: 1,
			} as any)
		).toThrow(ValidationError);
	});

	it("rejects simultaneous block hash and block number selectors", () => {
		expect(() => ContractsMapper.resultsByContract({ idOrAddress: ACCOUNT, blockHash: HEX32, blockNumber: 42 } as any)).toThrow(
			ValidationError
		);
		expect(() => new ContractResultsByContractQueryBuilder().idOrAddress(ACCOUNT).blockNumber(42).blockHash(HEX32)).toThrow(
			ValidationError
		);
	});
});

describe("ContractsMapper — resultByTransaction()", () => {
	it("accepts tx hash with nonce (number), builds cacheKey", () => {
		const obj = { transactionIdOrHash: TX_HASH, nonce: 3, hbar: false } as any;
		const mapped = ContractsMapper.resultByTransaction(obj);
		expect(mapped.id).toBe(TX_HASH);
		expect(mapped.params).toEqual({ nonce: 3, hbar: false });
		expect(mapped.cacheKey).toBe(`contractResult:${TX_HASH}:nonce=3:hbar=false`);

		// DSL parity
		const dsl = new ContractResultByTransactionQueryBuilder().transactionIdOrHash(TX_HASH).nonce(3).hbar(false).useCache(true).build();
		const mapped2 = ContractsMapper.resultByTransaction(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("uses the same cache key for omitted and explicit default hbar=true", () => {
		const omitted = ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_HASH });
		const explicitDefault = ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_HASH, hbar: true });

		expect(explicitDefault.params).toEqual({ hbar: true });
		expect(explicitDefault.cacheKey).toBe(omitted.cacheKey);
		expect(ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_HASH, hbar: false }).cacheKey).not.toBe(omitted.cacheKey);
	});

	it("accepts tx id string and last nonce when array given", () => {
		const obj = { transactionIdOrHash: TX_ID, nonce: [1, 2, 9] } as any;
		const mapped = ContractsMapper.resultByTransaction(obj);
		expect(mapped.params).toEqual({ nonce: 9 });
		expect(mapped.cacheKey).toBe(`contractResult:${TX_ID}:nonce=9`);
	});

	it("accumulates and caps nonce occurrences in the DSL", () => {
		const query = new ContractResultByTransactionQueryBuilder().transactionIdOrHash(TX_ID).nonce([1, 2]).nonce(9).build();
		expect(query.nonce).toEqual([1, 2, 9]);
		expect(ContractsMapper.resultByTransaction(query).params).toEqual({ nonce: 9 });
		expect(() => new ContractResultByTransactionQueryBuilder().transactionIdOrHash(TX_ID).nonce(Array(101).fill(1))).toThrow(
			ValidationError
		);
	});

	it("rejects invalid nonce", () => {
		expect(() => ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_HASH, nonce: -1 } as any)).toThrow(ValidationError);
	});

	it("enforces transaction-ID entity component and signed-int64 seconds bounds", () => {
		const largest = "1023.65535.274877906943-9223372036854775807-999999999";
		expect(ContractsMapper.resultByTransaction({ transactionIdOrHash: largest }).id).toBe(largest);
		expect(new ContractResultByTransactionQueryBuilder().transactionIdOrHash(largest).build().transactionIdOrHash).toBe(largest);

		for (const transactionId of [
			"1024.0.1-1700000000-1",
			"0.65536.1-1700000000-1",
			"0.0.274877906944-1700000000-1",
			"0.0.1-9223372036854775808-1",
		]) {
			expect(() => ContractsMapper.resultByTransaction({ transactionIdOrHash: transactionId })).toThrow(ValidationError);
			expect(() => ContractsMapper.actionsByResult({ transactionIdOrHash: transactionId })).toThrow(ValidationError);
			expect(() => ContractsMapper.opcodes({ transactionIdOrHash: transactionId })).toThrow(ValidationError);
			expect(() => new ContractActionsQueryBuilder().transactionIdOrHash(transactionId)).toThrow(ValidationError);
			expect(() => new ContractOpcodesQueryBuilder().transactionIdOrHash(transactionId)).toThrow(ValidationError);
		}
	});
});

describe("ContractsMapper — resultByTimestamp()", () => {
	it("parity: validates id and exact ts; returns {id, ts, params, cacheKey}", () => {
		const ts = "1700000000.123456789";
		const obj = { idOrAddress: EVM40, timestamp: ts, hbar: false, useCache: true } as any;
		const mapped = ContractsMapper.resultByTimestamp(obj);
		expect(mapped.id).toBe(EVM40);
		expect(mapped.ts).toBe(ts);
		expect(mapped.params).toEqual({ hbar: false });
		expect(mapped.cacheKey).toBe(`contractResultTs:${EVM40}:${ts}:hbar=false`);

		const dsl = new ContractResultByTimestampQueryBuilder().idOrAddress(EVM40).timestamp(ts).hbar(false).useCache(true).build();
		const mapped2 = ContractsMapper.resultByTimestamp(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("uses the same cache key for omitted and explicit default hbar=true", () => {
		const ts = "1700000000.123456789";
		const omitted = ContractsMapper.resultByTimestamp({ idOrAddress: EVM40, timestamp: ts });
		const explicitDefault = ContractsMapper.resultByTimestamp({ idOrAddress: EVM40, timestamp: ts, hbar: true });

		expect(explicitDefault.params).toEqual({ hbar: true });
		expect(explicitDefault.cacheKey).toBe(omitted.cacheKey);
		expect(ContractsMapper.resultByTimestamp({ idOrAddress: EVM40, timestamp: ts, hbar: false }).cacheKey).not.toBe(omitted.cacheKey);
	});
});

describe("ContractsMapper — logsList()", () => {
	it("parity: topics arrays, timestamp window present, index comparator, tx hash eq, limit/order", () => {
		const obj = {
			topic0: [HEX32, HEX32],
			topic1: [HEX32],
			timestamp: ["gte:1700000000", "lte:1700000500"], // < 7 days
			index: "gte:10",
			transactionHash: TX_HASH,
			limit: 2,
			order: "asc",
		} as any;

		const mapped = ContractsMapper.logsList(obj);
		expect(mapped).toEqual({
			topic0: [HEX32, HEX32],
			topic1: [HEX32],
			timestamp: ["gte:1700000000", "lte:1700000500"],
			index: "gte:10",
			"transaction.hash": TX_HASH,
			limit: 2,
			order: "asc",
		});

		const dsl = new ContractLogsListQueryBuilder()
			.topic0(HEX32, HEX32)
			.topic1(HEX32)
			.timestamp()
			.greaterThanOrEqualTo(1700000000)
			.timestamp()
			.lessThanOrEqualTo(1700000500)
			.index()
			.greaterThanOrEqualTo(10)
			.transactionHash(TX_HASH)
			.order("asc")
			.limit(2)
			.build();

		const mapped2 = ContractsMapper.logsList(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("enforces timestamp required when topics present", () => {
		expect(() => ContractsMapper.logsList({ topic0: [HEX32] } as any)).toThrow(ValidationError);
	});

	it("enforces 7-day window when topics present", () => {
		const tooWide = {
			topic0: [HEX32],
			timestamp: ["gte:1700000000", "lte:1700860000"], // ~9.95 days
		} as any;
		expect(() => ContractsMapper.logsList(tooWide)).toThrow(ValidationError);
	});

	it("enforces index requires timestamp", () => {
		expect(() => ContractsMapper.logsList({ index: 1 } as any)).toThrow(ValidationError);
	});

	it("accepts 1..64 topic hex digits with or without 0x", () => {
		const mapped = ContractsMapper.logsList({
			topic0: ["01", "0xabc"],
			timestamp: "1700000000.000000000",
		});
		expect(mapped.topic0).toEqual(["01", "0xabc"]);

		const dsl = new ContractLogsListQueryBuilder().topic0("01", "0xabc").timestamp("1700000000.000000000").build();
		expect(ContractsMapper.logsList(dsl)).toEqual(mapped);
	});

	it("rejects the unsupported ne index comparator", () => {
		expect(() => ContractsMapper.logsList({ index: "ne:1", timestamp: "1700000000.000000000" } as any)).toThrow(ValidationError);
		expect(() => new ContractLogsListQueryBuilder().timestamp("1700000000.000000000").index("ne:1")).toThrow(ValidationError);
	});

	it("rejects the unsupported ne timestamp comparator", () => {
		expect(() => ContractsMapper.logsList({ timestamp: "ne:1700000000" } as any)).toThrow(ValidationError);
		expect(() => new ContractLogsListQueryBuilder().timestamp("ne:1700000000" as any)).toThrow(ValidationError);
	});

	it("rejects repeated transaction-hash filters", () => {
		expect(() => ContractsMapper.logsList({ transactionHash: [TX_HASH, TX_HASH] } as any)).toThrow(ValidationError);
		expect(() => (new ContractLogsListQueryBuilder().transactionHash as any)([TX_HASH])).toThrow(ValidationError);
	});
});

describe("ContractsMapper — logsByContract()", () => {
	it("parity: maps shared log filters + adds id", () => {
		const obj = {
			idOrAddress: ACCOUNT,
			topic0: HEX32,
			timestamp: "1700000000.000000000",
			index: "eq:1",
			limit: 1,
			order: "desc",
		} as any;

		const mapped = ContractsMapper.logsByContract(obj);
		expect(mapped.id).toBe(ACCOUNT);
		expect(mapped.params).toEqual({
			topic0: [HEX32], // logsList normalizes to arrays for topics
			timestamp: ["1700000000.000000000"],
			index: "eq:1",
			limit: 1,
			order: "desc",
		});

		const dsl = new ContractLogsByContractQueryBuilder().idOrAddress(ACCOUNT).topic0(HEX32).timestamp("1700000000.000000000").index().equalTo(1).order("desc").limit(1).build();
		const mapped2 = ContractsMapper.logsByContract(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("accumulates repeated scoped topic filters", () => {
		const dsl = new ContractLogsByContractQueryBuilder()
			.idOrAddress(ACCOUNT)
			.topic0("01")
			.topic0("0x02", "03")
			.timestamp("1700000000.000000000")
			.build();

		expect(ContractsMapper.logsByContract(dsl).params.topic0).toEqual(["01", "0x02", "03"]);
	});

	it("rejects the unsupported ne timestamp comparator", () => {
		expect(() => ContractsMapper.logsByContract({ idOrAddress: ACCOUNT, timestamp: "ne:1700000000" } as any)).toThrow(ValidationError);
		expect(() => new ContractLogsByContractQueryBuilder().idOrAddress(ACCOUNT).timestamp("ne:1700000000" as any)).toThrow(ValidationError);
	});

	it("rejects the global-only transaction.hash filter on the scoped route", () => {
		expect(() => ContractsMapper.logsByContract({ idOrAddress: ACCOUNT, transactionHash: TX_HASH } as any)).toThrow(ValidationError);
	});
});

describe("ContractsMapper — stateQuery()", () => {
	it("parity: slot hex list, timestamps, limit/order", () => {
		const obj = {
			idOrAddress: EVM40,
			slot: ["0x01", "0xabcdef"],
			timestamp: ["gte:1700000000", "lte:1700000010"],
			limit: 3,
			order: "asc",
		} as any;

		const mapped = ContractsMapper.stateQuery(obj);
		expect(mapped.id).toBe(EVM40);
		expect(mapped.params).toEqual({
			slot: ["0x01", "0xabcdef"],
			timestamp: ["gte:1700000000", "lte:1700000010"],
			limit: 3,
			order: "asc",
		});

		const dsl = new ContractStateQueryBuilder()
			.idOrAddress(EVM40)
			.slot("0x01", "0xabcdef")
			.timestamp()
			.greaterThanOrEqualTo(1700000000)
			.timestamp()
			.lessThanOrEqualTo(1700000010)
			.limit(3)
			.order("asc")
			.build();
		const mapped2 = ContractsMapper.stateQuery(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("rejects non-hex slot", () => {
		expect(() => ContractsMapper.stateQuery({ idOrAddress: ACCOUNT, slot: "zzzz" } as any)).toThrow(ValidationError);
	});

	it("supports slot comparators except ne and rejects ne timestamps", () => {
		const obj = ContractsMapper.stateQuery({
			idOrAddress: ACCOUNT,
			slot: ["gte:0x01", "lt:ff"],
			timestamp: "gte:1700000000",
		});
		expect(obj.params).toEqual({ slot: ["gte:0x01", "lt:ff"], timestamp: ["gte:1700000000"] });

		const dsl = new ContractStateQueryBuilder()
			.idOrAddress(ACCOUNT)
			.slot()
			.greaterThanOrEqualTo("0x01")
			.slot()
			.lessThan("ff")
			.timestamp()
			.greaterThanOrEqualTo(1700000000)
			.build();
		expect(ContractsMapper.stateQuery(dsl)).toEqual(obj);

		expect(() => ContractsMapper.stateQuery({ idOrAddress: ACCOUNT, slot: "ne:01" } as any)).toThrow(ValidationError);
		expect(() => ContractsMapper.stateQuery({ idOrAddress: ACCOUNT, timestamp: "ne:1700000000" } as any)).toThrow(ValidationError);
		expect(() => new ContractStateQueryBuilder().idOrAddress(ACCOUNT).timestamp("ne:1700000000" as any)).toThrow(ValidationError);
	});
});

describe("ContractsMapper — callQuery()", () => {
	it("parity: cleans/validates body", () => {
		const obj = {
			to: EVM40,
			from: EVM40,
			data: "0x1234",
			block: "latest",
			estimate: false,
			gas: 21000,
			gasPrice: "1000000000",
			value: "1",
		} as any;

		const cleanedObj = ContractsMapper.callQuery(obj);
		expect(cleanedObj).toEqual({
			to: EVM40,
			from: EVM40,
			data: "0x1234",
			block: "latest",
			estimate: false,
			gas: 21000,
			gasPrice: 1000000000,
			value: 1,
		});

		// DSL parity (builder defers validation of hex/data/gas/value to mapper)
		const dsl = new ContractCallRequestBuilder().to(EVM40).from(EVM40).data("0x1234").block("latest").estimate(false).gas(21000).gasPrice(1000000000).value("1").build();
		const cleanedDsl = ContractsMapper.callQuery(dsl);
		expect(cleanedDsl).toEqual(cleanedObj);
	});

	it("requires 'to'", () => {
		expect(() => ContractsMapper.callQuery({} as any)).toThrow(ValidationError);
	});

	it("rejects odd-length data", () => {
		expect(() => ContractsMapper.callQuery({ to: EVM40, data: "0x123" } as any)).toThrow(ValidationError);
	});

	it("estimate=true requires block=latest (or omitted)", () => {
		expect(() => ContractsMapper.callQuery({ to: EVM40, estimate: true, block: "0x10" } as any)).toThrow(ValidationError);
	});

	it("serializes unsafe int64 inputs as exact JSON numbers", () => {
		const maxInt64 = "9223372036854775807";
		const mapped = ContractsMapper.callQuery({ to: EVM40, gas: maxInt64, gasPrice: maxInt64, value: maxInt64 });
		expect(mapped.gas).toBeInstanceOf(LosslessNumber);
		expect(mapped.gas.toString()).toBe(maxInt64);
		expect(mapped.gasPrice).toBeInstanceOf(LosslessNumber);
		expect(mapped.gasPrice.toString()).toBe(maxInt64);
		expect(mapped.value).toBeInstanceOf(LosslessNumber);
		expect(mapped.value.toString()).toBe(maxInt64);
		expect(stringifyLosslessJson(mapped)).toBe(
			`{"to":"${EVM40}","gas":${maxInt64},"gasPrice":${maxInt64},"value":${maxInt64}}`
		);

		const dsl = new ContractCallRequestBuilder().to(EVM40).gas(maxInt64).gasPrice(maxInt64).value(maxInt64).build();
		const mappedDsl = ContractsMapper.callQuery(dsl);
		expect(stringifyLosslessJson(mappedDsl)).toBe(stringifyLosslessJson(mapped));

		expect(() => ContractsMapper.callQuery({ to: EVM40, gas: Number.MAX_SAFE_INTEGER + 1 } as any)).toThrow(ValidationError);
	});
});

describe("ContractsMapper — actionsByResult()", () => {
	it("parity: index comparator, limit, order", () => {
		const obj = { transactionIdOrHash: TX_HASH, index: "gte:5", limit: 2, order: "desc" } as any;
		const mapped = ContractsMapper.actionsByResult(obj);
		expect(mapped).toEqual({
			id: TX_HASH,
			params: { index: "gte:5", limit: 2, order: "desc" },
		});

		const dsl = new ContractActionsQueryBuilder().transactionIdOrHash(TX_HASH).index().greaterThanOrEqualTo(5).limit(2).order("desc").build();
		const mapped2 = ContractsMapper.actionsByResult(dsl);
		expect(mapped2).toEqual(mapped);
	});

	it("rejects the unsupported ne index comparator", () => {
		expect(() => ContractsMapper.actionsByResult({ transactionIdOrHash: TX_HASH, index: "ne:1" } as any)).toThrow(ValidationError);
		expect(() => new ContractActionsQueryBuilder().transactionIdOrHash(TX_HASH).index("ne:1")).toThrow(ValidationError);
	});
});

describe("ContractsMapper — opcodes()", () => {
	it("parity: stack/memory/storage flags", () => {
		const obj = { transactionIdOrHash: TX_ID, stack: true, memory: false, storage: true } as any;
		const mapped = ContractsMapper.opcodes(obj);
		expect(mapped).toEqual({
			id: TX_ID,
			params: { stack: true, memory: false, storage: true },
		});

		const dsl = new ContractOpcodesQueryBuilder().transactionIdOrHash(TX_ID).stack(true).memory(false).storage(true).build();
		const mapped2 = ContractsMapper.opcodes(dsl);
		expect(mapped2).toEqual(mapped);
	});
});
