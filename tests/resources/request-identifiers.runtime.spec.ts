import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { AccountsMapper } from "../../src/resources/accounts/mapper";
import { BalancesMapper } from "../../src/resources/balances/mapper";
import { ContractsMapper } from "../../src/resources/contracts/mapper";
import { NetworkMapper } from "../../src/resources/network/mapper";
import { SchedulesMapper } from "../../src/resources/schedules/mapper";
import { TokensMapper } from "../../src/resources/tokens/mapper";
import { TransactionsMapper } from "../../src/resources/transactions/mapper";
import { AccountsListQueryDSL, AccountTokensDSL } from "../../src/dsl/accounts";
import { BalancesListQueryBuilder } from "../../src/dsl/balances";
import { ContractCallRequestBuilder, ContractResultsListQueryBuilder, ContractsListQueryBuilder } from "../../src/dsl/contracts";
import { TransactionsListQueryBuilder } from "../../src/dsl/transactions";

describe("request identifier mapper runtime validation", () => {
	const invalidCases: Array<[string, () => unknown]> = [
		["accounts account.id", () => AccountsMapper.list({ accountId: 7 } as any)],
		["balances account.id", () => BalancesMapper.list({ accountId: 7 } as any)],
		["contracts contract.id", () => ContractsMapper.list({ contractId: 7 } as any)],
		["contract results from", () => ContractsMapper.resultsList({ from: 7 } as any)],
		["schedules account.id", () => SchedulesMapper.list({ accountId: 7 } as any)],
		["schedules schedule.id", () => SchedulesMapper.list({ scheduleId: 7 } as any)],
		["tokens account.id", () => TokensMapper.list({ accountId: 7 } as any)],
		["tokens token.id", () => TokensMapper.list({ tokenId: 7 } as any)],
		["token balances account.id", () => TokensMapper.balances({ tokenId: "0.0.1", accountId: 7 } as any)],
		["transactions account.id", () => TransactionsMapper.list({ accountId: 7 } as any)],
		["network file.id", () => NetworkMapper.nodes({ fileId: 7 } as any)],
	];

	it.each(invalidCases)("rejects non-string %s values instead of coercing them", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
	});

	const emptyCases: Array<[string, () => unknown]> = [
		["accounts account.id", () => AccountsMapper.list({ accountId: "" })],
		["balances account.id", () => BalancesMapper.list({ accountId: "" })],
		["contracts contract.id", () => ContractsMapper.list({ contractId: "" })],
		["contract results from", () => ContractsMapper.resultsList({ from: "" })],
		["schedules account.id", () => SchedulesMapper.list({ accountId: "" })],
		["schedules schedule.id", () => SchedulesMapper.list({ scheduleId: "" })],
		["tokens account.id", () => TokensMapper.list({ accountId: "" })],
		["tokens token.id", () => TokensMapper.list({ tokenId: "" })],
		["token balances account.id", () => TokensMapper.balances({ tokenId: "0.0.1", accountId: "" })],
		["transactions account.id", () => TransactionsMapper.list({ accountId: "" })],
		["network file.id", () => NetworkMapper.nodes({ fileId: "" })],
	];

	it.each(emptyCases)("rejects an explicitly empty %s value", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
	});

	const invalidFluentCases: Array<[string, () => unknown]> = [
		["accounts account.id", () => (new AccountsListQueryDSL().accountId() as any).greaterThan(7)],
		["account token.id", () => (new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId() as any).lessThan(7)],
		["balances account.id", () => (new BalancesListQueryBuilder().accountId() as any).greaterThan(7)],
		["contracts contract.id", () => (new ContractsListQueryBuilder().contractId() as any).greaterThan(7)],
		["contract results from", () => (new ContractResultsListQueryBuilder().from() as any).notEqualTo(7)],
		["transactions account.id", () => (new TransactionsListQueryBuilder().accountId() as any).greaterThan(7)],
	];

	it.each(invalidFluentCases)("rejects non-string fluent %s values instead of coercing them", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
	});

	it("rejects bigint contract-call addresses in object and fluent inputs", () => {
		const numericAddress = BigInt("1".repeat(40));
		expect(() => ContractsMapper.callQuery({ to: numericAddress } as any)).toThrow(ValidationError);
		expect(() => new ContractCallRequestBuilder().to(numericAddress as any)).toThrow(ValidationError);
	});
});
