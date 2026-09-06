import { describe, expect, it } from "vitest";

import {
	AccountCryptoAllowancesDSL,
	AccountHookStorageDSL,
	AccountHooksDSL,
	AccountNftAllowancesDSL,
	AccountNftsOwnedDSL,
	AccountOutstandingAirdropsDSL,
	AccountPendingAirdropsDSL,
	AccountsListQueryDSL,
	AccountTokenAllowancesDSL,
	AccountTokensDSL,
	BalancesListQueryBuilder,
	BlocksListQueryBuilder,
	ContractActionsQueryBuilder,
	ContractLogsByContractQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractResultByTransactionQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractsListQueryBuilder,
	NetworkNodesQueryBuilder,
	NetworkRegisteredNodesQueryBuilder,
	SchedulesListQueryBuilder,
	TokenBalancesQueryBuilder,
	TokenNftsListQueryBuilder,
	TokensListQueryBuilder,
	TopicMessagesListQueryBuilder,
	TransactionByIdQueryBuilder,
	TransactionsListQueryBuilder,
} from "../src";

import type {
	AccountCryptoAllowancesQuery,
	AccountHookStorageQuery,
	AccountHooksQuery,
	AccountNftAllowancesQuery,
	AccountNftsOwnedQuery,
	AccountOneQuery,
	AccountOutstandingAirdropsQuery,
	AccountPendingAirdropsQuery,
	AccountRewardsQuery,
	AccountsListQuery,
	AccountTokenAllowancesQuery,
	AccountTokensQuery,
	BalancesListQuery,
	BlocksListQuery,
	ContractLogsByContractQuery,
	ContractLogsListQuery,
	ContractOneQuery,
	ContractResultActionsQuery,
	ContractResultByTransactionQuery,
	ContractResultsByContractQuery,
	ContractResultsListQuery,
	ContractStateQuery,
	NetworkFeesQuery,
	NetworkExchangeRateQuery,
	NetworkNodesQuery,
	NetworkRegisteredNodesQuery,
	NetworkSupplyQuery,
	SchedulesListQuery,
	TokenBalancesQuery,
	TokenNftTransactionsQuery,
	TokenNftsListQuery,
	TokenOneQuery,
	TokensListQuery,
	TopicMessagesListQuery,
	TransactionByIdQuery,
	TransactionsListQuery,
} from "../src";

