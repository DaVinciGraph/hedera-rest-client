/* =========================
   Primitive / String Aliases
   ========================= */

/** Lossless signed-int64 JSON value. Unsafe values are decoded as decimal strings. */
export type Int64 = number | `${bigint}`;

/** Request-side int64 value; large values should be supplied as decimal strings. */
export type Int64Input = Int64;

/** Non-negative int64 value. Runtime responses use a number when safe and a decimal string otherwise. */
export type PositiveNumber = Int64;

/**
 * Network entity ID in the format shard.realm.num.
 *
 * The Mirror Node response component is nullable. Request/path identifiers use
 * separate non-null query aliases in `types/index.ts`.
 */
export type EntityId = string | null; // canonical response form: shard.realm.num

/** @deprecated `EntityId` already includes `null`; retained for compatibility. */
export type EntityIdNullable = EntityId;

/** RFC4648 no-padding base32 encoded account alias (nullable). */
export type Alias = string | null; // pattern: ^(?:[A-Z2-7]{8})*(?:[A-Z2-7]{2}|[A-Z2-7]{4,5}|[A-Z2-7]{7,8})$

/** Account alias in `shard.realm.alias`, `realm.alias`, or bare RFC4648 no-padding base32 form. */
export type AccountAlias = string;

/** EntityId query filter syntax, e.g., `100`, `0.100`, `0.0.100`, or `gte:0.0.100`. */
export type EntityIdQuery = string;

/** Timestamp as seconds with an optional fractional part. */
export type Timestamp = string; // pattern: ^\d{1,10}(\.\d{1,9})?$

/** Nullable timestamp as seconds with an optional fractional part. */
export type TimestampNullable = string | null; // pattern: ^\d{1,10}(\.\d{1,9})?$

/** EVM address (40 hex chars, with optional 0x), often shown without 0x in examples */
export type EvmAddress = string; // pattern: ^(0x)?[A-Fa-f0-9]{40}$, minLength: 40, maxLength: 42

/** EVM address with an optional validated shard/realm prefix. */
export type EvmAddressWithShardRealm = string;

/** Nullable EVM address */
export type EvmAddressNullable = string | null; // pattern: ^(0x)?[A-Fa-f0-9]{40}$, minLength: 40, maxLength: 42

/** Bloom filter hex string (nullable where used) */
export type Bloom = string | null; // example: 0x549358c4c2e573e02410ef7b5a5ffa5f36dd7398

/** Hex-encoded Hedera transaction hash */
export type HederaHash = string; // pattern: ^(0x)?[A-Fa-f0-9]{96}$, minLength: 96, maxLength: 98

/** Hex-encoded Ethereum transaction hash */
export type EthereumHash = string; // pattern: ^(0x)?[A-Fa-f0-9]{64}$, minLength: 64, maxLength: 66

/** Transaction id string, e.g., 0.0.8-1234567890-000000006 */
export type TransactionIdStr = string; // pattern: ^(\d+)\.(\d+)\.(\d+)-(\d{1,19})-(\d{1,9})$

/** Topic log topic query param list (hex topic items) */
export type LogTopicQueryParam = string[]; // item pattern: ^(0x)?[0-9A-Fa-f]{1,64}$

/* =============
   Common Blocks
   ============= */

/** Link container for paging. */
export interface Links {
	/** Next page link (nullable). */
	next?: string | null;
}

/** A timestamp range an entity is valid for. */
export interface TimestampRange {
	/** Inclusive from timestamp in seconds. */
	from?: Timestamp;
	/** Exclusive to timestamp in seconds (nullable). */
	to?: TimestampNullable;
}

/** Nullable timestamp range. */
export type TimestampRangeNullable = TimestampRange | null;

/** Public key controlling access to entities. The response component is nullable. */
export type Key = {
	/** One of ECDSA_SECP256K1 | ED25519 | ProtobufEncoded */
	_type?: "ECDSA_SECP256K1" | "ED25519" | "ProtobufEncoded";
	/** Key material; format depends on _type. */
	key?: string;
} | null;

/** A network/service endpoint. */
export interface ServiceEndpoint {
	domain_name: string;
	ip_address_v4: string;
	port: number; // int32
}
export type ServiceEndpoints = ServiceEndpoint[];

/** Exchange rate entry. */
export interface ExchangeRate {
	cent_equivalent?: number; // int32
	expiration_time?: Int64;
	hbar_equivalent?: number; // int32
}

/* ==================
   Accounts & Balances
   ================== */

/** Token balance entry used in balances. */
export interface TokenBalance {
	token_id: EntityId; // non-null in this context
	balance: Int64;
}

/** Balance record (nullable as a whole in some responses). */
export type Balance = {
	/** seconds.nanoseconds (nullable value) */
	timestamp: TimestampNullable;
	balance: Int64 | null;
	tokens: Array<{
		token_id?: EntityId;
		balance?: Int64;
	}>;
} | null;

/** Full account record. */
export interface AccountInfo {
	account: EntityId;
	alias: Alias; // nullable
	auto_renew_period: Int64 | null;
	balance: Balance;
	created_timestamp: TimestampNullable;
	/** Whether the account declines receiving a staking reward. */
	decline_reward: boolean;
	/**
	 * EVM delegation address. The deployed public API omits this field when no
	 * delegation exists even though the OpenAPI marks it required.
	 */
	delegation_address?: EvmAddressNullable;
	deleted: boolean | null;
	ethereum_nonce: Int64 | null;
	evm_address: EvmAddressNullable;
	expiry_timestamp: TimestampNullable;
	key: Key | null;
	max_automatic_token_associations: number | null; // int32
	memo: string | null;
	/** Pending reward (tinybars). Updated at end of each staking period. */
	pending_reward?: Int64;
	receiver_sig_required: boolean | null;
	/** The account to which this account is staking. */
	staked_account_id: string | null; // canonical response form: shard.realm.num
	/** The id of the node to which this account is staking. */
	staked_node_id: Int64 | null;
	/** Staking period marker (seconds.nanoseconds). */
	stake_period_start: TimestampNullable;
}

