import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import {
	ContractActionsQueryBuilder,
	ContractLogsByContractQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractsListQueryBuilder,
	ContractStateQueryBuilder,
} from "../../src/dsl/contracts";
import { TopicMessagesListQueryBuilder } from "../../src/dsl/topics";
import { TransactionByIdQueryBuilder, TransactionsListQueryBuilder } from "../../src/dsl/transactions";
import { ContractsMapper } from "../../src/resources/contracts/mapper";
import { TopicsMapper } from "../../src/resources/topics/mapper";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";

const CONTRACT = "0.0.7";
const TOPIC = "0.0.8";
const TRANSACTION_ID = "0.0.9-1700000000-000000001";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;

describe("transaction repeated filters", () => {
	it("preserves one account ID as a scalar and accumulates multiple object/DSL values", () => {
		expect(TransactionsMapper.list({ accountId: ["0.0.1"] })).toEqual({ "account.id": "0.0.1" });
		expect(TransactionsMapper.list({ accountId: ["0.0.1", "gte:0.0.2"] })).toEqual({
			"account.id": ["0.0.1", "gte:0.0.2"],
		});

		const query = new TransactionsListQueryBuilder().accountId("0.0.1").accountId().greaterThanOrEqualTo("0.0.2").build();
		expect(query.accountId).toEqual(["0.0.1", "gte:0.0.2"]);
		expect(TransactionsMapper.list(query)["account.id"]).toEqual(query.accountId);
	});

	it("validates every account occurrence and enforces the 100-value cap", () => {
		expect(() => TransactionsMapper.list({ accountId: ["not-an-id", "0.0.1"] })).toThrow(ValidationError);
		expect(() => TransactionsMapper.list({ accountId: Array(101).fill("0.0.1") })).toThrow(ValidationError);
		expect(() => new TransactionsListQueryBuilder().accountId(Array(101).fill("0.0.1"))).toThrow(ValidationError);
	});

	it("validates every nonce occurrence before applying last-wins semantics", () => {
		const mapped = TransactionsMapper.byId({ transactionId: TRANSACTION_ID, nonce: [1, 4, 9] });
		expect(mapped.params).toEqual({ nonce: 9 });
		expect(mapped.cacheKey).toBe(`tx:${TRANSACTION_ID}:9:`);
		expect(() => TransactionsMapper.byId({ transactionId: TRANSACTION_ID, nonce: [-1, 9] })).toThrow(ValidationError);
		expect(() => TransactionsMapper.byId({ transactionId: TRANSACTION_ID, nonce: Array(101).fill(1) })).toThrow(ValidationError);

		const query = new TransactionByIdQueryBuilder().transactionId(TRANSACTION_ID).nonce(1).nonce(9).build();
		expect(query.nonce).toEqual([1, 9]);
		expect(TransactionsMapper.byId(query).params).toEqual({ nonce: 9 });
	});
});

describe("topic message repeated sequence numbers", () => {
	it("preserves scalar/array shape and accumulates DSL calls", () => {
		expect(TopicsMapper.messagesList({ topicId: TOPIC, sequenceNumber: [1] }).params.sequencenumber).toBe(1);
		expect(TopicsMapper.messagesList({ topicId: TOPIC, sequenceNumber: ["gte:2", "lte:9"] }).params.sequencenumber).toEqual([
			"gte:2",
			"lte:9",
		]);

		const query = new TopicMessagesListQueryBuilder().topicId(TOPIC).sequenceNumber(2).sequenceNumber().lessThanOrEqualTo(9).build();
		expect(query.sequenceNumber).toEqual([2, "lte:9"]);
		expect(TopicsMapper.messagesList(query).params.sequencenumber).toEqual(query.sequenceNumber);
	});

	it("validates all occurrences and caps them at 100", () => {
		expect(() => TopicsMapper.messagesList({ topicId: TOPIC, sequenceNumber: ["gte:not-an-int" as any, 2] })).toThrow(ValidationError);
		expect(() => TopicsMapper.messagesList({ topicId: TOPIC, sequenceNumber: Array(101).fill(1) })).toThrow(ValidationError);
		expect(() => new TopicMessagesListQueryBuilder().topicId(TOPIC).sequenceNumber(Array(101).fill(1))).toThrow(ValidationError);
	});
});

