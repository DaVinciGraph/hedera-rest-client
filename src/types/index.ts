import {
	AccountBalance,
	AccountBalanceTransactions,
	AccountInfo,
	Block,
	Contract,
	ContractAction,
	ContractLog,
	ContractResult,
	ContractState,
	ContractStateResponse,
	CryptoAllowance,
	EntityIdNullable,
	FeeEstimateMode,
	Hook,
	HookStorage,
	Int64,
	Links,
	NetworkNode,
	NetworkNodesResponse,
	NetworkSupplyResponse,
	RegisteredNode,
	RegisteredNodeType,
	Nft,
	NftAllowance,
	NftTransactionTransfer,
	Schedule,
	StakingReward,
	TimestampNullable,
	Token,
	TokenAirdrop,
	TokenAllowance,
	TokenDistributionItem,
	TokenRelationship,
	KnownTokenType,
	TokenType,
	TopicMessage,
	Transaction,
	TransactionTypes,
	ContractCallRequest,
} from "./mirrorNode";

/**
 * Re-export precise REST response types from your mirrorNode.ts (project root).
 * This gives editors perfect tooltips and return type detection.
 */
export * from "./mirrorNode";

// -----------------------------
// Providers / Networks / Config
// -----------------------------

/** Hedera's public network names. */
export type CanonicalNetworkName = "mainnet" | "testnet" | "previewnet";

/**
 * A configured network identity.
 *
 * Canonical names retain autocomplete while the open member supports private
 * networks, local environments, and provider-specific Hedera forks.
 */
export type NetworkName = CanonicalNetworkName | (string & {});
export type LimitValue = number | "default" | "max";
export type ProviderName = string /* | Omit<string, "public" | "arkhia">*/;

/** Controls one resource operation without changing the reusable builder. */
export interface RequestOptions {
	/** Cancels limiter waiting, retries, failover, transport, and response reading. */
	signal?: AbortSignal;
	/** Maximum duration of each physical HTTP attempt, in milliseconds. */
	timeoutMs?: number;
}

export interface ApiKey {
	/** Header key for the API key (e.g., 'x-api-key') */
	key: string;
	/** Header value */
	value: string;
}

/** Static HTTP headers sent with every request to a provider or network. */
export type StaticHeaders = Readonly<Record<string, string>>;

export interface LimiterConfig {
	/**
	 * Initial request-token reservoir. Example: 60 with interval 60_000 -> 60 req/min.
	 * Omitting this field leaves the reservoir unlimited; `minTime` and
	 * `maxConcurrent` still apply when a limiter object is configured.
	 */
	reservoir?: number;
	/** Local Bottleneck refill interval in ms; must be a positive multiple of 250. */
	reservoirRefreshInterval?: number;
	/** How much to set the reservoir to on refresh. Refresh requires an initial `reservoir`. */
	reservoirRefreshAmount?: number;
	/** Minimum whole milliseconds between two requests. */
	minTime?: number;
	/** Max concurrent requests. */
	maxConcurrent?: number;
}

export interface RetryPolicy {
	/** Master switch for retries (default: false). When false, only 1 attempt is made. */
	enabled?: boolean;
	/**
	 * Max attempts INCLUDING the first try (e.g., 6 means 1 initial + 5 retries).
	 * Must be a finite integer greater than or equal to 1 when retries are enabled.
	 * Default: 3
	 */
	maxAttempts?: number;
	/** Initial backoff delay in whole milliseconds (default 250). */
	initialDelayMs?: number;
	/** Maximum backoff delay in whole milliseconds (default 4000). */
	maxDelayMs?: number;
	/**
	 * Backoff strategy for retry delays (default: "full-jitter").
	 * - "fixed": Always wait initialDelayMs between retries
	 * - "full-jitter": Exponential backoff with randomization (AWS full-jitter algorithm)
	 */
	backoff?: "fixed" | "full-jitter";
	/**
	 * Retry categories (defaults true):
	 * - 404 (Not Found) - default false
	 * - 429 (Too Many Requests)
	 * - 5xx
	 * - network errors
	 */
	on404?: boolean;
	on429?: boolean;
	on5xx?: boolean;
	onNetworkError?: boolean;
	/** Honor Retry-After header when present (default true). */
	honorRetryAfter?: boolean;
}

export interface HttpConfig {
	/**
	 * Bottleneck settings for one physical rate-limit bucket. A network-level
	 * declaration completely replaces a provider-level limiter for that network.
	 */
	limiter?: LimiterConfig;
	/** Retry fields inherit individually from provider to network. */
	retry?: RetryPolicy;
	/** Default timeout for each physical HTTP attempt, in milliseconds. */
	timeoutMs?: number;
}

/** Configuration for one provider's Mirror Node network. */
export interface NetworkConfig {
	/**
	 * Absolute HTTP(S) URL for the provider origin, a provider path prefix, or
	 * the complete Mirror Node API root ending in `/api/v1`.
	 */
	url: string;
	/**
	 * Compatibility shorthand for one authentication header.
	 *
	 * @deprecated Prefer `headers`, which supports multiple static headers.
	 */
	apiKey?: ApiKey;
	/**
	 * Static request headers for this network. These override provider-level
	 * headers and the legacy `apiKey` shorthand, case-insensitively.
	 */
	headers?: StaticHeaders;
	/**
	 * Network HTTP overrides. Retry fields merge with provider retry fields;
	 * a limiter declared here replaces the provider limiter for this network.
	 */
	http?: HttpConfig;
	page?: PageConfig;
}

/**
 * Provider config: can optionally specify a provider-level http config which applies to all networks
 * of that provider (e.g., Arkhia has a SHARED rate limit bucket across networks).
 */
