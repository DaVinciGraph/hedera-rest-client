import type {
	AccountAirdropsPage,
	AccountBalanceTransactionsPage,
	AccountCryptoAllowancesQuery,
	AccountHookStoragePage,
	AccountHookStorageQuery,
	AccountHooksPage,
	AccountHooksQuery,
	AccountNFTsPage,
	AccountNftAllowancesQuery,
	AccountNftsOwnedQuery,
	AccountOneQuery,
	AccountOutstandingAirdropsQuery,
	AccountPendingAirdropsQuery,
	AccountRewardsPage,
	AccountRewardsQuery,
	AccountsListQuery,
	AccountsPage,
	AccountTokenAllowancesQuery,
	AccountTokensPage,
	AccountTokensQuery,
	BalancesListQuery,
	BalancesPage,
	Block,
	BlocksListQuery,
	BlocksOneQuery,
	BlocksPage,
	ContractActionsPage,
	ContractCallRequest,
	ContractCallResponse,
	ContractLogsByContractQuery,
	ContractLogsListQuery,
	ContractLogsPage,
	ContractOneQuery,
	ContractOpcodesQuery,
	ContractResultActionsQuery,
	ContractResultByTimestampQuery,
	ContractResultByTransactionQuery,
	ContractResultDetails,
	ContractResultsByContractQuery,
	ContractResultsListQuery,
	ContractsListQuery,
	ContractsPage,
	ContractsResultsPage,
	ContractStatePage,
	ContractStateQuery,
	ContractResponse,
	CryptoAllowancesPage,
	FeeEstimateResponse,
	NetworkExchangeRateQuery,
	NetworkExchangeRateSetResponse,
	NetworkFeeEstimateRequest,
	NetworkFeesQuery,
	NetworkFeesResponse,
	NetworkName,
	NetworkNodesPage,
	NetworkNodesQuery,
	NetworkRegisteredNodesQuery,
	NetworkStakeQuery,
	NetworkStakeResponse,
	NetworkSupplyQuery,
	NetworkSupplyResponse,
	NetworkSupplyResult,
	NetworkSupplyType,
	NFTAllowancesPage,
	Nft,
	NftTransactionsPage,
	OpcodesResponse,
	ProviderName,
	RegisteredNodesPage,
	RequestOptions,
	Schedule,
	SchedulesListQuery,
	SchedulesOneQuery,
	SchedulesPage,
	TokenAllowancesPage,
	TokenBalancesPage,
	TokenBalancesQuery,
	TokenInfo,
	TokenNftOneQuery,
	TokenNftsListQuery,
	TokenNftsPage,
	TokenNftTransactionsQuery,
	TokenOneQuery,
	TokensListQuery,
	TokensPage,
	Topic,
	TopicMessage,
	TopicMessageBySequenceQuery,
	TopicMessageByTimestampQuery,
	TopicMessagesListQuery,
	TopicMessagesPage,
	TopicOneQuery,
	TransactionByIdQuery,
	TransactionByIdResponse,
	TransactionsListQuery,
	TransactionsPage,
} from "./types";
import type {
	AccountCryptoAllowancesInit,
	AccountHookStorageInit,
	AccountHooksInit,
	AccountNftAllowancesInit,
	AccountNftsOwnedInit,
	AccountOneInit,
	AccountOutstandingAirdropsInit,
	AccountPendingAirdropsInit,
	AccountRewardsInit,
	AccountsListInit,
	AccountTokenAllowancesInit,
	AccountTokensInit,
} from "./dsl/accounts";
import type { BalancesListQueryBuilder } from "./dsl/balances";
import type { BlocksListQueryBuilder, BlocksOneQueryBuilder } from "./dsl/blocks";
import type {
	ContractActionsQueryBuilder,
	ContractCallRequestBuilder,
	ContractLogsByContractQueryBuilder,
	ContractLogsListQueryBuilder,
	ContractOneQueryBuilder,
	ContractOpcodesQueryBuilder,
	ContractResultByTimestampQueryBuilder,
	ContractResultByTransactionQueryBuilder,
	ContractResultsByContractQueryBuilder,
	ContractResultsListQueryBuilder,
	ContractsListQueryBuilder,
	ContractStateQueryBuilder,
} from "./dsl/contracts";
import type {
	NetworkExchangeRateQueryBuilder,
	NetworkFeeEstimateRequestBuilder,
	NetworkFeesQueryBuilder,
	NetworkNodesQueryBuilder,
	NetworkRegisteredNodesQueryBuilder,
	NetworkStakeQueryBuilder,
	NetworkSupplyBuilderResult,
	NetworkSupplyQueryBuilder,
} from "./dsl/network";
import type { SchedulesListQueryBuilder, SchedulesOneQueryBuilder } from "./dsl/schedules";
import type {
	TokenBalancesQueryBuilder,
	TokenNftOneQueryBuilder,
	TokenNftsListQueryBuilder,
	TokenNftTransactionsQueryBuilder,
	TokenOneQueryBuilder,
	TokensListQueryBuilder,
} from "./dsl/tokens";
import type {
	TopicMessageBySequenceQueryBuilder,
	TopicMessageByTimestampQueryBuilder,
	TopicMessagesListQueryBuilder,
	TopicOneQueryBuilder,
} from "./dsl/topics";
import type { TransactionByIdQueryBuilder, TransactionsListQueryBuilder } from "./dsl/transactions";

