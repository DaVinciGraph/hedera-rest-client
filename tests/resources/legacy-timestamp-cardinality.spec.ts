import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountsMapper } from "../../src/resources/accounts/mapper";
import { BalancesMapper } from "../../src/resources/balances/mapper";
import { BlocksMapper } from "../../src/resources/blocks/mapper";
import { ContractsMapper } from "../../src/resources/contracts/mapper";
import { TokensMapper } from "../../src/resources/tokens/mapper";
import { TopicsMapper } from "../../src/resources/topics/mapper";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";

const TOO_MANY_TIMESTAMPS = Array.from({ length: 101 }, () => "1700000000");

describe("legacy REST timestamp occurrence limits", () => {
	const calls = [
		["account", () => AccountsMapper.one({ idOrAliasOrEvmAddress: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["account rewards", () => AccountsMapper.rewards({ idOrAliasOrEvmAddress: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["balances", () => BalancesMapper.list({ timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["blocks", () => BlocksMapper.list({ timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["contract", () => ContractsMapper.one({ idOrAddress: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["contract results", () => ContractsMapper.resultsList({ timestamp: TOO_MANY_TIMESTAMPS } as any)],
		[
			"contract results by contract",
			() => ContractsMapper.resultsByContract({ idOrAddress: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any),
		],
		["contract state", () => ContractsMapper.stateQuery({ idOrAddress: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["token balances", () => TokensMapper.balances({ tokenId: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		[
			"NFT transactions",
			() => TokensMapper.nftTx({ tokenId: "0.0.1", serialNumber: 1, timestamp: TOO_MANY_TIMESTAMPS } as any),
		],
		["topic messages", () => TopicsMapper.messagesList({ topicId: "0.0.1", timestamp: TOO_MANY_TIMESTAMPS } as any)],
		["transactions", () => TransactionsMapper.list({ timestamp: TOO_MANY_TIMESTAMPS } as any)],
	] as const;

	for (const [name, call] of calls) {
		it(`rejects more than 100 timestamp occurrences for ${name}`, () => {
			expect(call).toThrow(ValidationError);
		});
	}

	it("rejects an explicit empty timestamp array", () => {
		expect(() => TokensMapper.balances({ tokenId: "0.0.1", timestamp: [] } as any)).toThrow(ValidationError);
	});
});
