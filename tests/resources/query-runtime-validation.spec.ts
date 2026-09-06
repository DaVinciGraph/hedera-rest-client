import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountsMapper } from "../../src/resources/accounts/mapper";
import { BalancesMapper } from "../../src/resources/balances/mapper";
import { BlocksMapper } from "../../src/resources/blocks/mapper";
import { ContractsMapper } from "../../src/resources/contracts/mapper";
import { NetworkMapper } from "../../src/resources/network/mapper";
import { SchedulesMapper } from "../../src/resources/schedules/mapper";
import { TokensMapper } from "../../src/resources/tokens/mapper";
import { TopicsMapper } from "../../src/resources/topics/mapper";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";
import { AccountOneQueryDSL, AccountNftAllowancesDSL } from "../../src/dsl/accounts";
import { BlocksListQueryBuilder, BlocksOneQueryBuilder } from "../../src/dsl/blocks";
import { ContractCallRequestBuilder, ContractOpcodesQueryBuilder, ContractResultsListQueryBuilder } from "../../src/dsl/contracts";
import { NetworkFeeEstimateRequestBuilder, NetworkStakeQueryBuilder } from "../../src/dsl/network";
import { TokenOneQueryBuilder } from "../../src/dsl/tokens";

const ID = "0.0.123";
const TX_ID = `${ID}-1700000000-000000001`;

