import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountOneQueryDSL, AccountRewardsDSL } from "../../src/dsl/accounts";
import { BalancesListQueryBuilder } from "../../src/dsl/balances";
import { BlocksListQueryBuilder } from "../../src/dsl/blocks";
import {
	ContractOneQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractStateQueryBuilder,
} from "../../src/dsl/contracts";
import { TokenBalancesQueryBuilder, TokenNftTransactionsQueryBuilder } from "../../src/dsl/tokens";
import { TopicMessagesListQueryBuilder } from "../../src/dsl/topics";
import { TransactionsListQueryBuilder } from "../../src/dsl/transactions";

type TimestampBuilder = { timestamp(value: string): unknown };

describe("legacy timestamp DSL occurrence limits", () => {
	const builders: Array<[string, () => TimestampBuilder]> = [
		["account", () => new AccountOneQueryDSL()],
		["account rewards", () => new AccountRewardsDSL()],
		["balances", () => new BalancesListQueryBuilder()],
		["blocks", () => new BlocksListQueryBuilder()],
		["contract", () => new ContractOneQueryBuilder()],
		["contract results", () => new ContractResultsListQueryBuilder()],
		["contract results by contract", () => new ContractResultsByContractQueryBuilder()],
		["contract state", () => new ContractStateQueryBuilder()],
		["token balances", () => new TokenBalancesQueryBuilder()],
		["NFT transactions", () => new TokenNftTransactionsQueryBuilder()],
		["topic messages", () => new TopicMessagesListQueryBuilder()],
		["transactions", () => new TransactionsListQueryBuilder()],
	];

	for (const [name, makeBuilder] of builders) {
		it(`rejects a 101st timestamp for ${name}`, () => {
			const builder = makeBuilder();
			for (let index = 0; index < 100; index += 1) builder.timestamp("1700000000");
			expect(() => builder.timestamp("1700000000")).toThrow(ValidationError);
		});
	}

	it("applies the same cap to fluent comparator calls", () => {
		const builder = new BalancesListQueryBuilder();
		for (let index = 0; index < 100; index += 1) builder.timestamp().equalTo("1700000000");
		expect(() => builder.timestamp().equalTo("1700000000")).toThrow(ValidationError);
	});
});
