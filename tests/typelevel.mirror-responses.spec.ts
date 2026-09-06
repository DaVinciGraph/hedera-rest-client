import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	AccessList,
	AccountBalanceTransactions,
	AccountBalanceTransactionsPage,
	AccountHooksPage,
	AccountHookStoragePage,
	BalancesPage,
	AccountsPage,
	ContractResult,
	ContractResultDetails,
	ContractStatePage,
	ContractStateResponse,
	EntityId,
	HederaRestClientConfig,
	HttpError,
	HttpNetworkError,
	IndexedDbCacheOptions,
	Int64,
	Key,
	KnownTransactionType,
	Links,
	NetworkNode,
	NetworkNodesPage,
	NetworkNodesResponse,
	NftTransactionsPage,
	PositiveNumber,
	RoyaltyFee,
	RedisCacheAdapterOptions,
	RegisteredNodesPage,
	ScopedClient,
	TokenBalancesPage,
	TokenDistribution,
	TokenDistributionItem,
	TokenInfo,
	TokenRelationship,
	Transaction,
	TransactionDetail,
} from "../src";
import type { AccountsBuilder } from "../src/resources/accounts/builder";
import type { ContractsBuilder } from "../src/resources/contracts/builder";
import type { NetworkBuilder } from "../src/resources/network/builder";

type AccountOneResult = Awaited<ReturnType<ReturnType<AccountsBuilder["one"]>["get"]>>;
type ResultByTimestamp = Awaited<ReturnType<ReturnType<ContractsBuilder["resultByTimestamp"]>["get"]>>;
type ContractStateResult = Awaited<ReturnType<ReturnType<ContractsBuilder["state"]>["get"]>>;
type NodesResult = Awaited<ReturnType<ReturnType<NetworkBuilder["nodes"]>["get"]>>;