describe("public request objects reject unknown fields", () => {
	const cases: Array<[string, () => unknown]> = [
		["accounts list", () => AccountsMapper.list({ typo: true } as any)],
		["account", () => AccountsMapper.one({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["account hooks", () => AccountsMapper.hooks({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["account hook storage", () => AccountsMapper.hookStorage({ idOrAliasOrEvmAddress: ID, hookId: 1, typo: true } as any)],
		["crypto allowances", () => AccountsMapper.cryptoAllowances({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["token allowances", () => AccountsMapper.tokenAllowances({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["NFT allowances", () => AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["account tokens", () => AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["account NFTs", () => AccountsMapper.accountNftsOwned({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["account rewards", () => AccountsMapper.rewards({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["outstanding airdrops", () => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["pending airdrops", () => AccountsMapper.pendingAirdrops({ idOrAliasOrEvmAddress: ID, typo: true } as any)],
		["balances", () => BalancesMapper.list({ typo: true } as any)],
		["blocks list", () => BlocksMapper.list({ typo: true } as any)],
		["block", () => BlocksMapper.one({ hashOrNumber: 1, typo: true } as any)],
		["schedules list", () => SchedulesMapper.list({ typo: true } as any)],
		["schedule", () => SchedulesMapper.one({ scheduleId: ID, typo: true } as any)],
		["tokens list", () => TokensMapper.list({ typo: true } as any)],
		["token", () => TokensMapper.one({ tokenId: ID, typo: true } as any)],
		["token balances", () => TokensMapper.balances({ tokenId: ID, typo: true } as any)],
		["token NFTs", () => TokensMapper.nftsList({ tokenId: ID, typo: true } as any)],
		["NFT", () => TokensMapper.nftOne({ tokenId: ID, serialNumber: 1, typo: true } as any)],
		["NFT transactions", () => TokensMapper.nftTx({ tokenId: ID, serialNumber: 1, typo: true } as any)],
		["topic", () => TopicsMapper.topicOne({ topicId: ID, typo: true } as any)],
		["topic messages", () => TopicsMapper.messagesList({ topicId: ID, typo: true } as any)],
		["topic message by sequence", () => TopicsMapper.messageBySequence({ topicId: ID, sequenceNumber: 1, typo: true } as any)],
		["topic message by timestamp", () => TopicsMapper.messageByTimestamp({ timestamp: "1700000000.1", typo: true } as any)],
		["transactions list", () => TransactionsMapper.list({ typo: true } as any)],
		["transaction", () => TransactionsMapper.byId({ transactionId: TX_ID, typo: true } as any)],
		["network supply", () => NetworkMapper.supply({ typo: true } as any)],
		["network fees", () => NetworkMapper.fees({ typo: true } as any)],
		["network exchange rate", () => NetworkMapper.exchangeRate({ typo: true } as any)],
		["network nodes", () => NetworkMapper.nodes({ typo: true } as any)],
		["network fee estimate", () => NetworkMapper.estimateFees({ transaction: new Uint8Array(), typo: true } as any)],
		["registered nodes", () => NetworkMapper.registeredNodes({ typo: true } as any)],
		["network stake", () => NetworkMapper.stake({ typo: true } as any)],
		["contracts list", () => ContractsMapper.list({ typo: true } as any)],
		["contract", () => ContractsMapper.one({ idOrAddress: ID, typo: true } as any)],
		["contract results", () => ContractsMapper.resultsList({ typo: true } as any)],
		["contract results by contract", () => ContractsMapper.resultsByContract({ idOrAddress: ID, typo: true } as any)],
		["contract result by transaction", () => ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_ID, typo: true } as any)],
		["contract result by timestamp", () => ContractsMapper.resultByTimestamp({ idOrAddress: ID, timestamp: "1700000000.1", typo: true } as any)],
		["contract logs", () => ContractsMapper.logsList({ typo: true } as any)],
		["contract logs by contract", () => ContractsMapper.logsByContract({ idOrAddress: ID, typo: true } as any)],
		["contract state", () => ContractsMapper.stateQuery({ idOrAddress: ID, typo: true } as any)],
		["contract call", () => ContractsMapper.callQuery({ data: "0x00", typo: true } as any)],
		["contract actions", () => ContractsMapper.actionsByResult({ transactionIdOrHash: TX_ID, typo: true } as any)],
		["contract state changes", () => ContractsMapper.stateChangesByResult({ transactionIdOrHash: TX_ID, typo: true } as any)],
		["contract opcodes", () => ContractsMapper.opcodes({ transactionIdOrHash: TX_ID, typo: true } as any)],
	];

	it.each(cases)("rejects an unknown key at the %s boundary", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
		expect(invoke).toThrow(/Unknown .* field: typo/);
	});

	it("reports representative misspellings instead of silently issuing different requests", () => {
		expect(() => TokensMapper.one({ tokenID: ID } as any)).toThrow(/Unknown token query field: tokenID/);
		expect(() => NetworkMapper.supply({ timestmp: "1700000000.1" } as any)).toThrow(/Unknown network supply query field: timestmp/);
	});

	it("requires plain records and rejects symbol keys", () => {
		expect(() => AccountsMapper.list(new Date() as any)).toThrow(/plain object/);

		const symbolQuery = Object.create(null) as Record<PropertyKey, unknown>;
		Object.defineProperty(symbolQuery, Symbol("typo"), { value: true });
		expect(() => AccountsMapper.list(symbolQuery as any)).toThrow(/Unknown accounts list query field: Symbol\(typo\)/);
	});
});

describe("narrow runtime fields are validated without truthiness coercion", () => {
	it.each([
		["account", () => AccountsMapper.one({ idOrAliasOrEvmAddress: ID, useCache: "false" } as any)],
		["block", () => BlocksMapper.one({ hashOrNumber: 1, useCache: "false" } as any)],
		["schedule", () => SchedulesMapper.one({ scheduleId: ID, useCache: "false" } as any)],
		["token", () => TokensMapper.one({ tokenId: ID, useCache: "false" } as any)],
		["NFT", () => TokensMapper.nftOne({ tokenId: ID, serialNumber: 1, useCache: "false" } as any)],
		["topic", () => TopicsMapper.topicOne({ topicId: ID, useCache: "false" } as any)],
		["topic sequence", () => TopicsMapper.messageBySequence({ topicId: ID, sequenceNumber: 1, useCache: "false" } as any)],
		["topic timestamp", () => TopicsMapper.messageByTimestamp({ timestamp: "1700000000.1", useCache: "false" } as any)],
		["transaction", () => TransactionsMapper.byId({ transactionId: TX_ID, useCache: "false" } as any)],
		["network supply", () => NetworkMapper.supply({ useCache: "false" } as any)],
		["network exchange rate", () => NetworkMapper.exchangeRate({ useCache: "false" } as any)],
		["network stake", () => NetworkMapper.stake({ useCache: "false" } as any)],
		["contract", () => ContractsMapper.one({ idOrAddress: ID, useCache: "false" } as any)],
		["contract result", () => ContractsMapper.resultByTransaction({ transactionIdOrHash: TX_ID, useCache: "false" } as any)],
		["contract result timestamp", () => ContractsMapper.resultByTimestamp({ idOrAddress: ID, timestamp: "1700000000.1", useCache: "false" } as any)],
	] as Array<[string, () => unknown]>)("rejects string useCache for %s", (_name, invoke) => {
		expect(invoke).toThrow(/useCache must be a boolean/);
	});

	it("rejects malformed allowance, contract, and string-typed fields", () => {
		expect(() => AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: ID, view: "viewer" } as any)).toThrow(/view/);
		expect(() => AccountsMapper.one({ idOrAliasOrEvmAddress: ID, transactions: 1 } as any)).toThrow(/transactions must be a boolean/);
		expect(() => AccountsMapper.one({ idOrAliasOrEvmAddress: ID, transactiontype: 0 } as any)).toThrow(/transactiontype must be a string/);
		expect(() => AccountsMapper.list({ accountPublicKey: 0 } as any)).toThrow(/accountPublicKey must be a string/);
		expect(() => ContractsMapper.resultsList({ internal: "false" } as any)).toThrow(/internal must be a boolean/);
		expect(() => ContractsMapper.resultsList({ hbar: "true" } as any)).toThrow(/hbar must be a boolean/);
		expect(() => ContractsMapper.callQuery({ data: "0x00", to: `0x${"1".repeat(40)}`, estimate: 1 } as any)).toThrow(/estimate must be a boolean/);
		expect(() => ContractsMapper.opcodes({ transactionIdOrHash: TX_ID, stack: "false" } as any)).toThrow(/stack must be a boolean/);
	});

	it("keeps the required contract-call destination non-nullable", () => {
		expect(() => ContractsMapper.callQuery({ to: null } as any)).toThrow(/'to' is required/);
	});

	it("preserves every nullable contract-call field accepted by the OpenAPI schema", () => {
		const to = `0x${"1".repeat(40)}`;
		expect(
			ContractsMapper.callQuery({
				to,
				from: null,
				data: null,
				block: null,
				estimate: null,
				gas: null,
				gasPrice: null,
				value: null,
			})
		).toEqual({ to, from: null, data: null, block: null, estimate: null, gas: null, gasPrice: null, value: null });
		expect(
			new ContractCallRequestBuilder()
				.to(to)
				.from(null)
				.data(null)
				.block(null)
				.estimate(null)
				.gas(null)
				.gasPrice(null)
				.value(null)
				.build()
		).toEqual({ to, from: null, data: null, block: null, estimate: null, gas: null, gasPrice: null, value: null });
	});

	it("rejects explicit null instead of defaulting the fee-estimate content type", () => {
		expect(() => NetworkMapper.estimateFees({ transaction: new Uint8Array([1]), contentType: null } as any)).toThrow(/content type/);
	});

	it("validates dynamic DSL calls immediately", () => {
		expect(() => new AccountOneQueryDSL().includeTransactions("false" as any)).toThrow(/transactions must be a boolean/);
		expect(() => new AccountOneQueryDSL().useCache("false" as any)).toThrow(/useCache must be a boolean/);
		expect(() => new AccountNftAllowancesDSL().view("viewer" as any)).toThrow(/view/);
		expect(() => new BlocksListQueryBuilder().order("sideways" as any)).toThrow(/order/);
		expect(() => new BlocksOneQueryBuilder().useCache("false" as any)).toThrow(/useCache must be a boolean/);
		expect(() => new ContractResultsListQueryBuilder().internal("false" as any)).toThrow(/internal must be a boolean/);
		expect(() => new ContractCallRequestBuilder().estimate(1 as any)).toThrow(/estimate must be a boolean/);
		expect(() => new ContractOpcodesQueryBuilder().stack("false" as any)).toThrow(/stack must be a boolean/);
		expect(() => new NetworkStakeQueryBuilder().useCache("false" as any)).toThrow(/useCache must be a boolean/);
		expect(() => new TokenOneQueryBuilder().useCache("false" as any)).toThrow(/useCache must be a boolean/);
	});
});

describe("case-insensitive Mirror Node inputs remain accepted", () => {
	it("accepts mixed-case ordering, filters, fee modes, and media types", () => {
		expect(BlocksMapper.list({ order: "AsC" }).order).toBe("AsC");
		expect(TopicsMapper.messagesList({ topicId: ID, encoding: "BaSe64" }).params.encoding).toBe("BaSe64");
		expect(TransactionsMapper.list({ result: "SuCcEsS", type: "DeBiT" })).toMatchObject({ result: "SuCcEsS", type: "DeBiT" });
		expect(NetworkMapper.registeredNodes({ type: "MiRrOr_NoDe", order: "dEsC" })).toMatchObject({ type: "MiRrOr_NoDe", order: "dEsC" });

		const fee = NetworkMapper.estimateFees({
			transaction: new Uint8Array([1]),
			mode: "InTrInSiC",
			contentType: "Application/X-Protobuf",
		});
		expect(fee.params.mode).toBe("InTrInSiC");
		expect(fee.contentType).toBe("Application/X-Protobuf");
		expect(new NetworkFeeEstimateRequestBuilder().transaction(new Uint8Array([1])).mode("sTaTe").build().mode).toBe("sTaTe");
	});

	it.each(["ascending", "", 1, null, false])("rejects invalid order value %s", (order) => {
		expect(() => BlocksMapper.list({ order } as any)).toThrow(ValidationError);
	});
});