export interface ProviderConfig {
	/** Backwards-compatible shorthand for Hedera's three public networks. */
	mainnet?: NetworkConfig;
	testnet?: NetworkConfig;
	previewnet?: NetworkConfig;
	/**
	 * Collision-free map for arbitrary network identities (for example a local
	 * network or a provider-specific fork). Canonical names are also accepted.
	 */
	networks?: Record<string, NetworkConfig>;
	/** Provider defaults. A provider-level limiter is shared across its networks. */
	http?: HttpConfig;
	page?: PageConfig;
	/** Static request headers inherited by every configured network. */
	headers?: StaticHeaders;
}

export type ProviderConfigMap = Record<ProviderName, ProviderConfig>;

export interface ResourceCacheConfig {
	/** Inherits the global enabled state; set to false to disable this resource. */
	isEnabled?: boolean;
	/** Resource-specific TTL in seconds; inherits the global duration when omitted. */
	duration?: number;
}

export interface CacheConfig {
	/** Master cache switch (default false). When false, no cache reads or writes occur. */
	isEnabled?: boolean;
	/** Global cache TTL in seconds (default 600). */
	duration?: number;
	resources?: {
		accounts?: ResourceCacheConfig;
		tokens?: ResourceCacheConfig;
		nfts?: ResourceCacheConfig;
		blocks?: ResourceCacheConfig;
		topics?: ResourceCacheConfig;
		transactions?: ResourceCacheConfig;
		schedules?: ResourceCacheConfig;
		contracts?: ResourceCacheConfig;
		network?: ResourceCacheConfig;
	};
	/** Optional cache adapter; defaults to the process-local MemoryCacheAdapter. */
	adapter?: CacheAdapter<unknown>;
}

/** App-wide configuration passed to the `HederaRestClient` constructor. */
export interface HederaRestClientConfig {
	/**
	 * Providers map; if omitted, defaults to Public Mirror Node (mainnet, testnet, and previewnet)
	 * at 50 requests/second per network. Retries are disabled by default.
	 */
	provider?: ProviderConfigMap;
	/**
	 * When true, preemptively switch to another provider of the same network
	 * if the current provider's rate limit is at capacity (overflow).
	 * Default: false
	 */
	switchProviderWhenOverflow?: boolean;
	/**
	 * When true, after a network failure or retryable HTTP failure (after local
	 * retries), try every remaining provider on the same network at most once.
	 * Alternate-provider attempts do not use their configured local retries.
	 * Default: false
	 */
	switchProviderOnFailure?: boolean;
	cache?: CacheConfig;
	/** Console logging (requests, limiter, retries, cache). */
	log?: boolean; // default false
	/**
	 * Default provider/network; if not supplied, defaults to:
	 *   provider: 'public', network: 'testnet'
	 */
	defaultProvider?: ProviderName;
	defaultNetwork?: NetworkName;
}

// -----------------------------
// Cache adapter interface
// -----------------------------

export interface CacheRecord<V> {
	value: V;
	/** absolute expiry in ms epoch */
	expiresAt: number;
}

export interface CacheAdapter<V = unknown> {
	get(key: string): Promise<CacheRecord<V> | undefined>;
	set(key: string, value: V, ttlSeconds: number): Promise<void>;
	delete?(key: string): Promise<void>;
	clear?(): Promise<void>;
}

// -----------------------------
// Builder base & query helpers
// -----------------------------

/**
 * Every case permutation of a reasonably short, finite string literal.
 *
 * This is intentionally used only for small REST query enums. Expanding long
 * strings into every case permutation can exceed TypeScript's union limits.
 */
export type CaseInsensitive<S extends string> = S extends `${infer Head}${infer Tail}`
	? `${Lowercase<Head> | Uppercase<Head>}${CaseInsensitive<Tail>}`
	: S;

/** Case-insensitive sort direction, matching Mirror Node query parsing. */
export type Order = CaseInsensitive<"asc" | "desc">;

export type Comparator = "gt" | "gte" | "lt" | "lte" | "eq" | "ne";

/** Comparison operators supported by fields which do not accept `ne`. */
export type NoNeComparator = Exclude<Comparator, "ne">;

export type ComparatorString = `${Comparator}:${string}`;
export type NoNeComparatorString = `${NoNeComparator}:${string}`;

/** Decimal-integer literal accepted without losing int64 precision. */
export type DecimalIntegerString = `${bigint}`;

/** Exact integer value; runtime validation remains authoritative for range/sign. */
export type IntegerValue = Int64;

/** Integer comparator for endpoints which reject `ne`. */
export type IntegerComparator = `${NoNeComparator}:${bigint}`;

/** Integer comparator for endpoints which support every comparator. */
export type AllIntegerComparator = `${Comparator}:${bigint}`;

/** Exact or compared integer for endpoints which reject `ne`. */
export type IntegerFilter = IntegerValue | IntegerComparator;

/** Exact or compared integer for endpoints which support every comparator. */
export type AllIntegerFilter = IntegerValue | AllIntegerComparator;

/** Exact Java `long` spelling; runtime validation handles signs, padding, and bounds. */
export type JavaLongValue = string | number;

/** rest-java `Long` range spelling, optionally prefixed by a comparator. */
export type JavaLongRangeFilter = JavaLongValue;

/** A query filter accepted once or through repeated query-parameter occurrences. */
export type RepeatedFilter<T> = T | readonly T[];

/** Decimal or `0x` integer accepted by equality-only block-number filters. */
export type BlockNumberValue = IntegerValue | `0x${string}`;

/** Block-number value with an optional explicit equality comparator. */
export type EqualityIntegerFilter = BlockNumberValue | `eq:${BlockNumberValue}`;

/** Decimal or lowercase-`0x` block-number filter with any comparator except `ne`. */
export type BlockNumberFilter = BlockNumberValue | `${NoNeComparator}:${BlockNumberValue}`;

