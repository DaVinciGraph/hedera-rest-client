import { describe, it, expect } from "vitest";

import { TransactionsMapper } from "../src/resources/transactions/mapper";
import { TopicsMapper } from "../src/resources/topics/mapper";
import { ContractsMapper } from "../src/resources/contracts/mapper";

import { TransactionsListQueryBuilder } from "../src/dsl/transactions";
import { TopicMessagesListQueryBuilder } from "../src/dsl/topics";
import { ContractResultsListQueryBuilder } from "../src/dsl/contracts";

import type { TransactionsListQuery, TopicMessagesListQuery, ContractResultsListQuery, Order } from "../src/types";

/* ------------------------------------------------------------------
   Deterministic RNG helpers (no external libs needed)
------------------------------------------------------------------- */
function mulberry32(seed: number) {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(0xc0ffee12);
const rand = () => rng();

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(rand() * arr.length)];
}
function chance(p = 0.5): boolean {
	return rand() < p;
}
function int(min: number, max: number): number {
	return Math.floor(rand() * (max - min + 1)) + min;
}

/* ------------------------------------------------------------------
   Generators for valid values that pass our validators
------------------------------------------------------------------- */
const ops = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;
const noNeOps = ["eq", "gt", "gte", "lt", "lte"] as const;
const orders: Order[] = ["asc", "desc"];

function entityId(): string {
	// 0.0.x (x >= 1)
	return `0.0.${int(1, 1_000_000)}`;
}

function comparatorAccountId(): string {
	return `${pick(ops)}:${entityId()}`;
}

function timestampFilterValue(): string | number {
	// Either a bare numeric timestamp or a comparator form
	if (chance(0.5)) return int(1_000, 10_000_000);
	return `${pick(ops)}:${int(1_000, 10_000_000)}`;
}

function noNeTimestampFilterValue(): string | number {
	if (chance(0.5)) return int(1_000, 10_000_000);
	return `${pick(noNeOps)}:${int(1_000, 10_000_000)}`;
}

function sequenceNumberValue(): string | number {
	if (chance(0.5)) return int(1, 2_000_000_000);
	return `${pick(noNeOps)}:${int(1, 2_000_000_000)}`;
}

function orderOrUndefined(): Order | undefined {
	return chance(0.5) ? pick(orders) : undefined;
}

function limitOrUndefined(): number | undefined {
	return chance(0.5) ? int(1, 1000) : undefined;
}

function evmHexBytes(nBytes: number, with0x = true): string {
	const hexChars = "0123456789abcdef";
	let hex = "";
	for (let i = 0; i < nBytes * 2; i++) {
		hex += hexChars[Math.floor(rand() * 16)];
	}
	return with0x ? "0x" + hex : hex;
}

/* ------------------------------------------------------------------
   Property-based parity: Transactions.list
------------------------------------------------------------------- */
describe("Property-based parity — TransactionsMapper.list vs TransactionsListQueryBuilder", () => {
	it("DSL vs object produce identical params across randomized inputs", () => {
		for (let i = 0; i < 80; i++) {
			// ----- Random legacy object
			const qObj: TransactionsListQuery = {};

			if (chance(0.7)) {
				qObj.accountId = chance(0.5) ? entityId() : comparatorAccountId();
			}

			if (chance(0.7)) {
				if (chance(0.6)) {
					qObj.timestamp = timestampFilterValue();
				} else {
					const n = int(1, 3);
					qObj.timestamp = Array.from({ length: n }, () => timestampFilterValue());
				}
			}

			if (chance(0.6)) {
				// TransactionTypes is permissive; mapper passes through any string.
				qObj.transactiontype = pick(["CRYPTOTRANSFER", "CONTRACTCALL", "CONTRACTCREATEINSTANCE", "CONSENSUSSUBMITMESSAGE"]);
			}

			if (chance(0.6)) qObj.result = pick(["success", "fail"] as const);
			if (chance(0.6)) qObj.type = pick(["credit", "debit"] as const);
			if (chance(0.6)) qObj.order = orderOrUndefined();
			if (chance(0.6)) qObj.limit = limitOrUndefined();

			const paramsObj = TransactionsMapper.list(qObj);

			// ----- DSL builder with equivalent settings
			const b = new TransactionsListQueryBuilder();
			if (qObj.accountId !== undefined) b.accountId(qObj.accountId);
			if (qObj.timestamp !== undefined) {
				if (Array.isArray(qObj.timestamp)) {
					qObj.timestamp.forEach((t) => b.timestamp(t as any));
				} else {
					b.timestamp(qObj.timestamp as any);
				}
			}
			if (qObj.transactiontype !== undefined) b.transactionType(qObj.transactiontype);
			if (qObj.result !== undefined) b.result(qObj.result);
			if (qObj.type !== undefined) b.transferType(qObj.type as any);
			if (qObj.order !== undefined) b.order(qObj.order);
			if (qObj.limit !== undefined) b.limit(qObj.limit);

			const paramsDsl = TransactionsMapper.list(b.build());

			expect(paramsDsl).toEqual(paramsObj);
		}
	});
});