/** Array alias for accounts. */
export type Accounts = AccountInfo[];

/** Accounts list response. */
export interface AccountsResponse {
	accounts: Accounts;
	links: Links;
}

/** Single account balance entry used in BalancesResponse. */
export interface AccountBalance {
	account: EntityId; // non-null here
	balance: Int64;
	tokens: TokenBalance[];
}

/** Balances page. */
export interface BalancesResponse {
	timestamp?: TimestampNullable;
	balances?: AccountBalance[];
	links?: Links;
}

/** Account + recent transactions response row. */
export interface AccountBalanceTransactions extends AccountInfo {
	transactions: Transactions;
	links: Links;
}

/** Account hook returned by `GET /api/v1/accounts/{id}/hooks`. */
export interface Hook {
	/** Public key controlling administration of the hook. */
	admin_key: Key | null;
	/** Contract entity containing the hook's executable bytecode. */
	contract_id: EntityIdNullable;
	/** Consensus timestamp at which the hook was created. */
	created_timestamp: TimestampNullable;
	/** Whether the hook has been deleted. */
	deleted: boolean;
	/** Extension point implemented by the hook. */
	extension_point: "ACCOUNT_ALLOWANCE_HOOK";
	/** Identifier unique within the owning entity's scope. */
	hook_id: Int64;
	/** Entity that owns the hook. */
	owner_id: EntityIdNullable;
	/** Time range during which this hook version is valid. */
	timestamp_range: TimestampRangeNullable;
	/** Hook implementation type. */
	type: "EVM";
}

/** Raw paginated account-hooks response. */
export interface HooksResponse {
	hooks: Hook[];
	links: Links;
}

/** One historical/current storage slot belonging to an account hook. */
export interface HookStorage {
	/** Storage key encoded as a binary/hex string. */
	key: string;
	/** Consensus timestamp at which this slot value became valid. */
	timestamp: Timestamp;
	/** Storage value encoded as a binary/hex string, or `null`. */
	value: string | null;
}

/** Raw paginated hook-storage response. */
export interface HooksStorageResponse {
	/** Identifier of the hook whose slots are returned. */
	hook_id: Int64;
	links: Links;
	/** Entity that owns the hook. */
	owner_id: EntityIdNullable;
	storage: HookStorage[];
}

/* ===========================
   Tokens, NFTs, Fees & Airdrop
   =========================== */

/** Custom fee schedule container. */
export interface CustomFees {
	created_timestamp?: Timestamp;
	fixed_fees?: FixedFee[];
	fractional_fees?: FractionalFee[];
	royalty_fees?: RoyaltyFee[];
}

/** Fixed fee. */
export interface FixedFee {
	all_collectors_are_exempt?: boolean;
	amount?: Int64;
	collector_account_id?: EntityId;
	denominating_token_id?: EntityId;
}

/** Cap for max fees per account/token in a tx. */
export interface CustomFeeLimit {
	account_id?: EntityId;
	amount?: Int64;
	denominating_token_id?: EntityId;
}

/** Fractional fee. */
export interface FractionalFee {
	all_collectors_are_exempt?: boolean;
	amount?: { numerator?: Int64; denominator?: Int64 };
	collector_account_id?: EntityId;
	denominating_token_id?: EntityId;
	maximum?: Int64 | null;
	minimum?: Int64;
	net_of_transfers?: boolean;
}

/** Royalty fee for NFTs (with optional fallback fixed fee). */
export interface RoyaltyFee {
	all_collectors_are_exempt?: boolean;
	amount?: { numerator?: Int64; denominator?: Int64 };
	collector_account_id?: EntityId;
	fallback_fee?: {
		amount?: Int64;
		denominating_token_id?: EntityId;
	} | null;
}

/** Token types currently defined by Hedera. */
export type KnownTokenType = "FUNGIBLE_COMMON" | "NON_FUNGIBLE_UNIQUE";

/**
 * Token type returned by a Mirror Node.
 *
 * Known values retain editor autocomplete while the open string member keeps
 * clients compatible with future Hedera values and provider-specific forks.
 */
export type TokenType = KnownTokenType | (string & {});

/** Token (search/list view). */
export interface Token {
	admin_key: Key;
	decimals: Int64;
	/** Base64 arbitrary metadata for the token class. */
	metadata?: string; // ($byte)
	name: string;
	symbol: string;
	token_id: EntityId;
	type: TokenType;
}

/** Tokens array alias. */
export type Tokens = Token[];

/** Tokens response page. */
export interface TokensResponse {
	tokens?: Tokens;
	links?: Links;
}

/** Detailed token info. */
export interface TokenInfo {
	admin_key?: Key;
	auto_renew_account?: EntityId;
	auto_renew_period?: Int64 | null;
	created_timestamp?: Timestamp;
	decimals?: string;
	deleted?: boolean | null;
	expiry_timestamp?: Int64 | null;
	fee_schedule_key?: Key;
	freeze_default?: boolean;
	freeze_key?: Key;
	initial_supply?: string;
	kyc_key?: Key;
	max_supply?: string;
	/** Base64 arbitrary metadata for the token class. */
	metadata?: string;
	/** Metadata key that can update token metadata and individual NFTs. */
	metadata_key?: Key;
	modified_timestamp?: Timestamp;
	name?: string;
	memo?: string;
	pause_key?: Key;
	/** NOT_APPLICABLE | PAUSED | UNPAUSED */
	pause_status?: "NOT_APPLICABLE" | "PAUSED" | "UNPAUSED";
	supply_key?: Key;
	/** FINITE | INFINITE */
	supply_type?: "FINITE" | "INFINITE";
	symbol?: string;
	token_id?: EntityId;
	total_supply?: string;
	treasury_account_id?: EntityId;
	/** FUNGIBLE_COMMON | NON_FUNGIBLE_UNIQUE */
	type?: TokenType;
	wipe_key?: Key;
	custom_fees?: CustomFees;
}