/** Hedera timestamp as seconds with an optional fractional part. */
export type HederaTimestamp = string | number; // light runtime validation

/** Bare timestamp value without a comparator prefix; runtime validation is authoritative for strings. */
export type ExactTimestamp = string | number;

/** Timestamp filter (supports comparator prefixes). */
export type TimestampFilter = ComparatorString | HederaTimestamp;

/**
 * Timestamp filter for endpoints which reject `ne`.
 *
 * A broad string type is intentional: timestamps commonly come from Mirror
 * Node responses and therefore have the type `string`, not a string literal.
 * Endpoint-specific runtime validation remains authoritative, while fluent
 * comparator builders expose only the supported operators.
 */
export type NoNeTimestampFilter = string | number;

/** rest-java timestamp spelling; the optional suffix is parsed as raw nanoseconds. */
export type JavaTimestampFilter = string | number;

/**
 * Timestamp filter accepted by token-info lookups.
 * Runtime validation limits comparator prefixes to `eq`, `lt`, and `lte`.
 */
export type EqualOrLessTimestampFilter = string | number;

/** EntityId comparators like 'gt:0.0.100' */
export type EntityIdComparator = ComparatorString;

/** Entity-id comparator for endpoint-specific filters which reject `ne`. */
export type NoNeEntityIdComparator = NoNeComparatorString;

/** Account alias or id or evm address */
export type AccountAliasOrIdOrEvm = string;

// -----------------------------
// Accounts (existing query shapes)
// -----------------------------

export interface AccountsListQuery {
	/** Repeated `account.id` filters (up to 100 occurrences). */
	accountId?: RepeatedFilter<EntityIdComparator | string>;
	/** Repeated non-negative `account.balance` filters (up to 100 occurrences). */
	accountBalance?: RepeatedFilter<AllIntegerFilter>;
	accountPublicKey?: string; // account.publickey
	/** Repeated `balance` flags (up to 100 occurrences). */
	includeBalance?: RepeatedFilter<boolean>; // balance
	limit?: LimitValue; // default 25
	order?: Order; // default asc
}