/** A nameable public handle returned by every REST operation builder. */
export interface OperationHandle<T> {
	get(options?: RequestOptions): Promise<T>;
}

/** Callback form accepted alongside a plain query object. */
export type QueryInitializer<TBuilder> = (query: TBuilder) => void | TBuilder;

/** Page limits resolved for the active provider/network scope. */
export interface PageLimits {
	default: number;
	max: number;
}

/** Provider/network scoping shared by each public resource façade. */
export interface ScopedResource<TSelf> {
	provider(provider: ProviderName): TSelf;
	network(network: NetworkName): TSelf;
}

export interface AccountsResource extends ScopedResource<AccountsResource> {
	list(query?: AccountsListQuery | AccountsListInit): OperationHandle<AccountsPage>;
	one(query: AccountOneQuery | AccountOneInit): OperationHandle<AccountBalanceTransactionsPage | null>;
	hooks(query: AccountHooksQuery | AccountHooksInit): OperationHandle<AccountHooksPage>;
	hookStorage(query: AccountHookStorageQuery | AccountHookStorageInit): OperationHandle<AccountHookStoragePage>;
	hbarAllowances(query: AccountCryptoAllowancesQuery | AccountCryptoAllowancesInit): OperationHandle<CryptoAllowancesPage>;
	tokenAllowances(query: AccountTokenAllowancesQuery | AccountTokenAllowancesInit): OperationHandle<TokenAllowancesPage>;
	nftAllowances(query: AccountNftAllowancesQuery | AccountNftAllowancesInit): OperationHandle<NFTAllowancesPage>;
	tokens(query: AccountTokensQuery | AccountTokensInit): OperationHandle<AccountTokensPage>;
	nfts(query: AccountNftsOwnedQuery | AccountNftsOwnedInit): OperationHandle<AccountNFTsPage>;
	rewards(query: AccountRewardsQuery | AccountRewardsInit): OperationHandle<AccountRewardsPage>;
	outstandingAirdrops(query: AccountOutstandingAirdropsQuery | AccountOutstandingAirdropsInit): OperationHandle<AccountAirdropsPage>;
	pendingAirdrops(query: AccountPendingAirdropsQuery | AccountPendingAirdropsInit): OperationHandle<AccountAirdropsPage>;
}

export interface BalancesResource extends ScopedResource<BalancesResource> {
	list(query?: BalancesListQuery | QueryInitializer<BalancesListQueryBuilder>): OperationHandle<BalancesPage>;
}

export interface BlocksResource extends ScopedResource<BlocksResource> {
	list(query?: BlocksListQuery | QueryInitializer<BlocksListQueryBuilder>): OperationHandle<BlocksPage>;
	one(query: BlocksOneQuery | QueryInitializer<BlocksOneQueryBuilder>): OperationHandle<Block | null>;
}

export interface SchedulesResource extends ScopedResource<SchedulesResource> {
	list(query?: SchedulesListQuery | QueryInitializer<SchedulesListQueryBuilder>): OperationHandle<SchedulesPage>;
	one(query: SchedulesOneQuery | QueryInitializer<SchedulesOneQueryBuilder>): OperationHandle<Schedule | null>;
}

export interface TokensResource extends ScopedResource<TokensResource> {
	list(query?: TokensListQuery | QueryInitializer<TokensListQueryBuilder>): OperationHandle<TokensPage>;
	one(query: TokenOneQuery | QueryInitializer<TokenOneQueryBuilder>): OperationHandle<TokenInfo | null>;
	balances(query: TokenBalancesQuery | QueryInitializer<TokenBalancesQueryBuilder>): OperationHandle<TokenBalancesPage>;
	nfts(query: TokenNftsListQuery | QueryInitializer<TokenNftsListQueryBuilder>): OperationHandle<TokenNftsPage>;
	nft(query: TokenNftOneQuery | QueryInitializer<TokenNftOneQueryBuilder>): OperationHandle<Nft | null>;
	nftTransactions(query: TokenNftTransactionsQuery | QueryInitializer<TokenNftTransactionsQueryBuilder>): OperationHandle<NftTransactionsPage>;
}