/** Token relationship entry (per account). */
export interface TokenRelationship {
	/** Implicit vs explicit association. */
	automatic_association: boolean | null;
	/** For fungible: smallest denomination; for NFT: count of NFTs. */
	balance: Int64;
	created_timestamp: TimestampNullable;
	decimals: Int64 | null;
	/** NOT_APPLICABLE | FROZEN | UNFROZEN */
	freeze_status: "NOT_APPLICABLE" | "FROZEN" | "UNFROZEN" | null;
	/** NOT_APPLICABLE | GRANTED | REVOKED */
	kyc_status: "NOT_APPLICABLE" | "GRANTED" | "REVOKED";
	token_id: EntityId;
}

/** Token relationships page for an account. */
export interface TokenRelationshipResponse {
	tokens?: TokenRelationship[];
	links?: Links;
}

/** Airdrop item. */
export interface TokenAirdrop {
	amount: Int64;
	receiver_id: EntityId;
	sender_id: EntityId;
	serial_number?: Int64 | null;
	timestamp: TimestampRange;
	token_id: EntityId;
}

/** Token airdrops array alias. */
export type TokenAirdrops = TokenAirdrop[];

/** Token airdrops response page. */
export interface TokenAirdropsResponse {
	airdrops?: TokenAirdrops;
	links?: Links;
}

/** HBAR allowance (crypto). */
export interface CryptoAllowance {
	/** Remaining amount (tinybars). */
	amount?: Int64;
	/** Granted amount (tinybars). */
	amount_granted?: Int64;
	owner?: EntityId;
	spender?: EntityId;
	timestamp?: TimestampRange;
}
export type CryptoAllowances = CryptoAllowance[];

/** Crypto allowances response page. */
export interface CryptoAllowancesResponse {
	allowances?: CryptoAllowances;
	links?: Links;
}

/** Generic allowance (non-crypto variant used by some views). */
export interface Allowance {
	amount?: Int64;
	amount_granted?: Int64;
	owner?: EntityId;
	spender?: EntityId;
	timestamp?: TimestampRange;
}

/** Token allowance. */
export interface TokenAllowance {
	amount?: Int64;
	amount_granted?: Int64;
	owner?: EntityId;
	spender?: EntityId;
	timestamp?: TimestampRange;
	token_id?: EntityId;
}
export type TokenAllowances = TokenAllowance[];

/** Token allowances response page. */
export interface TokenAllowancesResponse {
	allowances?: TokenAllowances;
	links?: Links;
}

/** NFT record. */
export interface Nft {
	account_id?: EntityId;
	created_timestamp?: TimestampNullable;
	delegating_spender?: EntityId;
	/** Whether the NFT or its token has been deleted. */
	deleted?: boolean;
	/** Base64 arbitrary binary data. */
	metadata?: string;
	modified_timestamp?: TimestampNullable;
	serial_number?: Int64;
	spender?: EntityId;
	token_id?: EntityId;
}

/** NFTs response page. */
export interface Nfts {
	nfts?: Nft[];
	links?: Links;
}

/** NFT allowance (spender for all NFTs of owner). */
export interface NftAllowance {
	/** Spender approved for all NFTs owned by the owner. */
	approved_for_all: boolean;
	owner: EntityId;
	/** Network entity ID (nullable) */
	spender: EntityId | null;
	timestamp: TimestampRange;
	token_id: EntityId;
}
export type NftAllowances = NftAllowance[];

/** NFT allowances response page. */
export interface NftAllowancesResponse {
	allowances?: NftAllowances;
	links?: Links;
}

/** NFT transfer row for history. */
export interface NftTransactionTransfer {
	consensus_timestamp: Timestamp;
	is_approval: boolean;
	nonce: number; // >= 0
	receiver_account_id: EntityId;
	sender_account_id: EntityId;
	transaction_id: TransactionIdStr;
	type: TransactionTypes;
}

/** NFT transaction history page. */
export interface NftTransactionHistory {
	transactions: NftTransactionTransfer[];
	links: Links;
}

/* ====================
   Token distributions
   ==================== */

/**
 * Token distribution list (the schema reuses the same name for the list and item,
 * so we keep the public name as the array and inline the item shape).
 */
export interface TokenDistributionItem {
	/** Network entity ID in the format shard.realm.num (nullable allowed by pattern note). */
	account: EntityId;
	balance: Int64;
	decimals: Int64 | null;
}

/** The OpenAPI `TokenDistribution` component is an array of distribution rows. */
export type TokenDistribution = TokenDistributionItem[];

/** @deprecated Use `TokenDistribution`; retained as a compatibility alias. */
export type TokenDistributions = TokenDistribution;

/** Token balances (per token) response. */
export interface TokenBalancesResponse {
	timestamp?: TimestampNullable;
	balances?: TokenDistribution;
	links?: Links;
}

/* ==============
   Network & Stake
   ============== */

/** Network fee row. */
export interface NetworkFee {
	/** Gas cost in tinybars. */
	gas?: Int64;
	/** Transaction type (string label). */
	transaction_type?: string;
}
export type NetworkFees = NetworkFee[];

/** Network fees snapshot. */
export interface NetworkFeesResponse {
	fees?: NetworkFees;
	/** seconds.nanoseconds */
	timestamp?: Timestamp;
}

/** Strategy used by the transaction fee-estimation endpoint. */
export type FeeEstimateMode = "INTRINSIC" | "STATE";

/** An additional usage-based fee within a node or service fee component. */
export interface FeeExtra {
	/** Number of units charged after the included allowance. */
	charged: Int64;
	/** Total number of units present in the transaction. */
	count: Int64;
	/** Price per charged unit, in tinycents. */
	fee_per_unit: Int64;
	/** Number of units included without an additional charge. */
	included: Int64;
	/** Fee-schedule name for this extra. */
	name: string;
	/** Extra-fee subtotal, in tinycents. */
	subtotal: Int64;
}