export interface AccountOneQuery {
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	limit?: LimitValue; // default 25
	order?: Order; // default desc
	timestamp?: TimestampFilter | readonly TimestampFilter[];
	transactiontype?: TransactionTypes;
	transactions?: boolean;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks */
export interface AccountHooksQuery {
	/** Account number/id, alias, or EVM address used in the path. */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** One or more `hook.id` range filters; up to 100 occurrences, without `ne`. */
	hookId?: RepeatedFilter<JavaLongRangeFilter>;
	limit?: LimitValue;
	/** Server default is `desc`. */
	order?: Order;
}

/**
 * Hook-storage key query syntax: optional eq|gt|gte|lt|lte prefix followed by
 * 1..64 hexadecimal digits, with an optional `0x` prefix.
 */
export type HookStorageKeyFilter = string;

/** GET /api/v1/accounts/{idOrAliasOrEvmAddress}/hooks/{hookId}/storage */
export interface AccountHookStorageQuery {
	/** Account number/id, alias, or EVM address used in the path. */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** Exact Java-long path id in 0..2^63-1; `+`, signed zero, and leading zeroes are preserved. */
	hookId: JavaLongValue;
	/** One or more storage-key range filters; up to 100 occurrences. */
	key?: RepeatedFilter<HookStorageKeyFilter>;
	/** Up to two rest-java timestamp bounds; eq/gt/gte/lt/lte are supported, but not `ne`. */
	timestamp?: RepeatedFilter<JavaTimestampFilter>;
	limit?: LimitValue;
	/** Server default is `asc`. */
	order?: Order;
}

// -----------------------------
// Accounts subresources (existing)
// -----------------------------

export interface AccountCryptoAllowancesQuery {
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** `spender.id`; deployed Mirror Nodes support eq/gt/gte/lt/lte, but not `ne`. */
	spenderId?: RepeatedFilter<NoNeEntityIdComparator | string>;
	limit?: LimitValue;
	order?: Order;
}

// Keep using your existing types:
// - AccountAliasOrIdOrEvm
// - EntityIdComparator  (e.g., 'gte:0.0.1001')
// - Order

type AccountTokenAllowancesBase = {
	/** Path account (owner) — id, alias, or evm */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	limit?: LimitValue;
	order?: Order;
};

/**
 * GET /api/v1/accounts/{accountId}/allowances/tokens
 *
 * Rule: spenderId can be used alone; but if tokenId is present, spenderId is REQUIRED.
 */
export type AccountTokenAllowancesQuery =
	// Case A: tokenId present -> spenderId required
	| (AccountTokenAllowancesBase & {
			tokenId: RepeatedFilter<NoNeEntityIdComparator | string>; // maps to 'token.id'
			spenderId: RepeatedFilter<NoNeEntityIdComparator | string>; // maps to 'spender.id'
	  })
	// Case B: tokenId absent -> spenderId optional
	| (AccountTokenAllowancesBase & {
			tokenId?: undefined;
			spenderId?: RepeatedFilter<NoNeEntityIdComparator | string>; // optional when tokenId is not present
	  });

type AccountNftAllowancesBase = {
	/** Path account — the “view” account (owner when view omitted) */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** Viewpoint: 'owner' (default) or 'spender' (maps to owner=true|false) */
	view?: "owner" | "spender";
	limit?: LimitValue;
	order?: Order;
};

/** If tokenId is provided, counterpartyId is REQUIRED */
export type AccountNftAllowancesQuery =
	| (AccountNftAllowancesBase & {
			tokenId: RepeatedFilter<NoNeEntityIdComparator | string>; // requires counterpartyId
			counterpartyId: RepeatedFilter<NoNeEntityIdComparator | string>; // maps to 'account.id'
	  })
	| (AccountNftAllowancesBase & {
			tokenId?: undefined; // absent or undefined
			counterpartyId?: RepeatedFilter<NoNeEntityIdComparator | string>; // optional without tokenId
	  });

export interface AccountTokensQuery {
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** `token.id`; deployed Mirror Nodes support eq/gt/gte/lt/lte, but not `ne`. */
	tokenId?: RepeatedFilter<NoNeEntityIdComparator | string>;
	limit?: LimitValue;
	order?: Order; // server default asc
}

/** GET /api/v1/accounts/{idOrAliasOrEvmAddress}/nfts */
type AccountNftsOwnedBase = {
	/** Path account: id, alias, or evm */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;

	/** One equality or a lower/upper `token.id` range; no `ne`. */
	tokenId?: RepeatedFilter<NoNeEntityIdComparator | string>;

	/** Repeated spender filters; equality values plus at most one bound per direction. */
	spenderId?: RepeatedFilter<NoNeEntityIdComparator | string>;

	/** default 25 */
	limit?: LimitValue;

	/** default 'desc' (server default); pass 'asc' to override */
	order?: Order;
};

/**
 * `serialNumber` requires `tokenId`, as required by the account-NFT endpoint.
 */
export type AccountNftsOwnedQuery =
	| (AccountNftsOwnedBase & {
			serialNumber: RepeatedFilter<IntegerFilter>;
			tokenId: RepeatedFilter<NoNeEntityIdComparator | string>;
	  })
	| (AccountNftsOwnedBase & {
			serialNumber?: undefined;
	  });

export interface AccountRewardsQuery {
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** Reward timestamps support eq/gt/gte/lt/lte, but not `ne`. */
	timestamp?: NoNeTimestampFilter | readonly NoNeTimestampFilter[];
	limit?: LimitValue;
	order?: Order;
}

/** GET /api/v1/accounts/{id}/airdrops/outstanding */
export interface AccountOutstandingAirdropsQuery {
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm; // path
	receiverId?: RepeatedFilter<NoNeEntityIdComparator | string>; // -> receiver.id (up to two; no `ne`)
	tokenId?: RepeatedFilter<NoNeEntityIdComparator | string>; // -> token.id (up to two; no `ne`)
	/** Independent serial-number range; up to two occurrences and no `ne`. */
	serialNumber?: RepeatedFilter<JavaLongRangeFilter>;
	limit?: LimitValue;
	order?: Order; // default 'asc'
}

export interface AccountPendingAirdropsQuery {
	/** Path account (receiver) — id, alias, or evm */
	idOrAliasOrEvmAddress: AccountAliasOrIdOrEvm;
	/** Sender range -> `sender.id` (up to two occurrences; `ne` is rejected as an ineffective server no-op). */
	senderId?: RepeatedFilter<NoNeEntityIdComparator | string>;
	/** Numeric token range -> `token.id` (up to two occurrences; no `ne`). */
	tokenId?: RepeatedFilter<NoNeEntityIdComparator | string>;
	/** Independent serial-number range; up to two occurrences and no `ne`. */
	serialNumber?: RepeatedFilter<JavaLongRangeFilter>;
	limit?: LimitValue;
	/** Default 'asc' (server default) */
	order?: Order;
}

// -----------------------------
// Balances / Blocks / Schedules (existing)
// -----------------------------

export interface BalancesListQuery {
	accountId?: RepeatedFilter<EntityIdComparator | string>; // account.id
	accountBalance?: RepeatedFilter<AllIntegerFilter>; // account.balance
	accountPublicKey?: string; // account.publickey
	timestamp?: TimestampFilter | readonly TimestampFilter[]; // timestamp
	limit?: LimitValue; // default 25
	order?: Order; // default desc
}

export interface BlocksListQuery {
	/** block.number accepts eq|gt|gte|lt|lte (not ne). */
	blockNumber?: RepeatedFilter<BlockNumberFilter>;
	timestamp?: TimestampFilter | readonly TimestampFilter[]; // timestamp
	limit?: LimitValue; // default 25
	order?: Order; // default desc
}

export interface BlocksOneQuery {
	hashOrNumber: string | number;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

export interface SchedulesListQuery {
	accountId?: RepeatedFilter<EntityIdComparator | string>; // account.id
	scheduleId?: RepeatedFilter<EntityIdComparator | string>; // schedule.id
	limit?: LimitValue; // default 25
	order?: Order; // default asc
}

export interface SchedulesOneQuery {
	scheduleId: string; // EntityId
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

// -----------------------------
// NEW: Tokens & NFTs queries
// -----------------------------

/** Token-type filter values currently defined by Hedera, including `ALL`. */
export type KnownTokenTypeFilter = "ALL" | KnownTokenType | Lowercase<"ALL" | KnownTokenType>;

/**
 * Token-type query value. Known values retain autocomplete while arbitrary
 * strings permit values introduced by newer Mirror Nodes and Hedera forks.
 */
export type TokenTypeFilter = KnownTokenTypeFilter | (string & {});

/** GET /api/v1/tokens */
type TokensListQueryBase = {
	/** Exact account ID or EVM address. `/tokens` does not accept a comparator here. */
	accountId?: string; // account.id
	/** Filter by token id (comparator accepted by server) */
	tokenId?: RepeatedFilter<EntityIdComparator | string>; // token.id
	/** Filter by admin key (public key) */
	publicKey?: string; // publickey
	/**
	 * Filter by token name. Mutually exclusive with accountId and tokenId
	 * (server's "name" search).
	 */
	/** Token type filter */
	type?: TokenTypeFilter | readonly TokenTypeFilter[]; // repeated `type` query parameter
	limit?: LimitValue; // default 25
	order?: Order; // default asc
};

/**
 * `name` cannot be combined with `account.id` or `token.id`. The server also
 * disables link-based pagination for name searches.
 */
export type TokensListQuery =
	| (Omit<TokensListQueryBase, "accountId" | "tokenId"> & {
			name: string;
			accountId?: never;
			tokenId?: never;
	  })
	| (TokensListQueryBase & {
			name?: never;
	  });

/** GET /api/v1/tokens/{tokenId} */
export interface TokenOneQuery {
	tokenId: string; // request entity ID or long-zero Solidity address
	/**
	 * One or more timestamp occurrences (up to 100), supporting eq/lt/lte.
	 * The server uses the last occurrence after validating every value.
	 */
	timestamp?: RepeatedFilter<EqualOrLessTimestampFilter>;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/tokens/{tokenId}/balances */
export interface TokenBalancesQuery {
	tokenId: string; // request entity ID or long-zero Solidity address
	accountId?: RepeatedFilter<EntityIdComparator | string>; // account.id
	accountPublicKey?: string; // account.publickey
	accountBalance?: RepeatedFilter<AllIntegerFilter>; // account.balance
	timestamp?: TimestampFilter | readonly TimestampFilter[]; // timestamp
	limit?: LimitValue; // default 25
	order?: Order; // default desc
}

/** GET /api/v1/tokens/{tokenId}/nfts */
export interface TokenNftsListQuery {
	/** Path param */
	tokenId: string; // request entity ID or long-zero Solidity address