describe("Mirror Node response type contract", () => {
	it("models shared nullable components and corrected single-endpoint results", () => {
		expectTypeOf<EntityId>().toEqualTypeOf<string | null>();
		expectTypeOf<Key>().toEqualTypeOf<
			| {
					_type?: "ECDSA_SECP256K1" | "ED25519" | "ProtobufEncoded";
					key?: string;
			  }
			| null
		>();
		expectTypeOf<AccountOneResult>().toEqualTypeOf<AccountBalanceTransactionsPage | null>();
		expectTypeOf<AccountBalanceTransactionsPage>().toMatchTypeOf<AccountBalanceTransactions>();
		expectTypeOf<AccountBalanceTransactionsPage["next"]>().toBeFunction();
		expectTypeOf<ResultByTimestamp>().toEqualTypeOf<ContractResultDetails | null>();
	});

	it("models contract access/authorization data and all int64 values losslessly", () => {
		expectTypeOf<PositiveNumber>().toEqualTypeOf<Int64>();
		expectTypeOf<ContractResult["access_list"]>().toEqualTypeOf<AccessList[] | undefined>();
		expectTypeOf<ContractResult["authorization_list"]>().toEqualTypeOf<
			| Array<{
					address?: string;
					chain_id?: string;
					nonce?: Int64;
					r?: string;
					s?: string;
					y_parity?: string;
			  }>
			| undefined
		>();
		expectTypeOf<ContractResult["failed_initcode"]>().toEqualTypeOf<string | null | undefined>();
		expectTypeOf<ContractResult["block_gas_used"]>().toEqualTypeOf<Int64 | null | undefined>();
	});

	it("matches token fee, relationship, and distribution schemas", () => {
		expectTypeOf<RoyaltyFee["fallback_fee"]>().toEqualTypeOf<
			| {
					amount?: Int64;
					denominating_token_id?: EntityId;
			  }
			| null
			| undefined
		>();
		expectTypeOf<TokenInfo["metadata_key"]>().toEqualTypeOf<Key | undefined>();
		expectTypeOf<TokenRelationship["automatic_association"]>().toEqualTypeOf<boolean | null>();
		expectTypeOf<TokenRelationship["decimals"]>().toEqualTypeOf<Int64 | null>();
		expectTypeOf<TokenDistribution>().toEqualTypeOf<TokenDistributionItem[]>();
		expectTypeOf<TokenBalancesPage["balances"]>().toEqualTypeOf<TokenDistributionItem[]>();
	});

	it("retains raw wrappers accurately through normalized page types", () => {
		expectTypeOf<AccountsPage["links"]>().toEqualTypeOf<Links>();
		expectTypeOf<AccountHooksPage["links"]>().toEqualTypeOf<Links>();
		expectTypeOf<AccountHookStoragePage["links"]>().toEqualTypeOf<Links>();
		expectTypeOf<NftTransactionsPage["links"]>().toEqualTypeOf<Links>();
		expectTypeOf<RegisteredNodesPage["links"]>().toEqualTypeOf<Links>();
		expectTypeOf<Awaited<ReturnType<AccountsPage["next"]>>>().toEqualTypeOf<AccountsPage | null>();
		expectTypeOf<Awaited<ReturnType<AccountHooksPage["next"]>>>().toEqualTypeOf<AccountHooksPage | null>();
		expectTypeOf<Awaited<ReturnType<AccountHookStoragePage["next"]>>>().toEqualTypeOf<AccountHookStoragePage | null>();
		expectTypeOf<Awaited<ReturnType<NftTransactionsPage["next"]>>>().toEqualTypeOf<NftTransactionsPage | null>();
		expectTypeOf<Awaited<ReturnType<RegisteredNodesPage["next"]>>>().toEqualTypeOf<RegisteredNodesPage | null>();
		expectTypeOf<BalancesPage["balances"]>().toBeArray();
		expectTypeOf<BalancesPage["links"]>().toEqualTypeOf<Links | undefined>();
		expectTypeOf<ContractStateResult>().toEqualTypeOf<ContractStatePage>();
		expectTypeOf<NodesResult>().toEqualTypeOf<NetworkNodesPage>();
		expectTypeOf<ContractStatePage>().toMatchTypeOf<ContractStateResponse>();
		expectTypeOf<NetworkNodesPage>().toMatchTypeOf<NetworkNodesResponse>();
		expectTypeOf<ContractStatePage["links"]>().toEqualTypeOf<ContractStateResponse["links"]>();
		expectTypeOf<NetworkNodesPage["links"]>().toEqualTypeOf<NetworkNodesResponse["links"]>();
		expectTypeOf<Awaited<ReturnType<ContractStatePage["next"]>>>().toEqualTypeOf<ContractStatePage | null>();
		expectTypeOf<Awaited<ReturnType<NetworkNodesPage["next"]>>>().toEqualTypeOf<NetworkNodesPage | null>();
		expectTypeOf<NetworkNodesPage["nodes"]>().toEqualTypeOf<NetworkNode[]>();
		expectTypeOf<NetworkNode["associated_registered_nodes"]>().toEqualTypeOf<Int64[]>();
		expectTypeOf<NetworkNode["grpc_proxy_endpoint"]>().toEqualTypeOf<
			{ domain_name: string; ip_address_v4: string; port: number } | null
		>();
	});

	it("includes current transaction additions while allowing future fork labels", () => {
		const current: KnownTransactionType[] = ["HOOKSTORE", "REGISTEREDNODECREATE", "STATESIGNATURETRANSACTION"];
		const futureForkLabel: NonNullable<Transaction["name"]> = "PROVIDER_EXTENSION_TRANSACTION";
		if (false) {
			// @ts-expect-error - obsolete labels are not members of the documented enum
			const obsolete: KnownTransactionType = "UNKNOWN";
			void obsolete;
		}
		expectTypeOf<Transaction["charged_tx_fee"]>().toEqualTypeOf<Int64 | undefined>();
		expectTypeOf<Transaction["nonce"]>().toEqualTypeOf<number | undefined>();
		expectTypeOf<TransactionDetail["nonce"]>().toEqualTypeOf<number | undefined>();
		expectTypeOf<Transaction["high_volume"]>().toEqualTypeOf<boolean | undefined>();
		expectTypeOf<Transaction["high_volume_pricing_multiplier"]>().toEqualTypeOf<Int64 | null | undefined>();
		expect(current).toHaveLength(3);
		expect(futureForkLabel).toBe("PROVIDER_EXTENSION_TRANSACTION");
		if (false) {
			// @ts-expect-error - transaction response nonce is an OpenAPI int32 number
			const invalidNonce: TransactionDetail = { nonce: "1" };
			void invalidNonce;
		}
	});

	it("types arbitrary network identities without colliding with provider options", () => {
		const config: HederaRestClientConfig = {
			defaultProvider: "fork",
			defaultNetwork: "localnet",
			provider: {
				fork: {
					http: { limiter: { maxConcurrent: 1 } },
					networks: { localnet: { url: "https://mirror.example/localnet" } },
				},
			},
		};

		expect(config.defaultNetwork).toBe("localnet");
	});

	it("exports nameable client and cache option types without any-valued boundaries", () => {
		const indexedDb: IndexedDbCacheOptions<{ value: number }, string> = {
			db: { transaction: () => ({}) },
			serialize: JSON.stringify,
			deserialize: JSON.parse,
		};
		const redis: RedisCacheAdapterOptions<{ value: number }, string> = {
			client: { sendCommand: () => undefined },
			serialize: JSON.stringify,
			deserialize: JSON.parse,
		};

		expectTypeOf<ReturnType<ScopedClient["accounts"]>["list"]>().toBeFunction();
		expectTypeOf<HttpError["body"]>().toBeUnknown();
		expectTypeOf<HttpNetworkError["cause"]>().toBeUnknown();
		expectTypeOf<HttpNetworkError["attempts"]>().toBeNumber();
		expectTypeOf<HttpNetworkError["url"]>().toBeString();
		expect([indexedDb.db, redis.client]).toHaveLength(2);
	});
});