/** Node or service portion of a transaction fee estimate. */
export interface FeeEstimate {
	/** Base fee, in tinycents. */
	base: Int64;
	/** Usage-based additions to the base fee. */
	extras: FeeExtra[];
}

/** Network portion of a transaction fee estimate. */
export interface FeeEstimateNetwork {
	/** Multiplier applied to the node fee. */
	multiplier: number;
	/** Network-fee subtotal, in tinycents. */
	subtotal: Int64;
}

/** Response from `POST /api/v1/network/fees`. */
export interface FeeEstimateResponse {
	/** HIP-1313 high-volume multiplier; `1` means no high-volume pricing. */
	high_volume_multiplier: Int64;
	network: FeeEstimateNetwork;
	node: FeeEstimate;
	service: FeeEstimate;
	/** Sum of the network, node, and service subtotals, in tinycents. */
	total: Int64;
}

/** Network node row (address book). */
export interface NetworkNode {
	admin_key: Key;
	/** Registered service identifiers associated with this consensus node. */
	associated_registered_nodes: Int64[];
	/** Whether the node wants to receive staking rewards. */
	decline_reward: boolean | null;
	/** Memo associated with the address book entry. */
	description: string | null;
	file_id: EntityIdNullable;
	/** The deployed public API can return `null` for nodes without a gRPC proxy. */
	grpc_proxy_endpoint: ServiceEndpoint | null;
	/** Maximum stake (rewarded or not) this node can have as consensus weight. */
	max_stake: Int64 | null;
	memo: string | null;
	/** Minimum stake required before non-zero consensus weight. */
	min_stake: Int64 | null;
	node_account_id: EntityIdNullable;
	node_id: Int64;
	/** Hex-encoded hash of the node's TLS certificate. */
	node_cert_hash: string | null;
	/** Hex-encoded X509 RSA public key used to verify stream file signature. */
	public_key: string | null;
	/** Total tinybars earned by this node per whole hbar in last staking period. */
	reward_rate_start: Int64 | null;
	service_endpoints: ServiceEndpoints;
	/** Node consensus weight at beginning of staking period. */
	stake: Int64 | null;
	/** Sum for accounts staked with declineReward=true. */
	stake_not_rewarded: Int64 | null;
	/** Sum for accounts not declining rewards. */
	stake_rewarded: Int64 | null;
	/** Staking period range (nullable). */
	staking_period: TimestampRange | null;
	timestamp: TimestampRange;
}
export type NetworkNodes = NetworkNode[];

/** Network nodes page. */
export interface NetworkNodesResponse {
	nodes: NetworkNodes;
	links: Links;
}

/** API capability advertised by a registered block-node endpoint. */
export type RegisteredBlockNodeApi = "OTHER" | "STATUS" | "PUBLISH" | "SUBSCRIBE_STREAM" | "STATE_PROOF" | "UNRECOGNIZED";

/** Block-node-specific metadata attached to a registered service endpoint. */
export interface RegisteredBlockNodeEndpoint {
	endpoint_apis?: RegisteredBlockNodeApi[];
}

/** General-service-specific metadata attached to a registered service endpoint. */
export interface RegisteredGeneralServiceEndpoint {
	description?: string;
}

/**
 * Mirror-node-specific registered endpoint metadata.
 *
 * The current REST schema defines this as an open object without named fields.
 */
export type RegisteredMirrorNodeEndpoint = Record<string, unknown>;

/**
 * JSON-RPC-relay-specific registered endpoint metadata.
 *
 * The current REST schema defines this as an open object without named fields.
 */
export type RegisteredRpcRelayEndpoint = Record<string, unknown>;

/** Registered service category. */
export type RegisteredNodeType = "BLOCK_NODE" | "GENERAL_SERVICE" | "MIRROR_NODE" | "RPC_RELAY";

interface RegisteredServiceEndpointBase {
	/** Metadata for a block-node endpoint, otherwise `null`. */
	block_node: RegisteredBlockNodeEndpoint | null;
	/** Metadata for a general-service endpoint, otherwise `null`. */
	general_service: RegisteredGeneralServiceEndpoint | null;
	/** Metadata for a mirror-node endpoint, otherwise `null`. */
	mirror_node: RegisteredMirrorNodeEndpoint | null;
	/** Service port in the inclusive range 0..65535. */
	port: number;
	/** Whether clients must use TLS when connecting to this endpoint. */
	requires_tls: boolean;
	/** Metadata for a JSON-RPC relay endpoint, otherwise `null`. */
	rpc_relay: RegisteredRpcRelayEndpoint | null;
	/** Registered service category. */
	type: RegisteredNodeType;
}

/**
 * A registered service endpoint.
 *
 * The OpenAPI schema requires at least one of `domain_name` and `ip_address`
 * to be present. Either value can be `null` on the wire.
 */
export type RegisteredServiceEndpoint = RegisteredServiceEndpointBase &
	(
		| { domain_name: string | null; ip_address?: string | null }
		| { domain_name?: string | null; ip_address: string | null }
	);

/** Registered service endpoints belonging to a registered node. */
export type RegisteredServiceEndpoints = RegisteredServiceEndpoint[];

/** A node or service registered on the network. */
export interface RegisteredNode {
	admin_key: Key | null;
	created_timestamp: TimestampNullable;
	description: string | null;
	registered_node_id: Int64;
	service_endpoints: RegisteredServiceEndpoints;
	timestamp: TimestampRange;
}

/** Registered-node list returned by the REST API. */
export type RegisteredNodes = RegisteredNode[];

/** Raw paginated response from `GET /api/v1/network/registered-nodes`. */
export interface RegisteredNodesResponse {
	registered_nodes: RegisteredNodes;
	links: Links;
}

/** Network exchange rates set. */
export interface NetworkExchangeRateSetResponse {
	current_rate?: ExchangeRate;
	next_rate?: ExchangeRate;
	timestamp?: Timestamp;
}