	/** Owner account id or EntityId comparator. */
	accountId?: RepeatedFilter<EntityIdComparator | string>; // maps to 'account.id'

	/**
	 * NFT serial number filter (requires tokenId, already in path).
	 * Accepts integer or any Mirror Node comparator, including `ne`.
	 */
	serialNumber?: RepeatedFilter<AllIntegerFilter>; // maps to 'serialnumber'

	limit?: LimitValue;
	order?: Order; // server default desc
}

/** GET /api/v1/tokens/{tokenId}/nfts/{serialNumber} */
export interface TokenNftOneQuery {
	tokenId: string; // request entity ID or long-zero Solidity address
	serialNumber: IntegerValue; // Int64
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/tokens/{tokenId}/nfts/{serialNumber}/transactions */
export interface TokenNftTransactionsQuery {
	tokenId: string; // request entity ID or long-zero Solidity address
	serialNumber: IntegerValue; // int64
	limit?: LimitValue;
	order?: Order;

	/** Consensus timestamp filter(s) (seconds or seconds.fraction with optional comparator) */
	timestamp?: TimestampFilter | readonly TimestampFilter[]; // maps to 'timestamp'
}

// -----------------------------
// NEW: Topics (HCS)
// -----------------------------

/**
 * Case-insensitive encoding filter for topic message payloads.
 *
 * Canonical lower- and uppercase spellings are exposed for autocomplete;
 * dynamically supplied mixed-case values are validated at runtime.
 */
export type TopicMessageEncoding = CaseInsensitive<"base64" | "utf8" | "utf-8">;

/** GET /api/v1/topics/{topicId} */
export interface TopicOneQuery {
	topicId: string; // EntityId
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/topics/{topicId}/messages */
export interface TopicMessagesListQuery {
	topicId: string; // EntityId
	encoding?: TopicMessageEncoding; // encoding
	/** Up to 100 repeated `sequencenumber` filters; supports eq|gt|gte|lt|lte (not ne). */
	sequenceNumber?: RepeatedFilter<IntegerFilter>; // sequencenumber
	/** `timestamp` supports eq/gt/gte/lt/lte, but not `ne`. */
	timestamp?: NoNeTimestampFilter | readonly NoNeTimestampFilter[]; // timestamp
	limit?: LimitValue; // default 25
	order?: Order; // default asc
}

/** GET /api/v1/topics/{topicId}/messages/{sequenceNumber} */
export interface TopicMessageBySequenceQuery {
	topicId: string; // EntityId
	sequenceNumber: IntegerValue; // Int64
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/topics/messages/{timestamp} */
export interface TopicMessageByTimestampQuery {
	/** Exact consensus seconds with an optional fractional part (no comparators). */
	timestamp: ExactTimestamp;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

// -----------------------------
// NEW: Transactions
// -----------------------------

/** Transaction result filter */
export type TransactionResultFilter = CaseInsensitive<"success" | "fail">;

/** Transfer direction filter */
export type TransferTypeFilter = CaseInsensitive<"credit" | "debit">;

/** GET /api/v1/transactions (list) */
export interface TransactionsListQuery {
	/** Up to 100 repeated account-ID/EVM-address filters. */
	accountId?: RepeatedFilter<EntityIdComparator | string>; // account.id
	timestamp?: TimestampFilter | readonly TimestampFilter[]; // timestamp
	transactiontype?: TransactionTypes; // documented values plus fork/forward-compatible strings
	result?: TransactionResultFilter; // success | fail
	type?: TransferTypeFilter; // credit | debit
	limit?: LimitValue; // default 25
	order?: Order; // default desc
}

/** GET /api/v1/transactions/{transactionId} */
export interface TransactionByIdQuery {
	/** Hedera transaction ID, or a 48-byte hash encoded as hex, Base64, or Base64URL. */
	transactionId: string;
	/** Up to 100 nonce occurrences; the server uses the last after validating all. */
	nonce?: RepeatedFilter<number>; // query param
	/** Up to 100 scheduled occurrences; the server uses the last after validating all. */
	scheduled?: RepeatedFilter<boolean>; // query param
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

// -----------------------------
// Network queries
// -----------------------------

/** GET /api/v1/network/supply */
export type NetworkSupplyType = CaseInsensitive<"circulating" | "totalcoins">;

export interface NetworkSupplyQuery {
	/** Up to two rest-java timestamp filters; the optional suffix is raw nanoseconds and `ne` is unsupported. */
	timestamp?: RepeatedFilter<JavaTimestampFilter>;
	/** Return only circulating or total supply as an HBAR-denominated decimal string. */
	q?: NetworkSupplyType;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** Return type selected by the optional `/network/supply` `q` mode. */
export type NetworkSupplyResult<Query> = Query extends undefined
	? NetworkSupplyResponse
	: Query extends { q: NetworkSupplyType }
		? string
		: Query extends object
			? "q" extends keyof Query
				? Query extends { q?: infer SupplyType }
					? [Exclude<SupplyType, undefined>] extends [never]
						? NetworkSupplyResponse
						: NetworkSupplyResponse | string
					: NetworkSupplyResponse | string
				: NetworkSupplyResponse
			: NetworkSupplyResponse | string;

/** GET /api/v1/network/fees */
export interface NetworkFeesQuery {
	/** Up to two rest-java timestamp filters; `ne` is not supported. */
	timestamp?: RepeatedFilter<JavaTimestampFilter>;
	/** default 'asc' on server */
	order?: Order;
}

/** GET /api/v1/network/exchangerate */
export interface NetworkExchangeRateQuery {
	/** Up to two rest-java timestamp filters; the optional suffix is raw nanoseconds and `ne` is unsupported. */
	timestamp?: RepeatedFilter<JavaTimestampFilter>;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/network/nodes */
export interface NetworkNodesQuery {
	/** Address-book file ID, optionally prefixed by the equality comparator only. */
	fileId?: string; // maps to 'file.id'
	/** Up to 100 node-ID integer/range values, e.g. 0, 5, or gte:10 (`ne` is not allowed). */
	nodeId?: RepeatedFilter<JavaLongRangeFilter>; // -> 'node.id' (up to 100; eq|gt|gte|lt|lte)
	/** Built-in public mirrors default to 10 and allow at most 25; custom endpoint policies are configurable. */
	limit?: LimitValue;
	/** default 'asc' */
	order?: Order;
}

/** Canonical protobuf media types accepted by `POST /api/v1/network/fees`. */
export type KnownProtobufContentType = "application/protobuf" | "application/x-protobuf";

/**
 * Protobuf request media type.
 *
 * HTTP media types are case-insensitive and commonly arrive as a dynamically
 * typed string. Known values retain autocomplete; runtime validation rejects
 * unsupported media types without excluding valid mixed-case spellings here.
 */
export type ProtobufContentType = KnownProtobufContentType | (string & {});

/** Case-insensitive fee-estimation mode accepted by the request endpoint. */
export type FeeEstimateModeInput = CaseInsensitive<FeeEstimateMode>;

/** Raw bytes of one protobuf `proto.Transaction` (not a `TransactionList`). */
export type ProtobufTransactionBytes = Uint8Array | ArrayBuffer;

/** POST /api/v1/network/fees */
export interface NetworkFeeEstimateRequest {
	/** Bytes of one protobuf HAPI `Transaction`; SDK `TransactionList` wrappers are not accepted by the REST endpoint. */
	transaction: ProtobufTransactionBytes;
	/** Estimation strategy; the server defaults to `INTRINSIC`. */
	mode?: FeeEstimateModeInput;
	/** Simulated high-volume throttle utilization in basis points (0..10000). */
	highVolumeThrottle?: number;
	/** Request media type; defaults to `application/protobuf`. */
	contentType?: ProtobufContentType;
}

/** GET /api/v1/network/registered-nodes */
export type RegisteredNodeTypeFilter = CaseInsensitive<RegisteredNodeType | "UNKNOWN">;

export interface NetworkRegisteredNodesQuery {
	/** Up to two registered-node ID range filters; accepts eq|gt|gte|lt|lte (not `ne`). */
	registeredNodeId?: RepeatedFilter<JavaLongRangeFilter>; // -> registerednode.id
	/**
	 * Restrict results to a registered service category. Query parsing is
	 * case-insensitive and also accepts records whose service type is unknown.
	 */
	type?: RegisteredNodeTypeFilter;
	/** Requested page size; defaults to 25 on the public Mirror Node. */
	limit?: LimitValue;
	/** Sort order; server default is `asc`. */
	order?: Order;
}

/** GET /api/v1/network/stake */
export interface NetworkStakeQuery {
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

// -----------------------------
// Contracts queries
// -----------------------------

/** Contract id or EVM address (0x...) accepted in path. */
export type ContractIdOrAddress = string;

/** GET /api/v1/contracts */
export interface ContractsListQuery {
	/** Filter by contract id, unprefixed 20-byte EVM address, or comparator -> `contract.id`. */
	contractId?: RepeatedFilter<EntityIdComparator | string>;
	limit?: LimitValue; // default 25
	order?: Order; // default desc
}

/** GET /api/v1/contracts/{idOrAddress} */
export interface ContractOneQuery {
	idOrAddress: ContractIdOrAddress;

