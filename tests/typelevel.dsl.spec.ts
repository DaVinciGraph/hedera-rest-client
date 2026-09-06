// tests/typelevel.dsl.spec.ts
import { describe, it, expect } from "vitest";

// Contracts DSL
import {
	ContractLogsByContractQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractStateQueryBuilder,
} from "../src/dsl/contracts";
import { AccountCryptoAllowancesDSL, AccountsListQueryDSL, AccountTokensDSL } from "../src/dsl/accounts";

// Transactions DSL
import { TransactionByIdQueryBuilder, TransactionsListQueryBuilder } from "../src/dsl/transactions";

// Topics DSL
import { TopicMessageBySequenceQueryBuilder, TopicMessageByTimestampQueryBuilder, TopicMessagesListQueryBuilder } from "../src/dsl/topics";

// Blocks DSL
import { BlocksListQueryBuilder } from "../src/dsl/blocks";
import { NetworkNodesQueryBuilder, NetworkRegisteredNodesQueryBuilder } from "../src/dsl/network";

// Tokens DSL
import { TokenNftsListQueryBuilder, TokenOneQueryBuilder, TokensListQueryBuilder } from "../src/dsl/tokens";
import type {
	AccountsListQuery,
	AccountNftsOwnedQuery,
	ContractLogsByContractQuery,
	ContractLogsListQuery,
	ContractResultsByContractQuery,
	ContractResultsListQuery,
	AllIntegerFilter,
	ContractCallRequest,
	ContractResultByTransactionQuery,
	IntegerFilter,
	Order,
	TopicMessage,
	TopicMessageEncoding,
	TokenNftOneQuery,
	TopicMessageBySequenceQuery,
	TopicMessagesListQuery,
	TokenOneQuery,
	TokenType,
	TokensListQuery,
	TransactionByIdQuery,
	TransactionResultFilter,
	TransactionsListQuery,
	TransferTypeFilter,
} from "../src/types";