/** Network stake metrics snapshot. */
export interface NetworkStakeResponse {
	/** Max tinybars staked for reward while still getting max per-hbar rate. */
	max_stake_rewarded: Int64;
	/** Max reward rate (tinybars per whole hbar) any account can receive in a day. */
	max_staking_reward_rate_per_hbar: Int64;
	/** Total tinybars to be paid as staking rewards in the ending period. */
	max_total_reward: Int64;
	/** Fraction of network/service fees paid to node reward account 0.0.801. */
	node_reward_fee_fraction: number; // float
	/** Pending rewards reserved in 0.0.800. */
	reserved_staking_rewards: Int64;
	/** Unreserved tinybar balance of 0.0.800 to achieve max per-hbar rate. */
	reward_balance_threshold: Int64;
	/** Total staked tinybars at start of current period. */
	stake_total: Int64;
	/** Staking period window. */
	staking_period: TimestampRange;
	/** Minutes in a staking period. */
	staking_period_duration: Int64;
	/** Number of periods for which reward is stored per node. */
	staking_periods_stored: Int64;
	/** Fraction of fees paid to staking reward account 0.0.800. */
	staking_reward_fee_fraction: number; // float
	/** Tinybars distributed as staking rewards each period. */
	staking_reward_rate: Int64;
	/** Minimum balance of 0.0.800 required to activate rewards. */
	staking_start_threshold: Int64;
	/** Unreserved balance of 0.0.800 at close of prior period. */
	unreserved_staking_reward_balance: Int64;
}

/** Staking reward entry. */
export interface StakingReward {
	account_id: EntityId;
	/** Tinybars awarded. */
	amount: Int64;
	timestamp: Timestamp;
}

/** Staking rewards page. */
export interface StakingRewardsResponse {
	rewards?: StakingReward[];
	links?: Links;
}

/** A staking reward transfer (used inside transactions). */
export interface StakingRewardTransfer {
	/** Recipient account. */
	account: EntityId;
	/** Tinybars awarded. */
	amount: Int64;
}
export type StakingRewardTransfers = StakingRewardTransfer[];

/** Network supply snapshot. */
export interface NetworkSupplyResponse {
	/** Released supply (tinybars). */
	released_supply?: string;
	/** Snapshot timestamp. */
	timestamp?: Timestamp;
	/** Total supply (tinybars). */
	total_supply?: string;
}

/* =========
   Schedules
   ========= */

/** Schedule signature row. */
export interface ScheduleSignature {
	consensus_timestamp?: Timestamp;
	public_key_prefix?: string; // $byte
	signature?: string; // $byte
	/** CONTRACT | ED25519 | RSA_3072 | ECDSA_384 | ECDSA_SECP256K1 | UNKNOWN */
	type?: "CONTRACT" | "ED25519" | "RSA_3072" | "ECDSA_384" | "ECDSA_SECP256K1" | "UNKNOWN";
}

/** Schedule entity. */
export interface Schedule {
	admin_key?: Key;
	consensus_timestamp?: Timestamp;
	creator_account_id?: EntityId;
	deleted?: boolean;
	executed_timestamp?: TimestampNullable;
	expiration_time?: TimestampNullable;
	memo?: string;
	payer_account_id?: EntityId;
	schedule_id?: EntityId;
	signatures?: ScheduleSignature[];
	transaction_body?: string; // $byte (base64)
	wait_for_expiry?: boolean;
}
export type Schedules = Schedule[];

/** Schedules page. */
export interface SchedulesResponse {
	schedules?: Schedules;
	links?: Links;
}

/** Topic custom fees (consensus). */
export interface ConsensusCustomFees {
	/** seconds.nanoseconds */
	created_timestamp?: Timestamp;
	fixed_fees?: FixedCustomFee[];
}

/** Fixed custom fee entry for a topic. */
export interface FixedCustomFee {
	amount?: Int64;
	collector_account_id?: EntityId;
	denominating_token_id?: EntityId;
}

/* =======
   Topics
   ======= */

/** Chunking info for a topic message. */
export type ChunkInfo = {
	initial_transaction_id?: TransactionId;
	number?: number; // int32
	total?: number; // int32
} | null;

/** Topic entity. */
export interface Topic {
	admin_key: Key;
	/** The account to charge auto renew from. */
	auto_renew_account: EntityId;
	/** Amount of time to extend topic lifetime after expiration (nullable). */
	auto_renew_period: Int64 | null;
	created_timestamp: TimestampNullable;
	/** Custom fees applied per message submitted. */
	custom_fees: ConsensusCustomFees;
	/** Whether the topic is deleted. */
	deleted: boolean | null;
	/** Keys permitted to submit messages without paying custom fees. */
	fee_exempt_key_list: Key[];
	fee_schedule_key: Key;
	/** Topic memo. */
	memo: string;
	submit_key: Key;
	timestamp: TimestampRange;
	topic_id: EntityId;
}

/** Topic message row. */
export interface TopicMessage {
	chunk_info?: ChunkInfo;
	consensus_timestamp: Timestamp;
	/** Base64 message contents. */
	message: string;
	payer_account_id: EntityIdNullable;
	/** Base64 running hash. */
	running_hash: string;
	running_hash_version: number; // int32
	sequence_number: Int64;
	topic_id: EntityId;
}

/** Topic messages array alias. */
export type TopicMessages = TopicMessage[];

/** Topic messages page. */
export interface TopicMessagesResponse {
	messages?: TopicMessages;
	links?: Links;
}

/* ===========
   Blocks (L1)
   =========== */

/** Block / record file summary. */
export interface Block {
	count?: number; // >= 0
	gas_used?: Int64 | null;
	hapi_version?: string | null;
	hash?: string;
	/** 256-byte bloom (0x + 512 hex chars). */
	logs_bloom?: string | null; // pattern: ^0x[0-9a-fA-F]{512}$
	name?: string;
	number?: number; // >= 0
	previous_hash?: string;
	size?: number | null;
	timestamp?: TimestampRange;
}
export type Blocks = Block[];