	/**
	 * Optional consensus timestamp filter(s).
	 * Accepts number or string (integer seconds or seconds.fraction),
	 * with optional comparator strings (e.g., 'gte:1697000000', 'lt:1697600000.123456789').
	 */
	timestamp?: TimestampFilter | readonly TimestampFilter[];

	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

type ContractResultBlockFilters =
	| {
			transactionIndex: RepeatedFilter<number>;
			blockHash: RepeatedFilter<string>;
			blockNumber?: never;
	  }
	| {
			transactionIndex: RepeatedFilter<number>;
			blockHash?: never;
			blockNumber: RepeatedFilter<EqualityIntegerFilter>;
	  }
	| {
			transactionIndex?: never;
			blockHash: RepeatedFilter<string>;
			blockNumber?: never;
	  }
	| {
			transactionIndex?: never;
			blockHash?: never;
			blockNumber: RepeatedFilter<EqualityIntegerFilter>;
	  }
	| {
			transactionIndex?: never;
			blockHash?: never;
			blockNumber?: never;
	  };

type ContractResultsListBase = {
	/** Sender account ID/EVM address, optionally prefixed by any standard comparator. */
	from?: RepeatedFilter<string>;

	/** Include child transactions (internal). Default false. */
	internal?: boolean;

	/**
	 * Return monetary fields in tinybars when true, or weibars when false.
	 * Mirror Node defaults to true when omitted.
	 */
	hbar?: boolean;

	/** Standard consensus timestamp filter(s). */
	timestamp?: TimestampFilter | readonly TimestampFilter[];

	/** Pagination / sort */
	limit?: LimitValue; // default 25
	order?: Order; // default 'desc'
};

/** GET /api/v1/contracts/results */
export type ContractResultsListQuery = ContractResultsListBase & ContractResultBlockFilters;

type ContractResultsByContractBase = {
	/** Path: contract id (0.0.x) or EVM address (0x...) */
	idOrAddress: ContractIdOrAddress;

	/** Standard consensus timestamp filter(s) */
	timestamp?: TimestampFilter | readonly TimestampFilter[];

	/** Sender account ID/EVM address, optionally prefixed by any standard comparator. */
	from?: RepeatedFilter<string>;

	/** Include child (internal) contract transactions. Default false. */
	internal?: boolean;

	/** Pagination / sort (server defaults: limit=25, order='desc') */
	limit?: LimitValue;
	order?: Order;
};

/** GET /api/v1/contracts/{idOrAddress}/results */
export type ContractResultsByContractQuery = ContractResultsByContractBase & ContractResultBlockFilters;

/** GET /api/v1/contracts/{idOrAddress}/results/{timestamp} */
export interface ContractResultByTimestampQuery {
	/** Request entity ID (`num`, `realm.num`, or `shard.realm.num`) or EVM address. */
	idOrAddress: ContractIdOrAddress;

