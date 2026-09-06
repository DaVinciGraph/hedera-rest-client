import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountsListQueryDSL } from "../../src/dsl/accounts";
import { BalancesListQueryBuilder } from "../../src/dsl/balances";
import { BlocksListQueryBuilder } from "../../src/dsl/blocks";
import { ContractsListQueryBuilder } from "../../src/dsl/contracts";
import { NetworkNodesQueryBuilder, NetworkRegisteredNodesQueryBuilder } from "../../src/dsl/network";
import { SchedulesListQueryBuilder } from "../../src/dsl/schedules";
import { TokensListQueryBuilder } from "../../src/dsl/tokens";
import { TopicMessagesListQueryBuilder } from "../../src/dsl/topics";
import { TransactionsListQueryBuilder } from "../../src/dsl/transactions";

describe("repeated-filter DSL arrays", () => {
	it("rejects an explicitly empty array even after an earlier value", () => {
		const invocations = [
			() => new AccountsListQueryDSL().accountId("0.0.1").accountId([]),
			() => new BalancesListQueryBuilder().accountId("0.0.1").accountId([]),
			() => new BlocksListQueryBuilder().blockNumber(1).blockNumber([]),
			() => new ContractsListQueryBuilder().contractId("0.0.1").contractId([]),
			() => new NetworkNodesQueryBuilder().nodeId(1).nodeId([]),
			() => new NetworkRegisteredNodesQueryBuilder().registeredNodeId(1).registeredNodeId([]),
			() => new SchedulesListQueryBuilder().accountId("0.0.1").accountId([]),
			() => new TokensListQueryBuilder().tokenId("0.0.1").tokenId([]),
			() => new TopicMessagesListQueryBuilder().sequenceNumber(1).sequenceNumber([]),
			() => new TransactionsListQueryBuilder().accountId("0.0.1").accountId([]),
		];

		for (const invoke of invocations) expect(invoke).toThrow(ValidationError);
	});
});
