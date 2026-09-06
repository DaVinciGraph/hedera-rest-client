import { describe, expect, it } from "vitest";

import { ValidationError } from "../src/core/errors";
import { AccountsListQueryDSL } from "../src/dsl/accounts";
import { BalancesListQueryBuilder } from "../src/dsl/balances";
import { BlocksListQueryBuilder } from "../src/dsl/blocks";
import { ContractLogsListQueryBuilder, ContractResultByTransactionQueryBuilder } from "../src/dsl/contracts";
import { NetworkNodesQueryBuilder, NetworkRegisteredNodesQueryBuilder } from "../src/dsl/network";
import { TokenBalancesQueryBuilder, TokenNftsListQueryBuilder, TokenOneQueryBuilder } from "../src/dsl/tokens";
import { TopicMessageByTimestampQueryBuilder, TopicMessagesListQueryBuilder } from "../src/dsl/topics";
import { AccountsMapper } from "../src/resources/accounts/mapper";
import { BalancesMapper } from "../src/resources/balances/mapper";
import { BlocksMapper } from "../src/resources/blocks/mapper";
import { ContractsMapper } from "../src/resources/contracts/mapper";
import { NetworkMapper } from "../src/resources/network/mapper";
import { TokensMapper } from "../src/resources/tokens/mapper";
import { TopicsMapper } from "../src/resources/topics/mapper";
import { TransactionsMapper } from "../src/resources/transactions/mapper";

const ID = "0.0.123";
const MAX_INT64 = "9223372036854775807";
const INT64_OVERFLOW = "9223372036854775808";

describe("integer filter validation parity", () => {
	it("rejects non-integer comparator suffixes in object and fluent forms", () => {
		expect(() => AccountsMapper.list({ accountBalance: "gte:abc" } as any)).toThrow(ValidationError);
		expect(() => new AccountsListQueryDSL().accountBalance().greaterThan("abc" as any)).toThrow(ValidationError);

		expect(() => BalancesMapper.list({ accountBalance: "lt:1.5" } as any)).toThrow(ValidationError);
		expect(() => new BalancesListQueryBuilder().accountBalance().lessThan("1.5" as any)).toThrow(ValidationError);

		expect(() => BlocksMapper.list({ blockNumber: "gte:lte:1" } as any)).toThrow(ValidationError);
		expect(() => new BlocksListQueryBuilder().blockNumber().greaterThanOrEqualTo("lte:1" as any)).toThrow(ValidationError);
	});

	it("enforces signed-int64 bounds for sequence, serial, and node identifiers", () => {
		expect(() => TopicsMapper.messagesList({ topicId: ID, sequenceNumber: MAX_INT64 })).not.toThrow();
		expect(() => TopicsMapper.messagesList({ topicId: ID, sequenceNumber: INT64_OVERFLOW })).toThrow(ValidationError);
		expect(() => new TopicMessagesListQueryBuilder().topicId(ID).sequenceNumber(0)).toThrow(ValidationError);

		expect(() => TokensMapper.nftsList({ tokenId: ID, serialNumber: 0 })).toThrow(ValidationError);
		expect(() => new TokenNftsListQueryBuilder().tokenId(ID).serialNumber(INT64_OVERFLOW)).toThrow(ValidationError);

		expect(() => NetworkMapper.nodes({ nodeId: MAX_INT64 })).not.toThrow();
		expect(() => NetworkMapper.nodes({ nodeId: INT64_OVERFLOW })).toThrow(ValidationError);
		expect(() => new NetworkNodesQueryBuilder().nodeId(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
		expect(() => new NetworkRegisteredNodesQueryBuilder().registeredNodeId(INT64_OVERFLOW)).toThrow(ValidationError);
	});

	it("enforces the documented index and int32 bounds", () => {
		expect(() => ContractsMapper.logsList({ timestamp: "1", index: "gte:2147483647" })).not.toThrow();
		expect(() => ContractsMapper.logsList({ timestamp: "1", index: "gte:2147483648" } as any)).toThrow(ValidationError);
		expect(() => new ContractLogsListQueryBuilder().index().greaterThan("abc" as any)).toThrow(ValidationError);

		expect(() => ContractsMapper.resultsList({ blockNumber: 1, transactionIndex: 0 })).not.toThrow();
		expect(() => ContractsMapper.resultsList({ blockNumber: 1, transactionIndex: 2_147_483_648 } as any)).toThrow(ValidationError);
	});
});

describe("nonce and timestamp representation boundaries", () => {
	it("accepts canonical decimal contract-result nonce strings but rejects coercive forms", () => {
		const valid = ContractsMapper.resultByTransaction({ transactionIdOrHash: `${ID}-1-1`, nonce: "100" });
		expect(valid.params.nonce).toBe(100);
		expect(() => ContractsMapper.resultByTransaction({ transactionIdOrHash: `${ID}-1-1`, nonce: "1e2" })).toThrow(ValidationError);
		expect(() => new ContractResultByTransactionQueryBuilder().transactionIdOrHash(`${ID}-1-1`).nonce(" 1")).toThrow(ValidationError);
	});

	it("keeps transaction-by-ID nonce number-only", () => {
		expect(() => TransactionsMapper.byId({ transactionId: `${ID}-1-1`, nonce: "1" } as any)).toThrow(ValidationError);
	});

	it("preserves exact timestamp zero and rejects fractional JavaScript numbers", () => {
		const tokenObject = TokensMapper.one({ tokenId: ID, timestamp: 0 });
		const tokenDsl = TokensMapper.one(new TokenOneQueryBuilder().tokenId(ID).timestamp(0).build());
		expect(tokenObject.params.timestamp).toBe(0);
		expect(tokenDsl).toEqual(tokenObject);

		const balancesObject = TokensMapper.balances({ tokenId: ID, timestamp: 0 });
		const balancesDsl = TokensMapper.balances(new TokenBalancesQueryBuilder().tokenId(ID).timestamp(0).build());
		expect(balancesObject.params.timestamp).toEqual([0]);
		expect(balancesDsl).toEqual(balancesObject);

		expect(() => new TokenOneQueryBuilder().tokenId(ID).timestamp(1.5)).toThrow(ValidationError);
		expect(() => new TokenBalancesQueryBuilder().tokenId(ID).timestamp().greaterThan("lte:1" as any)).toThrow(ValidationError);

		const topic = new TopicMessageByTimestampQueryBuilder().timestamp(0).build();
		expect(topic.timestamp).toBe("0");
		expect(TopicsMapper.messageByTimestamp(topic).ts).toBe("0");
		expect(TopicsMapper.messageByTimestamp({ timestamp: 0 }).ts).toBe("0");
		expect(() => new TopicMessageByTimestampQueryBuilder().timestamp(1.5)).toThrow(ValidationError);
		expect(() => TopicsMapper.messageByTimestamp({ timestamp: 1.5 } as any)).toThrow(ValidationError);
		expect(() => new TopicMessageByTimestampQueryBuilder().timestamp("gte:1" as any)).toThrow(ValidationError);
	});
});