describe("Type-level DSL surfaces (compile-time)", () => {
	it("accepts every valid casing of order literals", () => {
		const orders: Order[] = ["asc", "desc", "ASC", "DESC", "DeSc"];
		new TransactionsListQueryBuilder().order("dEsC");

		if (false) {
			// @ts-expect-error - unsupported sort directions remain statically rejected
			const invalidOrder: Order = "sideways";
			void invalidOrder;
		}

		expect(orders).toHaveLength(5);
	});

	it("does not leak any through public query-builder output", () => {
		const params = new BlocksListQueryBuilder().build().params;
		if (false) {
			// @ts-expect-error - unknown query values must be narrowed before use
			params.unrecognized.deeplyNestedCall();
		}
		expect(params).toEqual({});
	});

	it("EqualComparator: ContractResultsByContract.blockHash() exposes only 'equalTo'", () => {
		const cmp = new ContractResultsByContractQueryBuilder().blockHash();

		// Allowed: eq
		cmp.equalTo("0x" + "aa".repeat(32));

		if (false) {
			// Disallowed at type level:
			// @ts-expect-error - 'notEqualTo' must not exist on EqualComparator
			cmp.notEqualTo("0x" + "bb".repeat(32));
			// @ts-expect-error - 'lessThan' must not exist
			cmp.lessThan("0x" + "cc".repeat(32));
			// @ts-expect-error - 'lessThanOrEqualTo' must not exist
			cmp.lessThanOrEqualTo("0x" + "dd".repeat(32));
			// @ts-expect-error - 'greaterThan' must not exist
			cmp.greaterThan("0x" + "ee".repeat(32));
			// @ts-expect-error - 'greaterThanOrEqualTo' must not exist
			cmp.greaterThanOrEqualTo("0x" + "ff".repeat(32));
		}

		expect(true).toBe(true);
	});

	it("EqualComparator: ContractResultsByContract.blockNumber() exposes only 'equalTo'", () => {
		const cmp = new ContractResultsByContractQueryBuilder().blockNumber();

		// Allowed
		cmp.equalTo(12345);

		if (false) {
			// Disallowed
			// @ts-expect-error
			cmp.notEqualTo(1);
			// @ts-expect-error
			cmp.lessThan(1);
			// @ts-expect-error
			cmp.lessThanOrEqualTo(1);
			// @ts-expect-error
			cmp.greaterThan(1);
			// @ts-expect-error
			cmp.greaterThanOrEqualTo(1);
		}

		expect(true).toBe(true);
	});

	it("EqualComparator: ContractLogsList.transactionHash() exposes only 'equalTo'", () => {
		const cmp = new ContractLogsListQueryBuilder().transactionHash();

		// Allowed
		cmp.equalTo("0x" + "ab".repeat(32));

		if (false) {
			// Disallowed
			// @ts-expect-error
			cmp.notEqualTo("0x" + "ab".repeat(32));
			// @ts-expect-error
			cmp.lessThan("0x" + "ab".repeat(32));
			// @ts-expect-error
			cmp.lessThanOrEqualTo("0x" + "ab".repeat(32));
			// @ts-expect-error
			cmp.greaterThan("0x" + "ab".repeat(32));
			// @ts-expect-error
			cmp.greaterThanOrEqualTo("0x" + "ab".repeat(32));
		}

		expect(true).toBe(true);
	});

	it("NoNeComparatorOps: ContractLogsList.index() forbids 'notEqualTo' but allows eq/gt/gte/lt/lte", () => {
		// Allowed
		new ContractLogsListQueryBuilder().index().equalTo(10);
		new ContractLogsListQueryBuilder().index().greaterThan(5);
		new ContractLogsListQueryBuilder().index().greaterThanOrEqualTo(6);
		new ContractLogsListQueryBuilder().index().lessThan(20);
		new ContractLogsListQueryBuilder().index().lessThanOrEqualTo(21);

		if (false) {
			const cmp = new ContractLogsListQueryBuilder().index();
			// @ts-expect-error
			cmp.notEqualTo(7);
		}

		expect(true).toBe(true);
	});

	it("AllComparatorOps: TokenNftsList.serialNumber() exposes every comparator", () => {
		const cmp = new TokenNftsListQueryBuilder().tokenId("0.0.2002").serialNumber();

		// Allowed
		cmp.equalTo(100);
		cmp.greaterThan(50);
		cmp.greaterThanOrEqualTo(51);
		cmp.lessThan(200);
		cmp.lessThanOrEqualTo(201);
		cmp.notEqualTo(123);

		expect(true).toBe(true);
	});

	it("EqualOrLessComparator: TokenOne.timestamp() exposes eq, lt, lte only", () => {
		const cmp = new TokenOneQueryBuilder().tokenId("0.0.3003").timestamp();

		// Allowed
		cmp.equalTo("1700.000001");
		cmp.lessThan("1700.000002");
		cmp.lessThanOrEqualTo("1700.000003");

		if (false) {
			// Disallowed
			// @ts-expect-error
			cmp.notEqualTo("1700.000001");
			// @ts-expect-error
			cmp.greaterThan("1700.000001");
			// @ts-expect-error
			cmp.greaterThanOrEqualTo("1700.000001");
		}

		expect(true).toBe(true);
	});

	it("NoNeComparatorOps: TopicMessagesList.sequenceNumber() forbids 'notEqualTo'", () => {
		const cmp = new TopicMessagesListQueryBuilder().topicId("0.0.5").sequenceNumber();

		// Allowed
		cmp.equalTo(1);
		cmp.greaterThan(3);
		cmp.greaterThanOrEqualTo(4);
		cmp.lessThan(5);
		cmp.lessThanOrEqualTo(6);

		if (false) {
			// @ts-expect-error - Mirror Node does not support ne for sequencenumber
			cmp.notEqualTo(2);
		}

		expect(true).toBe(true);
	});

	it("NoNeComparatorOps: contract log timestamps forbid 'notEqualTo'", () => {
		const globalTimestamp = new ContractLogsListQueryBuilder().timestamp();
		globalTimestamp.equalTo(1);
		globalTimestamp.greaterThan(2);
		globalTimestamp.greaterThanOrEqualTo(3);
		globalTimestamp.lessThan(4);
		globalTimestamp.lessThanOrEqualTo(5);

		const scopedTimestamp = new ContractLogsByContractQueryBuilder().idOrAddress("0.0.98").timestamp();
		scopedTimestamp.equalTo(1);

		if (false) {
			// @ts-expect-error - contract log timestamps do not support ne
			globalTimestamp.notEqualTo(1);
			// @ts-expect-error - scoped contract log timestamps do not support ne
			scopedTimestamp.notEqualTo(1);
		}

		expect(true).toBe(true);
	});

	it("NoNeComparatorOps: BlocksList.blockNumber() forbids 'notEqualTo'", () => {
		const cmp = new BlocksListQueryBuilder().blockNumber();

		cmp.equalTo(1);
		cmp.greaterThan(2);
		cmp.greaterThanOrEqualTo(3);
		cmp.lessThan(4);
		cmp.lessThanOrEqualTo(5);

		if (false) {
			// @ts-expect-error - Mirror Node does not support ne for block.number
			cmp.notEqualTo(6);
		}

		expect(true).toBe(true);
	});

	it("numeric-template filters reject unsupported direct comparators", () => {
		const signedInt64Max: IntegerFilter = "9223372036854775807";
		const noNeComparator: IntegerFilter = "gte:9223372036854775807";
		const allComparator: AllIntegerFilter = "ne:1";

		new BlocksListQueryBuilder().blockNumber(signedInt64Max);
		new TokenNftsListQueryBuilder().tokenId("0.0.10").serialNumber(allComparator);
		new TopicMessagesListQueryBuilder().topicId("0.0.5").sequenceNumber("lte:10");
		new NetworkNodesQueryBuilder().nodeId("eq:0");
		new NetworkRegisteredNodesQueryBuilder().registeredNodeId("gt:0");

		if (false) {
			// @ts-expect-error - block.number rejects ne
			new BlocksListQueryBuilder().blockNumber("ne:1");
			// @ts-expect-error - topic sequencenumber rejects ne
			new TopicMessagesListQueryBuilder().topicId("0.0.5").sequenceNumber("ne:1");
			// Broad Java range strings are checked for unsupported operators at runtime.
			new NetworkNodesQueryBuilder().nodeId("ne:1");
			// Broad Java range strings are checked for unsupported operators at runtime.
			new NetworkRegisteredNodesQueryBuilder().registeredNodeId("ne:1");
			// @ts-expect-error - contract-log index rejects ne
			new ContractLogsListQueryBuilder().timestamp(1).index("ne:1");
			// @ts-expect-error - eq-only result block.number rejects range comparators
			new ContractResultsByContractQueryBuilder().blockNumber("gt:1");
		}

		expect([signedInt64Max, noNeComparator, allComparator]).toHaveLength(3);
	});

	it("message-by-timestamp accepts numeric and response-derived timestamp inputs", () => {
		new TopicMessageByTimestampQueryBuilder().timestamp(0);
		new TopicMessageByTimestampQueryBuilder().timestamp("1700000000.123456789");
		const responseTimestamp: string = "1700000000.123456789";
		new TopicMessageByTimestampQueryBuilder().timestamp(responseTimestamp);

		expect(true).toBe(true);
	});

	it("topic-message encoding accepts every valid casing", () => {
		const encodings: TopicMessageEncoding[] = ["base64", "BASE64", "BaSe64", "utf8", "UTF8", "uTf8", "utf-8", "UTF-8", "uTf-8"];
		const query: TopicMessagesListQuery = { topicId: "0.0.5", encoding: "BaSe64" };
		const compactUtf8Query: TopicMessagesListQuery = { topicId: "0.0.5", encoding: "UtF8" };
		new TopicMessagesListQueryBuilder().topicId("0.0.5").encoding("uTf-8");
		new TopicMessagesListQueryBuilder().topicId("0.0.5").encoding("uTf8");

		if (false) {
			// @ts-expect-error - unsupported encodings are rejected statically
			const unsupportedQuery: TopicMessagesListQuery = { topicId: "0.0.5", encoding: "hex" };
			void unsupportedQuery;
		}

		expect([encodings, query, compactUtf8Query]).toHaveLength(3);
	});

	it("exact integer request fields preserve decimal-string precision without accepting arbitrary strings", () => {
		const topic: TopicMessageBySequenceQuery = { topicId: "0.0.5", sequenceNumber: "9223372036854775807" };
		const nft: TokenNftOneQuery = { tokenId: "0.0.10", serialNumber: "9223372036854775807" };
		const result: ContractResultByTransactionQuery = { transactionIdOrHash: "0.0.5-1-1", nonce: "2147483647" };
		const call: ContractCallRequest = { to: "0x1111111111111111111111111111111111111111", gas: "9223372036854775807" };

		if (false) {
			// @ts-expect-error - exact integer fields reject non-decimal string syntax
			const invalidTopic: TopicMessageBySequenceQuery = { topicId: "0.0.5", sequenceNumber: "1e2" };
			// @ts-expect-error - exact NFT serials reject arbitrary strings
			const invalidNft: TokenNftOneQuery = { tokenId: "0.0.10", serialNumber: "serial" };
			// @ts-expect-error - nonce is an int32 decimal value at runtime, not coercive numeric text
			const invalidNonce: ContractResultByTransactionQuery = { transactionIdOrHash: "0.0.5-1-1", nonce: "1e2" };
			// @ts-expect-error - contract-call int64 inputs reject coercive numeric strings
			const invalidCall: ContractCallRequest = { to: "0x1111111111111111111111111111111111111111", gas: "1e2" };
			void [invalidTopic, invalidNft, invalidNonce, invalidCall];
		}

		expect([topic, nft, result, call]).toHaveLength(4);
	});

	it("response int64 values compose directly into exact integer request fields", () => {
		if (false) {
			const message = {} as TopicMessage;
			new TopicMessageBySequenceQueryBuilder().topicId("0.0.5").sequenceNumber(message.sequence_number);
		}
		expect(true).toBe(true);
	});

	it("TokenOne direct timestamps compose with response-typed strings", () => {
		const responseTimestamp: string = "1700000000.000000001";
		const valid: TokenOneQuery = { tokenId: "0.0.10", timestamp: ["eq:1700000000", "lte:1700000000.000000001"] };
		const composed: TokenOneQuery = { tokenId: "0.0.10", timestamp: responseTimestamp };
		new TokenOneQueryBuilder().tokenId("0.0.10").timestamp("lt:1700000001");
		new TokenOneQueryBuilder().tokenId("0.0.10").timestamp(responseTimestamp);
		new TokenOneQueryBuilder().tokenId("0.0.10").timestamp([responseTimestamp, "lte:1700000001"]);

		expect([valid.tokenId, composed.timestamp]).toEqual(["0.0.10", responseTimestamp]);
	});

	it("token response and query types retain known values while accepting future values", () => {
		const canonicalResponseType: TokenType = "FUNGIBLE_COMMON";
		const canonicalQuery: TokensListQuery = { type: ["ALL", "NON_FUNGIBLE_UNIQUE"] };
		const lowercaseQuery: TokensListQuery = { type: ["all", "fungible_common", "non_fungible_unique"] };
		const futureQuery: TokensListQuery = { type: "FUTURE_TOKEN_TYPE" };
		const futureResponseType: TokenType = "PROVIDER_SPECIFIC_TYPE";
		new TokensListQueryBuilder().type("all").type("fungible_common");

		expect([canonicalResponseType, canonicalQuery.type, lowercaseQuery.type, futureQuery.type, futureResponseType]).toHaveLength(5);
	});

	it("AllComparatorOps: TransactionsList.accountId() allows 'notEqualTo' and all others", () => {
		const cmp = new TransactionsListQueryBuilder().accountId();

		// Allowed (just type-surface checks)
		cmp.equalTo("0.0.2");
		cmp.notEqualTo("0.0.3");
		cmp.greaterThan("0.0.4");
		cmp.greaterThanOrEqualTo("0.0.5");
		cmp.lessThan("0.0.6");
		cmp.lessThanOrEqualTo("0.0.7");

		expect(true).toBe(true);
	});

	it("TransactionById.nonce() accepts only numbers", () => {
		new TransactionByIdQueryBuilder().nonce(0);

		if (false) {
			// @ts-expect-error - nonce is an OpenAPI int32, not a numeric string
			new TransactionByIdQueryBuilder().nonce("1");
		}

		expect(true).toBe(true);
	});

	it("repeated boolean filters remain strongly typed in object and DSL forms", () => {
		const accounts: AccountsListQuery = { includeBalance: [true, false] };
		const transaction: TransactionByIdQuery = { transactionId: "0.0.2-1-1", scheduled: [false, true] };
		new AccountsListQueryDSL().includeBalance([true, false]).includeBalance(true);
		new TransactionByIdQueryBuilder().scheduled([false, true]).scheduled(false);

		if (false) {
			// @ts-expect-error - balance occurrences must be booleans
			const invalidAccounts: AccountsListQuery = { includeBalance: [true, "false"] };
			// @ts-expect-error - scheduled occurrences must be booleans
			const invalidTransaction: TransactionByIdQuery = { transactionId: "0.0.2-1-1", scheduled: [false, "true"] };
			// @ts-expect-error - DSL balance arrays must contain only booleans
			new AccountsListQueryDSL().includeBalance([true, "false"]);
			// @ts-expect-error - DSL scheduled arrays must contain only booleans
			new TransactionByIdQueryBuilder().scheduled([false, "true"]);
			void [invalidAccounts, invalidTransaction];
		}

		expect([accounts.includeBalance, transaction.scheduled]).toHaveLength(2);
	});

	it("transaction result and transfer types accept every valid casing", () => {
		const results: TransactionResultFilter[] = ["success", "fail", "SUCCESS", "FAIL", "SuCcEsS"];
		const transfers: TransferTypeFilter[] = ["credit", "debit", "CREDIT", "DEBIT", "CrEdIt"];
		const query: TransactionsListQuery = { result: "SuCcEsS", type: "DeBiT" };
		new TransactionsListQueryBuilder().result("FaIl").transferType("CrEdIt");

		if (false) {
			// @ts-expect-error - unsupported result values remain statically rejected
			const invalidResult: TransactionResultFilter = "unknown";
			// @ts-expect-error - unsupported transfer values remain statically rejected
			const invalidTransfer: TransferTypeFilter = "both";
			void [invalidResult, invalidTransfer];
		}

		expect([results, transfers, query]).toHaveLength(3);
	});

	it("NoNeComparatorOps: account relationship filters and contract state hide notEqualTo", () => {
		const crypto = new AccountCryptoAllowancesDSL().idOrAliasOrEvmAddress("0.0.2").spenderId();
		crypto.greaterThan("0.0.3");
		if (false) {
			// @ts-expect-error - the deployed endpoint rejects ne
			crypto.notEqualTo("0.0.3");
		}

		const token = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.2").tokenId();
		token.lessThanOrEqualTo("0.0.10");
		if (false) {
			// @ts-expect-error - the deployed endpoint rejects ne
			token.notEqualTo("0.0.10");
		}

		const stateTimestamp = new ContractStateQueryBuilder().idOrAddress("0.0.98").timestamp();
		stateTimestamp.greaterThan(1);
		if (false) {
			// @ts-expect-error - state timestamps do not support ne
			stateTimestamp.notEqualTo(1);
		}

		const stateSlot = new ContractStateQueryBuilder().idOrAddress("0.0.98").slot();
		stateSlot.greaterThan("0x01");
		if (false) {
			// @ts-expect-error - state slots do not support ne
			stateSlot.notEqualTo("0x01");
		}

		expect(true).toBe(true);
	});

	it("AllComparatorOps: token NFT account.id includes notEqualTo", () => {
		const account = new TokenNftsListQueryBuilder().tokenId("0.0.10").accountId();
		account.notEqualTo("0.0.2");
		expect(true).toBe(true);
	});

	it("object query unions encode documented parameter dependencies", () => {
		const validName: TokensListQuery = { name: "USD" };
		// @ts-expect-error - name is mutually exclusive with account.id/token.id
		const invalidName: TokensListQuery = { name: "USD", accountId: "0.0.2" };

		const validNft: AccountNftsOwnedQuery = { idOrAliasOrEvmAddress: "0.0.2", tokenId: "0.0.10", serialNumber: 1 };
		// @ts-expect-error - serialNumber requires tokenId
		const invalidNft: AccountNftsOwnedQuery = { idOrAliasOrEvmAddress: "0.0.2", serialNumber: 1 };

		const validScopedResult: ContractResultsByContractQuery = { idOrAddress: "0.0.98", blockNumber: 1, transactionIndex: 0 };
		// @ts-expect-error - transactionIndex requires a block selector
		const invalidScopedResult: ContractResultsByContractQuery = { idOrAddress: "0.0.98", transactionIndex: 0 };
		// @ts-expect-error - block hash and block number are mutually exclusive selectors
		const invalidScopedSelectors: ContractResultsByContractQuery = { idOrAddress: "0.0.98", blockHash: "aa".repeat(32), blockNumber: 1 };
		const validGlobalResult: ContractResultsListQuery = { blockHash: "aa".repeat(32), transactionIndex: 0 };
		// @ts-expect-error - transactionIndex requires a block selector
		const invalidGlobalResult: ContractResultsListQuery = { transactionIndex: 0 };
		// @ts-expect-error - block hash and block number are mutually exclusive selectors
		const invalidGlobalSelectors: ContractResultsListQuery = { blockHash: "aa".repeat(32), blockNumber: 1 };

		const validGlobalLog: ContractLogsListQuery = { topic0: "01", timestamp: "eq:1.0" };
		// @ts-expect-error - topics require timestamp
		const invalidGlobalLog: ContractLogsListQuery = { topic0: "01" };
		// @ts-expect-error - transaction.hash is a singleton filter
		const invalidRepeatedTransactionHash: ContractLogsListQuery = { transactionHash: ["aa".repeat(32)] };
		const validScopedLog: ContractLogsByContractQuery = { idOrAddress: "0.0.98", index: 1, timestamp: "eq:1.0" };
		// @ts-expect-error - index requires timestamp
		const invalidScopedLog: ContractLogsByContractQuery = { idOrAddress: "0.0.98", index: 1 };

		expect([
			validName,
			invalidName,
			validNft,
			invalidNft,
			validScopedResult,
			invalidScopedResult,
			invalidScopedSelectors,
			validGlobalResult,
			invalidGlobalResult,
			invalidGlobalSelectors,
			validGlobalLog,
			invalidGlobalLog,
			invalidRepeatedTransactionHash,
			validScopedLog,
			invalidScopedLog,
		]).toHaveLength(15);
	});
});