describe("contract repeated filters", () => {
	it("accumulates list contract IDs with scalar/array output and a 100-value cap", () => {
		expect(ContractsMapper.list({ contractId: ["0.0.1"] })).toEqual({ "contract.id": "0.0.1" });
		expect(ContractsMapper.list({ contractId: ["0.0.1", "gt:0.0.2"] })).toEqual({
			"contract.id": ["0.0.1", "gt:0.0.2"],
		});
		const query = new ContractsListQueryBuilder().contractId("0.0.1").contractId().greaterThan("0.0.2").build();
		expect(query.contractId).toEqual(["0.0.1", "gt:0.0.2"]);
		expect(() => ContractsMapper.list({ contractId: Array(101).fill("0.0.1") })).toThrow(ValidationError);
	});

	it("accumulates result sender and transaction-index filters", () => {
		const objectMapped = ContractsMapper.resultsList({
			from: ["0.0.1", "gte:0.0.2"],
			blockNumber: [1, "eq:2"],
			transactionIndex: [1, 2],
		});
		expect(objectMapped.from).toEqual(["0.0.1", "gte:0.0.2"]);
		expect(objectMapped["block.number"]).toBe("eq:2");
		expect(objectMapped["transaction.index"]).toEqual([1, 2]);

		const query = new ContractResultsListQueryBuilder()
			.from("0.0.1")
			.from().greaterThanOrEqualTo("0.0.2")
			.blockNumber(1)
			.blockNumber("eq:2")
			.transactionIndex(1)
			.transactionIndex(2)
			.build();
		expect(ContractsMapper.resultsList(query)).toEqual(objectMapped);
	});

	it("validates every last-wins block hash/number and enforces repeated caps", () => {
		expect(ContractsMapper.resultsList({ blockHash: [HASH_A, HASH_B] })["block.hash"]).toBe(HASH_B);
		expect(() => ContractsMapper.resultsList({ blockHash: ["bad", HASH_A] })).toThrow(ValidationError);
		expect(() => ContractsMapper.resultsList({ blockNumber: ["eq:not-a-number" as any, 1] })).toThrow(ValidationError);
		expect(() => ContractsMapper.resultsList({ blockNumber: ["0x8000000000000000", 1] })).toThrow(ValidationError);
		expect(() => ContractsMapper.resultsList({ blockHash: Array(101).fill(HASH_A) })).toThrow(ValidationError);
		expect(() => ContractsMapper.resultsList({ blockNumber: Array(101).fill(1) })).toThrow(ValidationError);
	});

	it("caps result sender and transaction-index occurrences at 100", () => {
		expect(() => ContractsMapper.resultsList({ from: Array(101).fill("0.0.1") })).toThrow(ValidationError);
		expect(() => ContractsMapper.resultsList({ blockNumber: 1, transactionIndex: Array(101).fill(1) })).toThrow(ValidationError);
	});

	it("enforces structured log-index bounds and timestamp coupling", () => {
		const mapped = ContractsMapper.logsList({ timestamp: ["gte:1", "lte:2"], index: ["gte:3", "lte:4"] });
		expect(mapped.index).toEqual(["gte:3", "lte:4"]);

		const query = new ContractLogsListQueryBuilder()
			.timestamp().greaterThanOrEqualTo(1)
			.timestamp().lessThanOrEqualTo(2)
			.index().greaterThanOrEqualTo(3)
			.index().lessThanOrEqualTo(4)
			.build();
		expect(ContractsMapper.logsList(query)).toEqual(mapped);

		expect(() => ContractsMapper.logsList({ timestamp: ["gte:1", "lte:2"], index: ["gt:1", "gte:2"] })).toThrow(ValidationError);
		expect(() => ContractsMapper.logsList({ timestamp: ["gte:1", "lte:2"], index: [1, "lte:2"] })).toThrow(ValidationError);
		expect(() => ContractsMapper.logsList({ timestamp: "gt:1", index: "gte:1" })).toThrow(ValidationError);
		expect(() => ContractsMapper.logsList({ timestamp: "gte:1", index: 1 })).toThrow(ValidationError);
		expect(() => ContractsMapper.logsList({ timestamp: ["gte:1", "gt:2"] })).toThrow(ValidationError);
	});

	it("treats an inclusive one-instant timestamp range as equality for an equality index", () => {
		const mapped = ContractsMapper.logsList({ timestamp: ["gte:1", "lte:1.000000000"], index: "eq:3" });
		expect(mapped).toEqual({ timestamp: ["gte:1", "lte:1.000000000"], index: "eq:3" });

		const globalQuery = new ContractLogsListQueryBuilder()
			.timestamp().greaterThanOrEqualTo("1")
			.timestamp().lessThanOrEqualTo("1.000000000")
			.index().equalTo(3)
			.build();
		expect(ContractsMapper.logsList(globalQuery)).toEqual(mapped);

		const scopedQuery = new ContractLogsByContractQueryBuilder()
			.idOrAddress(CONTRACT)
			.timestamp().greaterThanOrEqualTo("1")
			.timestamp().lessThanOrEqualTo("1.000000000")
			.index().equalTo(3)
			.build();
		expect(ContractsMapper.logsByContract(scopedQuery)).toEqual({ id: CONTRACT, params: mapped });
	});

	it("enforces nonempty and at-most-100 contract-log topic occurrences", () => {
		expect(() => ContractsMapper.logsList({ topic0: [], timestamp: "1" })).toThrow(ValidationError);
		expect(() => ContractsMapper.logsList({ topic0: Array(101).fill("01"), timestamp: "1" })).toThrow(ValidationError);
		expect(ContractsMapper.logsList({ topic0: Array(100).fill("01"), timestamp: "1" }).topic0).toHaveLength(100);

		expect(() => new ContractLogsListQueryBuilder().topic0()).toThrow(ValidationError);
		const globalBuilder = new ContractLogsListQueryBuilder().topic0(...Array(100).fill("01"));
		expect(() => globalBuilder.topic0("02")).toThrow(ValidationError);

		expect(() => new ContractLogsByContractQueryBuilder().topic1()).toThrow(ValidationError);
		const scopedBuilder = new ContractLogsByContractQueryBuilder().idOrAddress(CONTRACT).topic1(...Array(100).fill("01"));
		expect(() => scopedBuilder.topic1("02")).toThrow(ValidationError);
	});

	it("accumulates action indexes with int32 and 100-occurrence bounds", () => {
		const mapped = ContractsMapper.actionsByResult({ transactionIdOrHash: HASH_A, index: ["gte:1", "lte:3"] });
		expect(mapped.params.index).toEqual(["gte:1", "lte:3"]);
		const query = new ContractActionsQueryBuilder().transactionIdOrHash(HASH_A).index().greaterThanOrEqualTo(1).index().lessThanOrEqualTo(3).build();
		expect(ContractsMapper.actionsByResult(query)).toEqual(mapped);
		expect(() => ContractsMapper.actionsByResult({ transactionIdOrHash: HASH_A, index: "gte:2147483648" as any })).toThrow(ValidationError);
		expect(() => ContractsMapper.actionsByResult({ transactionIdOrHash: HASH_A, index: Array(101).fill(1) })).toThrow(ValidationError);
	});

	it("preserves state-slot scalar/array shape and caps slots at 100", () => {
		expect(ContractsMapper.stateQuery({ idOrAddress: CONTRACT, slot: ["01"] }).params.slot).toBe("01");
		expect(ContractsMapper.stateQuery({ idOrAddress: CONTRACT, slot: ["01", "gte:02"] }).params.slot).toEqual(["01", "gte:02"]);
		const query = new ContractStateQueryBuilder().idOrAddress(CONTRACT).slot("01").slot().greaterThanOrEqualTo("02").build();
		expect(query.slot).toEqual(["01", "gte:02"]);
		expect(() => ContractsMapper.stateQuery({ idOrAddress: CONTRACT, slot: Array(101).fill("01") })).toThrow(ValidationError);
		expect(() => new ContractStateQueryBuilder().idOrAddress(CONTRACT).slot("01", ...Array(100).fill("02"))).toThrow(ValidationError);
	});
});
