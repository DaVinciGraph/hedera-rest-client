import { describe, expect, it } from "vitest";

import type {
	AccountsResource,
	BalancesResource,
	BlocksResource,
	ContractsResource,
	NetworkResource,
	SchedulesResource,
	TokensResource,
	TopicsResource,
	TransactionsResource,
} from "../src";
import type { AccountsBuilder } from "../src/resources/accounts/builder";
import type { BalancesBuilder } from "../src/resources/balances/builder";
import type { BlocksBuilder } from "../src/resources/blocks/builder";
import type { ContractsBuilder } from "../src/resources/contracts/builder";
import type { NetworkBuilder } from "../src/resources/network/builder";
import type { SchedulesBuilder } from "../src/resources/schedules/builder";
import type { TokensBuilder } from "../src/resources/tokens/builder";
import type { TopicsBuilder } from "../src/resources/topics/builder";
import type { TransactionsBuilder } from "../src/resources/transactions/builder";

type Fn = (...args: any[]) => unknown;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
		? true
		: false
	: false;
type FunctionKeys<T> = {
	[K in keyof T]-?: T[K] extends Fn ? K : never;
}[keyof T];
type OperationKeys<T> = Exclude<FunctionKeys<T>, "provider" | "network">;
type Method<T, K extends PropertyKey> = K extends keyof T ? Extract<T[K], Fn> : never;
type Handle<T extends Fn> = ReturnType<T>;
type GetMethod<T extends Fn> = Handle<T> extends { get: infer G extends Fn } ? G : never;

type AllMethodParametersMatch<Public, Concrete> = false extends {
	[K in OperationKeys<Public>]: Equal<Parameters<Method<Public, K>>, Parameters<Method<Concrete, K>>>;
}[OperationKeys<Public>]
	? false
	: true;

type AllGetParametersMatch<Public, Concrete> = false extends {
	[K in OperationKeys<Public>]: Equal<Parameters<GetMethod<Method<Public, K>>>, Parameters<GetMethod<Method<Concrete, K>>>>;
}[OperationKeys<Public>]
	? false
	: true;

type AllResultsMatch<Public, Concrete> = false extends {
	[K in OperationKeys<Public>]: Equal<Awaited<ReturnType<GetMethod<Method<Public, K>>>>, Awaited<ReturnType<GetMethod<Method<Concrete, K>>>>>;
}[OperationKeys<Public>]
	? false
	: true;

type ResourceMatches<Public, Concrete> = Equal<OperationKeys<Public>, OperationKeys<Concrete>> extends true
	? AllMethodParametersMatch<Public, Concrete> extends true
		? AllGetParametersMatch<Public, Concrete> extends true
			? AllResultsMatch<Public, Concrete>
			: false
		: false
	: false;

type EveryResourceMatches =
	ResourceMatches<AccountsResource, AccountsBuilder> &
	ResourceMatches<BalancesResource, BalancesBuilder> &
	ResourceMatches<BlocksResource, BlocksBuilder> &
	ResourceMatches<SchedulesResource, SchedulesBuilder> &
	ResourceMatches<TokensResource, TokensBuilder> &
	ResourceMatches<TopicsResource, TopicsBuilder> &
	ResourceMatches<TransactionsResource, TransactionsBuilder> &
	ResourceMatches<ContractsResource, ContractsBuilder> &
	ResourceMatches<NetworkResource, NetworkBuilder>;

describe("public resource façade type parity", () => {
	it("matches every concrete builder operation signature", () => {
		const everyResourceMatches: EveryResourceMatches = true;
		expect(everyResourceMatches).toBe(true);
	});
});