/** Blocks response page. */
export interface BlocksResponse {
	blocks?: Blocks;
	links?: Links;
}

/* ===========
   Contracts
   =========== */

/** Contract entity (list view). */
export interface Contract {
	admin_key?: Key;
	auto_renew_account?: EntityId;
	auto_renew_period?: Int64 | null;
	contract_id?: EntityId;
	created_timestamp?: TimestampNullable;
	deleted?: boolean;
	evm_address?: EvmAddress;
	expiration_timestamp?: TimestampNullable;
	file_id?: EntityId;
	max_automatic_token_associations?: number | null; // int32
	memo?: string;
	nonce?: Int64 | null;
	obtainer_id?: EntityId;
	permanent_removal?: boolean | null;
	proxy_account_id?: EntityId;
	timestamp?: TimestampRange;
}

/** Contracts array alias. */
export type Contracts = Contract[];

/** Contracts page. */
export interface ContractsResponse {
	contracts?: Contracts;
	links?: Links;
}

/** Contract response with bytecode fields (single contract view). */
export interface ContractResponse extends Contract {
	/** Deployment bytecode (hex) */
	bytecode?: string | null; // $binary
	/** Runtime bytecode post-deploy (hex) */
	runtime_bytecode?: string | null; // $binary
}

/** Contract log topic item (hex). */
export type ContractLogTopic = string;

/** Contract log topics list. */
export type ContractLogTopics = ContractLogTopic[];

/** Contract log row. */
export interface ContractLog {
	/** Hex-encoded EVM address of the contract (40 hex, 0x-prefixed). */
	address?: string; // pattern: ^0x[0-9A-Fa-f]{40}$
	/** Hex bloom filter (nullable). */
	bloom?: Bloom;
	contract_id?: EntityId;
	/** Hex-encoded log data (nullable). */
	data?: string | null;
	/** Index of the log in the execution chain. */
	index?: number;
	topics?: ContractLogTopics;
	/** Hex block hash (record file chain). */
	block_hash?: string;
	/** Block height: number of record files since network start. */
	block_number?: Int64;
	/** Executed contract that created this log (nullable). */
	root_contract_id?: EntityId; // EntityId pattern
	timestamp?: Timestamp;
	/** Hex-encoded transaction hash. */
	transaction_hash?: string;
	/** Position of the transaction in the block (nullable). */
	transaction_index?: number | null; // int32
}
export type ContractLogs = ContractLog[];

/** Contract logs page. */
export interface ContractLogsResponse {
	logs?: ContractLogs;
	links?: Links;
}

/** Contract action enums. */
export type ContractAction_call_operation_type = "CALL" | "CALLCODE" | "CREATE" | "CREATE2" | "DELEGATECALL" | "STATICCALL" | "UNKNOWN";

export type ContractAction_call_type = "NO_ACTION" | "CALL" | "CREATE" | "PRECOMPILE" | "SYSTEM";
export type ContractAction_caller_type = "ACCOUNT" | "CONTRACT";
export type ContractAction_recipient_type = "ACCOUNT" | "CONTRACT";
export type ContractAction_result_data_type = "OUTPUT" | "REVERT_REASON" | "ERROR";

/** Contract action row. */
export interface ContractAction {
	/** Nesting depth of the call. */
	call_depth?: number; // int32
	/** Call operation type. */
	call_operation_type?: ContractAction_call_operation_type;
	/** Call type. */
	call_type?: ContractAction_call_type;
	caller?: EntityId;
	/** Entity type of the caller. */
	caller_type?: ContractAction_caller_type;
	/** EVM address of caller (hex). */
	from?: string;
	/** Gas cost in tinybars. */
	gas?: Int64;
	/** Gas used in tinybars. */
	gas_used?: Int64;
	/** Position within ordered list of actions. */
	index?: number; // int32
	/** Hex-encoded input data (nullable). */
	input?: string | null;
	recipient?: EntityId;
	/** Entity type of the recipient (nullable). */
	recipient_type?: ContractAction_recipient_type | null;
	/** Hex-encoded result data (nullable). */
	result_data?: string | null;
	/** Type of result data. */
	result_data_type?: ContractAction_result_data_type;
	timestamp?: Timestamp;
	to?: EvmAddressNullable;
	/** Value of the transaction in tinybars. */
	value?: Int64;
}
export type ContractActions = ContractAction[];

/** Contract actions page. */
export interface ContractActionsResponse {
	actions?: ContractActions;
	links?: Links;
}

/** One contract/storage-key entry from an EIP-2930 access list. */
export interface AccessList {
	address?: string;
	storage_keys?: string[];
}

/** One signed authorization from an EIP-7702 authorization list. */
export interface AuthorizationList {
	address?: string;
	chain_id?: string;
	nonce?: Int64;
	r?: string;
	s?: string;
	y_parity?: string;
}