export interface TopicsResource extends ScopedResource<TopicsResource> {
	one(query: TopicOneQuery | QueryInitializer<TopicOneQueryBuilder>): OperationHandle<Topic | null>;
	messages(query: TopicMessagesListQuery | QueryInitializer<TopicMessagesListQueryBuilder>): OperationHandle<TopicMessagesPage>;
	messageBySequence(query: TopicMessageBySequenceQuery | QueryInitializer<TopicMessageBySequenceQueryBuilder>): OperationHandle<TopicMessage | null>;
	messageByTimestamp(query: TopicMessageByTimestampQuery | QueryInitializer<TopicMessageByTimestampQueryBuilder>): OperationHandle<TopicMessage | null>;
}

export interface TransactionsResource extends ScopedResource<TransactionsResource> {
	list(query?: TransactionsListQuery | QueryInitializer<TransactionsListQueryBuilder>): OperationHandle<TransactionsPage>;
	byId(query: TransactionByIdQuery | QueryInitializer<TransactionByIdQueryBuilder>): OperationHandle<TransactionByIdResponse>;
}

export interface ContractsResource extends ScopedResource<ContractsResource> {
	list(query?: ContractsListQuery | QueryInitializer<ContractsListQueryBuilder>): OperationHandle<ContractsPage>;
	one(query: ContractOneQuery | QueryInitializer<ContractOneQueryBuilder>): OperationHandle<ContractResponse | null>;
	results(query: ContractResultsByContractQuery | QueryInitializer<ContractResultsByContractQueryBuilder>): OperationHandle<ContractsResultsPage>;
	resultByTimestamp(query: ContractResultByTimestampQuery | QueryInitializer<ContractResultByTimestampQueryBuilder>): OperationHandle<ContractResultDetails | null>;
	globalResults(query?: ContractResultsListQuery | QueryInitializer<ContractResultsListQueryBuilder>): OperationHandle<ContractsResultsPage>;
	resultByTransaction(query: ContractResultByTransactionQuery | QueryInitializer<ContractResultByTransactionQueryBuilder>): OperationHandle<ContractResultDetails | null>;
	globalLogs(query?: ContractLogsListQuery | QueryInitializer<ContractLogsListQueryBuilder>): OperationHandle<ContractLogsPage>;
	logs(query: ContractLogsByContractQuery | QueryInitializer<ContractLogsByContractQueryBuilder>): OperationHandle<ContractLogsPage>;
	state(query: ContractStateQuery | QueryInitializer<ContractStateQueryBuilder>): OperationHandle<ContractStatePage>;
	call(query: ContractCallRequest | QueryInitializer<ContractCallRequestBuilder>): OperationHandle<ContractCallResponse>;
	actions(query: ContractResultActionsQuery | QueryInitializer<ContractActionsQueryBuilder>): OperationHandle<ContractActionsPage>;
	opcodes(query: ContractOpcodesQuery | QueryInitializer<ContractOpcodesQueryBuilder>): OperationHandle<OpcodesResponse>;
}

export interface NetworkResource extends ScopedResource<NetworkResource> {
	supply(): OperationHandle<NetworkSupplyResponse>;
	supply<Query extends NetworkSupplyQuery>(query: Query): OperationHandle<NetworkSupplyResult<Query>>;
	supply<Result extends void | NetworkSupplyQueryBuilder<NetworkSupplyType | undefined>>(
		query: (q: NetworkSupplyQueryBuilder) => Result
	): OperationHandle<NetworkSupplyBuilderResult<Result>>;
	fees(query?: NetworkFeesQuery | QueryInitializer<NetworkFeesQueryBuilder>): OperationHandle<NetworkFeesResponse>;
	exchangeRate(query?: NetworkExchangeRateQuery | QueryInitializer<NetworkExchangeRateQueryBuilder>): OperationHandle<NetworkExchangeRateSetResponse>;
	nodes(query?: NetworkNodesQuery | QueryInitializer<NetworkNodesQueryBuilder>): OperationHandle<NetworkNodesPage>;
	estimateFees(query: NetworkFeeEstimateRequest | QueryInitializer<NetworkFeeEstimateRequestBuilder>): OperationHandle<FeeEstimateResponse>;
	registeredNodes(query?: NetworkRegisteredNodesQuery | QueryInitializer<NetworkRegisteredNodesQueryBuilder>): OperationHandle<RegisteredNodesPage>;
	stake(query?: NetworkStakeQuery | QueryInitializer<NetworkStakeQueryBuilder>): OperationHandle<NetworkStakeResponse>;
}