	/** Exact execution seconds with an optional fractional part. */
	timestamp: string;

	/**
	 * Return monetary fields in tinybars when true, or weibars when false.
	 * Mirror Node defaults to true when omitted.
	 */
	hbar?: boolean;

	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/** GET /api/v1/contracts/results/{transactionIdOrHash}/opcodes */
export interface ContractOpcodesQuery {
	/** TransactionIdStr (0.0.x-sec-nanos) or 0x + 64 hex hash */
	transactionIdOrHash: string;

	/**
	 * If provided and set to false, stack information will not be included.
	 * Server default: true (include stack)
	 */
	stack?: boolean;

	/**
	 * If provided and set to true, memory information will be included.
	 * Server default: false
	 */
	memory?: boolean;

	/**
	 * If provided and set to true, storage information will be included.
	 * Server default: false
	 */
	storage?: boolean;
}

/** UPDATE: allow hash OR txId for the “result by transaction” call */
export interface ContractResultByTransactionQuery {
	/** Transaction Id '0.0.x-<sec>-<nanos>' or a 32‑byte hex hash (with optional 0x) */
	transactionIdOrHash: string;

	/**
	 * Filter by the transaction nonce (int32). If multiple are provided,
	 * the server honors the LAST value; we mirror that.
	 */
	nonce?: IntegerValue | readonly IntegerValue[];