/** Contract result (Ethereum-style & Hedera overlay). */
export interface ContractResult {
	/** Access list of the wrapped Ethereum transaction. */
	access_list?: AccessList[];
	/** Hex EVM address of contract. */
	address?: string | null;
	/** Authorization list of the wrapped EIP-7702 Ethereum transaction. */
	authorization_list?: AuthorizationList[];
	/** Value sent to the function: tinybars by default, or weibars when `hbar=false` (nullable). */
	amount?: Int64 | null;
	block_gas_used?: Int64 | null;
	block_hash?: string | null;
	block_number?: Int64 | null;
	bloom?: Bloom;
	/** Hex result returned by the function (nullable). */
	call_result?: string | null;
	/** Hex chain_id of wrapped Ethereum tx (nullable). */
	chain_id?: string | null;
	contract_id?: EntityId;
	/** List of contracts created by the call (nullable). */
	created_contract_ids?: EntityId[] | null;
	/** Execution error message (nullable). */
	error_message?: string | null;
	/** Hex initcode of a failed CREATE tx. */
	failed_initcode?: string | null;
	from?: EvmAddressNullable;
	/** Hex encoded function parameters (nullable). */
	function_parameters?: string | null;
	/** Units of gas consumed by EVM to execute. */
	gas_consumed?: Int64 | null;
	/** Max units of gas allowed. */
	gas_limit?: Int64;
	/** Hex gas price: tinybars by default, or weibars when `hbar=false` (nullable). */
	gas_price?: string | null;
	/** Units of gas used to execute (nullable). */
	gas_used?: Int64 | null;
	/** Hex hash (32 bytes); only populated for Ethereum transaction case. */
	hash?: string;
	/** Hex max fee per gas: tinybars by default, or weibars when `hbar=false` (nullable). */
	max_fee_per_gas?: string | null;
	/** Hex max priority fee per gas: tinybars by default, or weibars when `hbar=false` (nullable). */
	max_priority_fee_per_gas?: string | null;
	/** Nonce of wrapped Ethereum transaction (nullable). */
	nonce?: Int64 | null;
	/** Hex signature r (nullable). */
	r?: string | null;
	/** Transaction result string (e.g., SUCCESS). */
	result?: string;
	/** Hex signature s (nullable). */
	s?: string | null;
	/** 0x1 == SUCCESS, 0x0 == otherwise (as hex string). */
	status?: string;
	timestamp?: Timestamp;
	to?: EvmAddressNullable;
	/** Position of the transaction in the block (nullable). */
	transaction_index?: Int64 | null;
	/** Type of wrapped Ethereum tx: 0 (Pre-EIP-1559) or 2 (Post-EIP-1559). */
	type?: number | null;
	/** Recovery id of wrapped Ethereum tx (nullable). */
	v?: number | null;
}

/** Contract result with logs and state changes. */
export interface ContractResultDetails extends ContractResult {
	logs?: ContractResultLogs;
	state_changes?: ContractResultStateChanges;
}

/** Contract result log row. */
export interface ContractResultLog {
	address?: string; // pattern: ^0x[0-9A-Fa-f]{40}$
	bloom?: Bloom;
	contract_id?: EntityId;
	data?: string | null;
	index?: number;
	topics?: ContractLogTopics;
}
export type ContractResultLogs = ContractResultLog[];

/** Contract storage state row. */
export interface ContractState {
	address: EvmAddress;
	contract_id: EntityId;
	timestamp: Timestamp;
	/** Hex storage slot (non-null). */
	slot: string;
	/** Hex value written (0x implies no value). */
	value: string;
}

/** Contract state page. */
export interface ContractStateResponse {
	state?: ContractState[];
	links?: Links;
}

/** Contract storage state change row. */
export interface ContractResultStateChange {
	address?: EvmAddress;
	contract_id?: EntityId;
	/** Hex storage slot changed. */
	slot?: string;
	/** Hex value read. */
	value_read?: string;
	/** Hex value written (nullable means no write). */
	value_written?: string | null;
}
export type ContractResultStateChanges = ContractResultStateChange[];

/** Contract results array alias. */
export type ContractResults = ContractResult[];

/** Contract results page. */
export interface ContractResultsResponse {
	results?: ContractResults;
	links?: Links;
}

/* =========
   Opcodes / Trace
   ========= */

/** One opcode log entry in a trace. */
export interface Opcode {
	/** Current call depth. */
	depth: number; // int32
	/** Remaining gas. */
	gas: Int64;
	/** Cost for executing op. */
	gas_cost: Int64;
	/** EVM memory (hex items, nullable). */
	memory: string[] | null;
	/** Opcode mnemonic. */
	op: string;
	/** Program counter. */
	pc: number; // int32
	/** Revert reason (hex, nullable). */
	reason?: string | null;
	/** EVM stack (hex items, nullable). */
	stack: string[] | null;
	/**
	 * Storage slots (keys/values hex) of current contract read/written.
	 * Nullable when not present.
	 */
	storage: Record<string, string> | null;
}

/** Opcode logger response. */
export interface OpcodesResponse {
	/** Hex recipient address; zero address for no-recipient tx (e.g., contract create). */
	address: string;
	contract_id: EntityId;
	/** Whether the transaction failed to be completely processed. */
	failed: boolean;
	/** Gas used in tinybars. */
	gas: Int64;
	/** The logs produced by the opcode logger. */
	opcodes: Opcode[];
	/** Returned data from the transaction (hex). */
	return_value: string;
}

/* =============
   Transactions
   ============= */

/** Transaction type labels currently documented by the Hedera Mirror Node API. */
export type KnownTransactionType =
	| "ATOMICBATCH"
	| "CONSENSUSCREATETOPIC"
	| "CONSENSUSDELETETOPIC"
	| "CONSENSUSSUBMITMESSAGE"
	| "CONSENSUSUPDATETOPIC"
	| "CONTRACTCALL"
	| "CONTRACTCREATEINSTANCE"
	| "CONTRACTDELETEINSTANCE"
	| "CONTRACTUPDATEINSTANCE"
	| "CRSPUBLICATION"
	| "CRYPTOADDLIVEHASH"
	| "CRYPTOAPPROVEALLOWANCE"
	| "CRYPTOCREATEACCOUNT"
	| "CRYPTODELETE"
	| "CRYPTODELETEALLOWANCE"
	| "CRYPTODELETELIVEHASH"
	| "CRYPTOTRANSFER"
	| "CRYPTOUPDATEACCOUNT"
	| "ETHEREUMTRANSACTION"
	| "FILEAPPEND"
	| "FILECREATE"
	| "FILEDELETE"
	| "FILEUPDATE"
	| "FREEZE"
	| "HINTSKEYPUBLICATION"
	| "HINTSPARTIALSIGNATURE"
	| "HINTSPREPROCESSINGVOTE"
	| "HISTORYPROOFKEYPUBLICATION"
	| "HISTORYPROOFSIGNATURE"
	| "HISTORYPROOFVOTE"
	| "HOOKSTORE"
	| "LEDGERIDPUBLICATION"
	| "MIGRATIONROOTHASHVOTE"
	| "NODECREATE"
	| "NODEDELETE"
	| "NODESTAKEUPDATE"
	| "NODEUPDATE"
	| "REGISTEREDNODECREATE"
	| "REGISTEREDNODEDELETE"
	| "REGISTEREDNODEUPDATE"
	| "SCHEDULECREATE"
	| "SCHEDULEDELETE"
	| "SCHEDULESIGN"
	| "STATESIGNATURETRANSACTION"
	| "SYSTEMDELETE"
	| "SYSTEMUNDELETE"
	| "TOKENAIRDROP"
	| "TOKENASSOCIATE"
	| "TOKENBURN"
	| "TOKENCANCELAIRDROP"
	| "TOKENCLAIMAIRDROP"
	| "TOKENCREATION"
	| "TOKENDELETION"
	| "TOKENDISSOCIATE"
	| "TOKENFEESCHEDULEUPDATE"
	| "TOKENFREEZE"
	| "TOKENGRANTKYC"
	| "TOKENMINT"
	| "TOKENPAUSE"
	| "TOKENREJECT"
	| "TOKENREVOKEKYC"
	| "TOKENUNFREEZE"
	| "TOKENUNPAUSE"
	| "TOKENUPDATE"
	| "TOKENUPDATENFTS"
	| "TOKENWIPE"
	| "UNCHECKEDSUBMIT"
	| "UTILPRNG";