/* ------------------------------------------------------------------
   Property-based parity: Topics.messagesList
------------------------------------------------------------------- */
describe("Property-based parity — TopicsMapper.messagesList vs TopicMessagesListQueryBuilder", () => {
	it("DSL vs object produce identical (id, params) across randomized inputs", () => {
		for (let i = 0; i < 80; i++) {
			// ----- Random legacy object
			const qObj: TopicMessagesListQuery = {
				topicId: entityId(),
			};

			if (chance(0.5)) qObj.encoding = pick(["base64", "utf8", "utf-8"] as const);

			if (chance(0.7)) {
				qObj.sequenceNumber = sequenceNumberValue();
			}

			if (chance(0.7)) {
				if (chance(0.6)) {
					qObj.timestamp = noNeTimestampFilterValue();
				} else {
					const n = int(1, 3);
					qObj.timestamp = Array.from({ length: n }, () => noNeTimestampFilterValue());
				}
			}

			if (chance(0.6)) qObj.order = orderOrUndefined();
			if (chance(0.6)) qObj.limit = limitOrUndefined();

			const mappedObj = TopicsMapper.messagesList(qObj);

			// ----- DSL builder with equivalent settings
			const b = new TopicMessagesListQueryBuilder().topicId(qObj.topicId);
			if (qObj.encoding !== undefined) b.encoding(qObj.encoding);
			if (qObj.sequenceNumber !== undefined) b.sequenceNumber(qObj.sequenceNumber as any);
			if (qObj.timestamp !== undefined) {
				if (Array.isArray(qObj.timestamp)) {
					qObj.timestamp.forEach((t) => b.timestamp(t as any));
				} else {
					b.timestamp(qObj.timestamp as any);
				}
			}
			if (qObj.order !== undefined) b.order(qObj.order);
			if (qObj.limit !== undefined) b.limit(qObj.limit);

			const mappedDsl = TopicsMapper.messagesList(b.build());

			expect(mappedDsl.id).toBe(mappedObj.id);
			expect(mappedDsl.params).toEqual(mappedObj.params);
		}
	});
});

/* ------------------------------------------------------------------
   Property-based parity: Contracts.resultsList
------------------------------------------------------------------- */
describe("Property-based parity — ContractsMapper.resultsList vs ContractResultsListQueryBuilder", () => {
	it("DSL vs object produce identical params across randomized inputs with constraints", () => {
		for (let i = 0; i < 80; i++) {
			const qObj: ContractResultsListQuery = {};

			if (chance(0.7)) {
				if (chance(0.6)) {
					qObj.timestamp = timestampFilterValue();
				} else {
					const n = int(1, 3);
					qObj.timestamp = Array.from({ length: n }, () => timestampFilterValue());
				}
			}

			if (chance(0.6)) {
				// Either AccountId or EVM address for 'from'
				qObj.from = chance(0.5) ? entityId() : evmHexBytes(20);
			}

			// block.hash and block.number are alternative selectors.
			const blockSelector = int(0, 2);
			if (blockSelector === 1) {
				const hex64 = evmHexBytes(32, chance(0.5)).toLowerCase();
				const hex96 = evmHexBytes(48, chance(0.5)).toLowerCase();
				if (chance(0.5)) qObj.blockHash = `eq:${hex64}`;
				else if (chance(0.5)) qObj.blockHash = hex64;
				else qObj.blockHash = chance(0.5) ? [`eq:${hex64}`, hex96] : [hex64, `eq:${hex96}`];
			}

			if (blockSelector === 2) {
				// blockNumber: number or eq:<number> or 0x-hex
				const asNumber = chance(0.5) ? int(1, 10_000_000) : `0x${int(1, 0xfffff).toString(16)}`;
				qObj.blockNumber = chance(0.5) ? asNumber : `eq:${typeof asNumber === "number" ? asNumber : asNumber}`;
			}

			if (chance(0.6)) qObj.internal = chance(0.5);
			if (chance(0.6)) qObj.hbar = chance(0.5);

			// transactionIndex: only when blockHash or blockNumber present (Mirror rule)
			const hasBlockSelector = qObj.blockHash !== undefined || qObj.blockNumber !== undefined;
			if (hasBlockSelector && chance(0.6)) {
				qObj.transactionIndex = int(0, 1000);
			}

			if (chance(0.6)) qObj.order = orderOrUndefined();
			if (chance(0.6)) qObj.limit = limitOrUndefined();

			const paramsObj = ContractsMapper.resultsList(qObj);

			// ----- DSL builder with equivalent settings
			const b = new ContractResultsListQueryBuilder();
			if (qObj.timestamp !== undefined) {
				(Array.isArray(qObj.timestamp) ? qObj.timestamp : [qObj.timestamp]).forEach((t) => b.timestamp(t as any));
			}
			if (qObj.from !== undefined) b.from(qObj.from);
			if (qObj.blockHash !== undefined) b.blockHash(qObj.blockHash as any);
			if (qObj.blockNumber !== undefined) b.blockNumber(qObj.blockNumber as any);
			if (qObj.internal !== undefined) b.internal(!!qObj.internal);
			if (qObj.hbar !== undefined) b.hbar(qObj.hbar);
			if (qObj.transactionIndex !== undefined) b.transactionIndex(Number(qObj.transactionIndex));
			if (qObj.order !== undefined) b.order(qObj.order);
			if (qObj.limit !== undefined) b.limit(qObj.limit);

			const paramsDsl = ContractsMapper.resultsList(b.build());

			expect(paramsDsl).toEqual(paramsObj);
		}
	});
});