describe("readonly query inputs", () => {
	it("accepts readonly arrays across every repeated object-query family", () => {
		const ids = ["0.0.2", "gte:0.0.3"] as const;
		const timestamps = ["gte:1700000000", "lt:1700000100.1"] as const;
		const integers = [1, "gte:2"] as const;
		const booleans = [false, true] as const;
		const topics = ["01", "0x02"] as const;

		const queries = [
			{ accountId: ids, accountBalance: integers, includeBalance: booleans } satisfies AccountsListQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", timestamp: timestamps } satisfies AccountOneQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", hookId: integers } satisfies AccountHooksQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", hookId: 1, key: topics, timestamp: timestamps } satisfies AccountHookStorageQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", spenderId: ids } satisfies AccountCryptoAllowancesQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", tokenId: ids, spenderId: ids } satisfies AccountTokenAllowancesQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", tokenId: ids, counterpartyId: ids } satisfies AccountNftAllowancesQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", tokenId: ids } satisfies AccountTokensQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", tokenId: ids, serialNumber: integers, spenderId: ids } satisfies AccountNftsOwnedQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", timestamp: timestamps } satisfies AccountRewardsQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", receiverId: ids, tokenId: ids, serialNumber: integers } satisfies AccountOutstandingAirdropsQuery,
			{ idOrAliasOrEvmAddress: "0.0.2", senderId: ids, tokenId: ids, serialNumber: integers } satisfies AccountPendingAirdropsQuery,
			{ accountId: ids, accountBalance: integers, timestamp: timestamps } satisfies BalancesListQuery,
			{ blockNumber: integers, timestamp: timestamps } satisfies BlocksListQuery,
			{ accountId: ids, scheduleId: ids } satisfies SchedulesListQuery,
			{ tokenId: ids, type: ["ALL", "FUNGIBLE_COMMON"] as const } satisfies TokensListQuery,
			{ tokenId: "0.0.5", timestamp: timestamps } satisfies TokenOneQuery,
			{ tokenId: "0.0.5", accountId: ids, accountBalance: integers, timestamp: timestamps } satisfies TokenBalancesQuery,
			{ tokenId: "0.0.5", accountId: ids, serialNumber: integers } satisfies TokenNftsListQuery,
			{ tokenId: "0.0.5", serialNumber: 1, timestamp: timestamps } satisfies TokenNftTransactionsQuery,
			{ topicId: "0.0.5", sequenceNumber: integers, timestamp: timestamps } satisfies TopicMessagesListQuery,
			{ accountId: ids, timestamp: timestamps } satisfies TransactionsListQuery,
			{ transactionId: "0.0.2-1-1", nonce: [0, 1] as const, scheduled: booleans } satisfies TransactionByIdQuery,
			{ timestamp: timestamps } satisfies NetworkSupplyQuery,
			{ timestamp: timestamps } satisfies NetworkFeesQuery,
			{ timestamp: timestamps } satisfies NetworkExchangeRateQuery,
			{ nodeId: integers } satisfies NetworkNodesQuery,
			{ registeredNodeId: integers } satisfies NetworkRegisteredNodesQuery,
			{ contractId: ids } satisfies import("../src").ContractsListQuery,
			{ idOrAddress: "0.0.5", timestamp: timestamps } satisfies ContractOneQuery,
			{ from: ids, timestamp: timestamps } satisfies ContractResultsListQuery,
			{ idOrAddress: "0.0.5", from: ids, timestamp: timestamps } satisfies ContractResultsByContractQuery,
			{ transactionIdOrHash: "0.0.2-1-1", nonce: [0, 1] as const } satisfies ContractResultByTransactionQuery,
			{ timestamp: timestamps, topic0: topics, index: integers } satisfies ContractLogsListQuery,
			{ idOrAddress: "0.0.5", timestamp: timestamps, topic0: topics, index: integers } satisfies ContractLogsByContractQuery,
			{ idOrAddress: "0.0.5", slot: topics, timestamp: timestamps } satisfies ContractStateQuery,
			{ transactionIdOrHash: "0.0.2-1-1", index: integers } satisfies ContractResultActionsQuery,
		];

		expect(queries).toHaveLength(37);
	});

	it("accepts readonly tuples in fluent DSL setters", () => {
		const ids = ["0.0.2", "gte:0.0.3"] as const;
		const exactIds = ["0.0.2", "0.0.3"] as const;
		const integers = [1, "gte:2"] as const;
		const exactIntegers = [1, 2] as const;
		const booleans = [false, true] as const;
		const timestamps = ["gte:1700000000", "lt:1700000100"] as const;
		const topics = ["01", "0x02"] as const;
		const hashes = [`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`] as const;

		if (false) {
			new AccountsListQueryDSL().accountId(ids).accountBalance(integers).includeBalance(booleans);
			new AccountHooksDSL().hookId(integers);
			new AccountHookStorageDSL().key(topics);
			new AccountCryptoAllowancesDSL().spenderId(ids);
			new AccountTokenAllowancesDSL().spenderId(ids).tokenId(ids);
			new AccountNftAllowancesDSL().counterpartyId(ids).tokenId(ids);
			new AccountTokensDSL().tokenId(ids);
			new AccountNftsOwnedDSL().spenderId(ids).tokenId(ids).serialNumber(integers);
			new AccountOutstandingAirdropsDSL().receiverId(ids).tokenId(ids).serialNumber(integers);
			new AccountPendingAirdropsDSL().senderId(ids).tokenId(ids).serialNumber(integers);
			new BalancesListQueryBuilder().accountId(ids).accountBalance(integers);
			new BlocksListQueryBuilder().blockNumber(integers);
			new SchedulesListQueryBuilder().accountId(exactIds).scheduleId(exactIds);
			new TokensListQueryBuilder().tokenId(ids).type(["ALL", "FUNGIBLE_COMMON"] as const);
			new TokenBalancesQueryBuilder().accountId(ids).accountBalance(integers);
			new TokenNftsListQueryBuilder().accountId(ids).serialNumber(integers);
			new TopicMessagesListQueryBuilder().sequenceNumber(integers);
			new TransactionsListQueryBuilder().accountId(ids);
			new TransactionByIdQueryBuilder().nonce(exactIntegers).scheduled(booleans);
			new ContractsListQueryBuilder().contractId(ids);
			new ContractResultsByContractQueryBuilder()
				.from(ids)
				.blockHash(hashes)
				.blockNumber(exactIntegers)
				.transactionIndex(exactIntegers);
			new ContractResultsListQueryBuilder()
				.from(ids)
				.blockHash(hashes)
				.blockNumber(exactIntegers)
				.transactionIndex(exactIntegers);
			new ContractResultByTransactionQueryBuilder().nonce(exactIntegers);
			new ContractLogsListQueryBuilder().timestamp(timestamps[0]).topic0(topics[0]).index(integers);
			new ContractLogsByContractQueryBuilder().timestamp(timestamps[0]).topic0(topics[0]).index(integers);
			new ContractActionsQueryBuilder().index(integers);
			new NetworkNodesQueryBuilder().nodeId(integers);
			new NetworkRegisteredNodesQueryBuilder().registeredNodeId(integers);
		}

		expect(true).toBe(true);
	});
});