	/**
	 * Return monetary fields in tinybars when true, or weibars when false.
	 * Mirror Node defaults to true when omitted.
	 */
	hbar?: boolean;

	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

/**
 * @deprecated There is no corresponding operation in the current Mirror Node
 * REST API. Use `ContractResultByTransactionQuery` or
 * `ContractResultByTimestampQuery` explicitly.
 */
export interface ContractResultSmartQuery {
	/**
	 * One of:
	 *  - TransactionIdStr: 0.0.x-<seconds>-<nanos>
	 *  - 32-byte tx hash: 0x + 64 hex
	 *  - Exact execution timestamp: 'seconds.nanoseconds'
	 */
	txIdOrHashOrTimestamp: string;
	/** Allow this request to return an existing cached response. */
	useCache?: boolean;
}

type ContractLogDependentFilters =
	| {
			/** Topic filters contain 1..64 hex digits with an optional `0x` prefix. */
			topic0?: string | readonly string[];
			topic1?: string | readonly string[];
			topic2?: string | readonly string[];
			topic3?: string | readonly string[];
			index?: RepeatedFilter<IntegerFilter>;
			/** Topic and index filters require a timestamp query. */
			timestamp: NoNeTimestampFilter | readonly NoNeTimestampFilter[];
	  }
	| {
			topic0?: never;
			topic1?: never;
			topic2?: never;
			topic3?: never;
			index?: never;
			timestamp?: undefined;
	  };

type ContractLogsListBase = {
	/**
	 * Filter by transaction hash (eq only). Accepts 32‑byte Ethereum or 48‑byte Hedera hash,
	 * with optional 0x prefix, and optional 'eq:' prefix.
	 */
	transactionHash?: string;

	limit?: LimitValue;
	/** Default is 'desc' for this endpoint (per docs). */
	order?: Order;
};

/** GET /api/v1/contracts/results/logs */
export type ContractLogsListQuery = ContractLogsListBase & ContractLogDependentFilters;

type ContractLogsByContractBase = {
	idOrAddress: ContractIdOrAddress;
	limit?: LimitValue;
	order?: Order; // default desc
};

/** GET /api/v1/contracts/{idOrAddress}/results/logs */
export type ContractLogsByContractQuery = ContractLogsByContractBase & ContractLogDependentFilters;

/** GET /api/v1/contracts/{idOrAddress}/state */
export interface ContractStateQuery {
	idOrAddress: ContractIdOrAddress;
	/** Up to 100 hex slot filters, optionally prefixed with eq/gt/gte/lt/lte. */
	slot?: RepeatedFilter<string>;
	/** State timestamps support eq/gt/gte/lt/lte, but not `ne`. */
	timestamp?: NoNeTimestampFilter | readonly NoNeTimestampFilter[];
	limit?: LimitValue;
	order?: Order; // default asc
}

/**
 * @deprecated `contracts().call()` accepts `ContractCallRequest` directly; this
 * wrapper is retained only for source compatibility.
 */
export interface ContractCallQuery {
	/** Body must conform to ContractCallRequest */
	body: ContractCallRequest;
}

export interface ContractResultActionsQuery {
	/** Either TransactionIdStr (0.0.x-sec-nanos) or 0x + 64 hex hash */
	transactionIdOrHash: string;
	/** Up to 100 action-index filters (supports comparators like 'gte:10'). */
	index?: RepeatedFilter<IntegerFilter>;
	/** default 25 */
	limit?: LimitValue;
	/** default 'asc' */
	order?: Order;
}

/**
 * @deprecated The current Mirror Node REST API has no
 * `/contracts/results/{transactionIdOrHash}/state-changes` operation.
 */
export interface ContractResultStateChangesQuery {
	/** Either TransactionIdStr (0.0.x-sec-nanos) or 0x + 64 hex hash */
	transactionIdOrHash: string;
}

// ============================> Next Page
export interface PageLimitConfig {
	/** Value used when caller passes limit: 'default' */
	defaultLimit?: number; // e.g., 25 for public, 100 for your preferred default
	/** Upper bound; we clamp any number to this (and log when clamped) */
	maxLimit?: number; // e.g., 100 (public), 200 (arkhia)
}

export interface PageConfig extends PageLimitConfig {
	/**
	 * Optional limits for operations whose server contract differs from the
	 * provider-wide page policy. Endpoint names are forward-compatible; the
	 * current client consumes `network.nodes`.
	 */
	endpoints?: Readonly<Record<string, PageLimitConfig>>;
}

/**
 * `next()` returns the next page or `null`; `next.url()` returns the canonical
 * URL on the page's current provider before any new overflow/failover decision.
 */
export type NextPageFn<T> = ((opts?: RequestOptions) => Promise<T | null>) & {
	url(): string | null;
};

/**
 * Generic collection page. The raw Mirror Node paging links are retained while
 * `next()` provides the provider-aware typed paging helper.
 */
export type PageOf<K extends string, Item, Extras extends object = {}, RequiresLinks extends boolean = false> = { [P in K]: Item[] } &
	Extras & {
		next: NextPageFn<PageOf<K, Item, Extras, RequiresLinks>>;
	} & (RequiresLinks extends true ? { links: Links } : { links?: Links });

/** Pages */
// Accounts and relationships
export type AccountsPage = PageOf<"accounts", AccountInfo, {}, true>;
/**
 * A single-account response with its embedded transaction history pagination.
 *
 * The raw Mirror Node fields, including `links`, are retained for backwards
 * compatibility while `next()` exposes the same typed paging ergonomics as
 * collection endpoints.
 */
export type AccountBalanceTransactionsPage = AccountBalanceTransactions & {
	next: NextPageFn<AccountBalanceTransactionsPage>;
};
export type AccountHooksPage = PageOf<"hooks", Hook, {}, true>;
export type AccountHookStoragePage = PageOf<"storage", HookStorage, { hook_id: Int64; owner_id: EntityIdNullable }, true>;
export type AccountTokensPage = PageOf<"tokens", TokenRelationship>;
export type AccountNFTsPage = PageOf<"nfts", Nft>;
export type AccountRewardsPage = PageOf<"rewards", StakingReward>;
export type CryptoAllowancesPage = PageOf<"allowances", CryptoAllowance>;
export type TokenAllowancesPage = PageOf<"allowances", TokenAllowance>;
export type NFTAllowancesPage = PageOf<"allowances", NftAllowance>;
export type AccountAirdropsPage = PageOf<"airdrops", TokenAirdrop>;

export type TokensPage = PageOf<"tokens", Token>;
export type TokenBalancesPage = PageOf<"balances", TokenDistributionItem, { timestamp?: TimestampNullable }>;
export type TokenNftsPage = PageOf<"nfts", Nft>;
export type NftTransactionsPage = PageOf<"transactions", NftTransactionTransfer, {}, true>;

export type TransactionsPage = PageOf<"transactions", Transaction>;
export type TopicMessagesPage = PageOf<"messages", TopicMessage>;
export type BlocksPage = PageOf<"blocks", Block>;
export type SchedulesPage = PageOf<"schedules", Schedule>;

export type ContractsPage = PageOf<"contracts", Contract>;
export type ContractsResultsPage = PageOf<"results", ContractResult>;
export type ContractLogsPage = PageOf<"logs", ContractLog>;
export type ContractActionsPage = PageOf<"actions", ContractAction>;
/**
 * Contract-state response with normalized state rows and paging helpers.
 * Raw response fields such as `links` are retained for compatibility.
 */
export type ContractStatePage = ContractStateResponse & {
	state: ContractState[];
	next: NextPageFn<ContractStatePage>;
};
/** Balances carry an extra 'timestamp' field */
export type BalancesPage = PageOf<"balances", AccountBalance, { timestamp?: TimestampNullable }>;
/** Network-nodes response with its raw `links` and typed paging helpers. */
export type NetworkNodesPage = NetworkNodesResponse & {
	next: NextPageFn<NetworkNodesPage>;
};
export type RegisteredNodesPage = PageOf<"registered_nodes", RegisteredNode, {}, true>;