/**
 * Transaction label returned by a Mirror Node.
 *
 * Known labels retain autocomplete while the open string member keeps the
 * client forward-compatible with newer Hedera releases and provider forks.
 */
export type TransactionTypes = KnownTransactionType | (string & {});

/** Assessed custom fee row (attached to transaction detail). */
export interface AssessedCustomFee {
	amount?: Int64;
	collector_account_id?: EntityId;
	effective_payer_account_ids?: EntityId[];
	token_id?: EntityId;
}

/** Transaction base. */
export interface Transaction {
	batch_key?: Key;
	bytes?: string | null; // $byte
	charged_tx_fee?: Int64;
	consensus_timestamp?: Timestamp;
	entity_id?: EntityId;
	high_volume?: boolean;
	high_volume_pricing_multiplier?: Int64 | null;
	max_custom_fees?: CustomFeeLimit[];
	max_fee?: string;
	memo_base64?: string | null; // $byte
	name?: TransactionTypes;
	nft_transfers?: Array<{
		is_approval: boolean;
		receiver_account_id: EntityId;
		sender_account_id: EntityId;
		serial_number: Int64;
		token_id: EntityId;
	}>;
	node?: EntityId;
	/** Non-negative transaction nonce (int32). */
	nonce?: number;
	parent_consensus_timestamp?: TimestampNullable;
	result?: string;
	scheduled?: boolean;
	staking_reward_transfers?: StakingRewardTransfers;
	token_transfers?: Array<{
		token_id: EntityId;
		account: EntityId;
		amount: Int64;
		is_approval?: boolean;
	}>;
	transaction_hash?: string; // $byte
	transaction_id?: string;
	transfers?: Array<{
		account: EntityId;
		amount: Int64;
		is_approval?: boolean;
	}>;
	/** Some deployed nodes return `null` for transactions without this value. */
	valid_duration_seconds?: string | null;
	valid_start_timestamp?: Timestamp;
}

/** Transaction detail (adds assessed_custom_fees). */
export interface TransactionDetail extends Transaction {
	assessed_custom_fees?: AssessedCustomFee[];
}

/** Transactions array alias. */
export type Transactions = Transaction[];

/** Transaction details array alias. */
export type TransactionDetails = TransactionDetail[];

/** Transactions page (list). */
export interface TransactionsResponse {
	transactions?: Transactions;
	links?: Links;
}

/** Transactions by id response. */
export interface TransactionByIdResponse {
	transactions?: TransactionDetails;
}

/** Transaction id struct. */
export interface TransactionId {
	account_id?: EntityId;
	nonce?: number | null; // int32, nullable
	scheduled?: boolean | null;
	transaction_valid_start?: Timestamp;
}

/** Contract call request (eth_call-style). */
export interface ContractCallRequest {
	/**
	 * Hex block number or "latest" | "pending" | "earliest" (defaults to "latest").
	 */
	block?: string | null; // pattern: ^((0x)?[0-9a-fA-F]+|(earliest|pending|latest))$
	/**
	 * Hex method signature + encoded params (<= 131072 bytes as 262146 hex digits incl. optional 0x).
	 */
	data?: string | null; // $binary, pattern: ^(0x)?[0-9a-fA-f]+$, maxLength: 262146
	/** Whether gas estimation is called (defaults false). */
	estimate?: boolean | null;
	/** From address (20-byte hex), optional. */
	from?: string | null; // $binary, ^(0x)?[A-Fa-f0-9]{40}$, 40..42
	/** Gas provided (defaults to 15000000). */
	gas?: Int64Input | null; // minimum: 0
	/** Gas price per paid gas unit. */
	gasPrice?: Int64Input | null; // minimum: 0
	/** To address (20-byte hex), required. */
	to: string; // $binary, ^(0x)?[A-Fa-f0-9]{40}$, 40..42
	/** Value sent (defaults 0). */
	value?: Int64Input | null; //  minimum: 0
}

/** Contract call response. */
export interface ContractCallResponse {
	/** Hex result from executed contract call. */
	result?: string; // $binary, pattern: ^0x[0-9a-fA-F]+$
}

/* =====
   Error
   ===== */

/** Error envelope. */
export interface Error {
	_status?: {
		messages?: Array<{
			/** Hex error message (nullable). */
			data?: string | null; // $binary, pattern: ^0x[0-9a-fA-F]+$
			/** Detailed message (nullable). */
			detail?: string | null;
			/** Error message (non-null). */
			message?: string;
		}>;
	};
}
