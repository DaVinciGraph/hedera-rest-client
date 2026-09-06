// src/core/provider.ts
import { LimiterCapacityError, LimiterRegistry, type LimiterBehavior } from "./limiter";
import type {
	HederaRestClientConfig,
	NetworkConfig,
	ProviderConfig,
	ProviderConfigMap,
	ProviderName,
	NetworkName,
	HttpConfig,
	LimiterConfig,
	RetryPolicy,
	LimitValue,
	PageConfig,
	PageLimitConfig,
} from "../types";
import { Logger } from "./logger";
import { HttpTransport, MAX_TIMER_DELAY_MS, type HttpAttemptDispatcher } from "./http";
import { buildQuery } from "./utils";
import { ConfigError, HttpError, HttpNetworkError } from "./errors";
import { normalizeMirrorNodeBaseUrl, resolveMirrorNodeUrl } from "./url";
import { inferPageEndpoint, resolveLimitValue, resolvedQueryLimit } from "./limits";

const PROVIDER_META_KEYS = new Set(["http", "page", "headers", "networks"]);
const CLIENT_CONFIG_KEYS = new Set([
	"provider",
	"switchProviderWhenOverflow",
	"switchProviderOnFailure",
	"cache",
	"log",
	"defaultProvider",
	"defaultNetwork",
]);
const NETWORK_CONFIG_KEYS = new Set(["url", "apiKey", "headers", "http", "page"]);
const API_KEY_KEYS = new Set(["key", "value"]);
const HTTP_CONFIG_KEYS = new Set(["retry", "limiter", "timeoutMs"]);
const RETRY_POLICY_KEYS = new Set([
	"enabled",
	"maxAttempts",
	"initialDelayMs",
	"maxDelayMs",
	"backoff",
	"on404",
	"on429",
	"on5xx",
	"onNetworkError",
	"honorRetryAfter",
]);
const LIMITER_CONFIG_KEYS = new Set([
	"reservoir",
	"reservoirRefreshInterval",
	"reservoirRefreshAmount",
	"minTime",
	"maxConcurrent",
]);
const PAGE_CONFIG_KEYS = new Set(["defaultLimit", "maxLimit", "endpoints"]);
const PAGE_LIMIT_CONFIG_KEYS = new Set(["defaultLimit", "maxLimit"]);

function cloneRetryPolicy(policy?: RetryPolicy): RetryPolicy | undefined {
	return policy ? { ...policy } : undefined;
}

function cloneLimiterConfig(config?: LimiterConfig): LimiterConfig | undefined {
	return config ? { ...config } : undefined;
}

function cloneHttpConfig(config?: HttpConfig): HttpConfig | undefined {
	if (!config) return undefined;
	return {
		retry: cloneRetryPolicy(config.retry),
		limiter: cloneLimiterConfig(config.limiter),
		timeoutMs: config.timeoutMs,
	};
}

function clonePageConfig(config?: PageConfig): PageConfig | undefined {
	if (!config) return undefined;
	return {
		defaultLimit: config.defaultLimit,
		maxLimit: config.maxLimit,
		endpoints: config.endpoints
			? Object.fromEntries(Object.entries(config.endpoints).map(([endpoint, limits]) => [endpoint, { ...limits }]))
			: undefined,
	};
}

function cloneNetworkConfig(config: NetworkConfig): NetworkConfig {
	return {
		...config,
		apiKey: config.apiKey ? { ...config.apiKey } : undefined,
		headers: config.headers ? { ...config.headers } : undefined,
		http: cloneHttpConfig(config.http),
		page: clonePageConfig(config.page),
	};
}

function cloneProviderConfig(config: ProviderConfig): ProviderConfig {
	const cloned = Object.assign(Object.create(null) as ProviderConfig & Record<string, unknown>, {
		http: cloneHttpConfig(config.http),
		page: clonePageConfig(config.page),
		headers: config.headers ? { ...config.headers } : undefined,
	});

	if (config.networks) {
		cloned.networks = Object.fromEntries(Object.entries(config.networks).map(([name, network]) => [name, cloneNetworkConfig(network)]));
	}

	for (const [name, value] of Object.entries(config)) {
		if (PROVIDER_META_KEYS.has(name)) continue;
		if (value && typeof value === "object") {
			cloned[name] = cloneNetworkConfig(value as NetworkConfig);
		}
	}

	return cloned as ProviderConfig;
}

function cloneProviderMap(config: ProviderConfigMap): ProviderConfigMap {
	return Object.fromEntries(Object.entries(config).map(([name, provider]) => [name, cloneProviderConfig(provider)]));
}

function describeConfigValue(value: unknown): string {
	try {
		return String(value);
	} catch {
		return "<unprintable>";
	}
}

function configError(path: string, expectation: string, value: unknown): never {
	throw new ConfigError(`${path} ${expectation}; got ${describeConfigValue(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	try {
		const prototype = Object.getPrototypeOf(value);
		return prototype === Object.prototype || prototype === null;
	} catch {
		return false;
	}
}

function validateKnownKeys(value: Record<string, unknown>, path: string, allowed: ReadonlySet<string>): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !allowed.has(key)) {
			throw new ConfigError(`${path}.${String(key)} is not a supported option`);
		}
	}
}

function validateStringKeys(value: Record<string, unknown>, path: string): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") throw new ConfigError(`${path}.${String(key)} must use a string key`);
	}
}

/** Validate a required provider/network/configuration identifier. */
export function validateName(value: unknown, path: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) configError(path, "must be a non-empty string", value);
}

function validateHeaders(headers: Readonly<Record<string, string>> | undefined, path: string): void {
	if (headers === undefined) return;
	if (!isRecord(headers)) configError(path, "must be an object", headers);
	validateStringKeys(headers, path);
	for (const [name, value] of Object.entries(headers)) {
		validateName(name, `${path} header name`);
		if (typeof value !== "string") configError(`${path}.${name}`, "must be a string", value);
		try {
			new Headers({ [name]: value });
		} catch {
			configError(`${path}.${name}`, "must be a valid HTTP header", value);
		}
	}
}

function validatePageLimitConfig(limits: PageLimitConfig, path: string): void {
	for (const key of ["defaultLimit", "maxLimit"] as const) {
		const value = limits[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
			configError(`${path}.${key}`, "must be a positive safe integer", value);
		}
	}
	if (limits.defaultLimit !== undefined && limits.maxLimit !== undefined && limits.defaultLimit > limits.maxLimit) {
		throw new ConfigError(`${path}.defaultLimit must be less than or equal to ${path}.maxLimit`);
	}
}

function validatePageConfig(page: PageConfig | undefined, path: string): void {
	if (page === undefined) return;
	if (!isRecord(page)) configError(path, "must be an object", page);
	validateKnownKeys(page, path, PAGE_CONFIG_KEYS);
	validatePageLimitConfig(page, path);
	if (page.endpoints !== undefined) {
		if (!isRecord(page.endpoints)) configError(`${path}.endpoints`, "must be an object", page.endpoints);
		validateStringKeys(page.endpoints, `${path}.endpoints`);
		for (const [endpoint, limits] of Object.entries(page.endpoints)) {
			validateName(endpoint, `${path}.endpoints endpoint name`);
			if (!isRecord(limits)) configError(`${path}.endpoints.${endpoint}`, "must be an object", limits);
			validateKnownKeys(limits, `${path}.endpoints.${endpoint}`, PAGE_LIMIT_CONFIG_KEYS);
			validatePageLimitConfig(limits as PageLimitConfig, `${path}.endpoints.${endpoint}`);
		}
	}
}

function validateLimiterConfig(config: LimiterConfig | undefined, path: string): void {
	if (config === undefined) return;
	if (!isRecord(config)) configError(path, "must be an object", config);
	validateKnownKeys(config, path, LIMITER_CONFIG_KEYS);
	const limiter = config as LimiterConfig;
	for (const key of ["reservoir", "reservoirRefreshAmount"] as const) {
		const value = limiter[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
			configError(`${path}.${key}`, "must be a non-negative safe integer", value);
		}
	}
	if (
		limiter.reservoirRefreshInterval !== undefined &&
		(!Number.isSafeInteger(limiter.reservoirRefreshInterval) ||
			limiter.reservoirRefreshInterval <= 0 ||
			limiter.reservoirRefreshInterval > MAX_TIMER_DELAY_MS ||
			limiter.reservoirRefreshInterval % 250 !== 0)
	) {
		configError(
			`${path}.reservoirRefreshInterval`,
			`must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS} and divisible by 250`,
			limiter.reservoirRefreshInterval
		);
	}
	if (limiter.minTime !== undefined && (!Number.isSafeInteger(limiter.minTime) || limiter.minTime < 0 || limiter.minTime > MAX_TIMER_DELAY_MS)) {
		configError(`${path}.minTime`, `must be a safe integer between 0 and ${MAX_TIMER_DELAY_MS}`, limiter.minTime);
	}
	if (limiter.maxConcurrent !== undefined && (!Number.isSafeInteger(limiter.maxConcurrent) || limiter.maxConcurrent < 1)) {
		configError(`${path}.maxConcurrent`, "must be a positive safe integer", limiter.maxConcurrent);
	}
	const hasRefreshInterval = limiter.reservoirRefreshInterval !== undefined;
	const hasRefreshAmount = limiter.reservoirRefreshAmount !== undefined;
	if (hasRefreshInterval !== hasRefreshAmount) {
		throw new ConfigError(`${path}.reservoirRefreshInterval and ${path}.reservoirRefreshAmount must be configured together`);
	}
	if (hasRefreshInterval && limiter.reservoir === undefined) {
		throw new ConfigError(`${path}.reservoir is required when reservoir refresh is configured`);
	}
}

function validateRetryPolicy(policy: RetryPolicy | undefined, path: string): void {
	if (policy === undefined) return;
	if (!isRecord(policy)) configError(path, "must be an object", policy);
	validateKnownKeys(policy, path, RETRY_POLICY_KEYS);
	const retry = policy as RetryPolicy;
	if (retry.maxAttempts !== undefined && (!Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1)) {
		configError(`${path}.maxAttempts`, "must be a positive safe integer", retry.maxAttempts);
	}
	for (const key of ["initialDelayMs", "maxDelayMs"] as const) {
		const value = retry[key];
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER_DELAY_MS)) {
			configError(`${path}.${key}`, `must be a safe integer between 0 and ${MAX_TIMER_DELAY_MS}`, value);
		}
	}
	if (retry.backoff !== undefined && retry.backoff !== "fixed" && retry.backoff !== "full-jitter") {
		configError(`${path}.backoff`, 'must be "fixed" or "full-jitter"', retry.backoff);
	}
	for (const key of ["enabled", "on404", "on429", "on5xx", "onNetworkError", "honorRetryAfter"] as const) {
		const value = retry[key];
		if (value !== undefined && typeof value !== "boolean") configError(`${path}.${key}`, "must be a boolean", value);
	}
}

function validateHttpConfig(config: HttpConfig | undefined, path: string): void {
	if (config === undefined) return;
	if (!isRecord(config)) configError(path, "must be an object", config);
	validateKnownKeys(config, path, HTTP_CONFIG_KEYS);
	const http = config as HttpConfig;
	validateLimiterConfig(http.limiter, `${path}.limiter`);
	validateRetryPolicy(http.retry, `${path}.retry`);
	if (http.timeoutMs !== undefined && (!Number.isSafeInteger(http.timeoutMs) || http.timeoutMs < 1 || http.timeoutMs > 2_147_483_647)) {
		configError(`${path}.timeoutMs`, "must be a positive safe integer no greater than 2147483647", http.timeoutMs);
	}
}

function networkEntries(provider: ProviderConfig): Array<[string, NetworkConfig]> {
	const entries = new Map<string, NetworkConfig>();
	for (const [name, value] of Object.entries(provider)) {
		if (PROVIDER_META_KEYS.has(name)) continue;
		if (value && typeof value === "object") entries.set(name, value as NetworkConfig);
	}
	for (const [name, network] of Object.entries(provider.networks ?? {})) {
		if (!entries.has(name)) entries.set(name, network);
	}
	return [...entries];
}

function validateApiKey(apiKey: unknown, path: string): void {
	if (!isRecord(apiKey)) configError(path, "must be an object", apiKey);
	validateKnownKeys(apiKey, path, API_KEY_KEYS);
	validateName(apiKey.key, `${path}.key`);
	validateName(apiKey.value, `${path}.value`);
	validateHeaders({ [apiKey.key]: apiKey.value }, path);
}

function validateRawNetworkConfig(network: NetworkConfig, path: string): void {
	if (!isRecord(network)) configError(path, "must be an object", network);
	validateKnownKeys(network, path, NETWORK_CONFIG_KEYS);
	const config = network as NetworkConfig;
	validateName(config.url, `${path}.url`);
	// Validate URL syntax now as well; the cloned snapshot is normalized later.
	normalizeMirrorNodeBaseUrl(config.url);
	validateHeaders(config.headers, `${path}.headers`);
	validateHttpConfig(config.http, `${path}.http`);
	validatePageConfig(config.page, `${path}.page`);
	if (config.apiKey !== undefined) validateApiKey(config.apiKey, `${path}.apiKey`);
}

function validateRawClientConfig(cfg: HederaRestClientConfig): void {
	if (!isRecord(cfg)) configError("config", "must be an object", cfg);
	validateKnownKeys(cfg, "config", CLIENT_CONFIG_KEYS);
	for (const key of ["switchProviderWhenOverflow", "switchProviderOnFailure", "log"] as const) {
		const value = cfg[key];
		if (value !== undefined && typeof value !== "boolean") configError(key, "must be a boolean", value);
	}
	if (cfg.defaultProvider !== undefined) validateName(cfg.defaultProvider, "defaultProvider");
	if (cfg.defaultNetwork !== undefined) validateName(cfg.defaultNetwork, "defaultNetwork");
	if (cfg.provider === undefined) return;
	if (!isRecord(cfg.provider)) configError("provider", "must be an object", cfg.provider);
	validateStringKeys(cfg.provider, "provider");

	for (const [providerName, provider] of Object.entries(cfg.provider)) {
		validateName(providerName, "provider name");
		if (!isRecord(provider)) configError(`provider.${providerName}`, "must be an object", provider);
		validateStringKeys(provider, `provider.${providerName}`);
		const providerConfig = provider as ProviderConfig;
		validateHeaders(providerConfig.headers, `provider.${providerName}.headers`);
		validateHttpConfig(providerConfig.http, `provider.${providerName}.http`);
		validatePageConfig(providerConfig.page, `provider.${providerName}.page`);
		if (providerConfig.networks !== undefined && !isRecord(providerConfig.networks)) {
			configError(`provider.${providerName}.networks`, "must be an object", providerConfig.networks);
		}
		if (providerConfig.networks !== undefined) {
			validateStringKeys(providerConfig.networks, `provider.${providerName}.networks`);
		}
		const directNetworks = new Set(
			Object.entries(provider)
				.filter(([name, value]) => !PROVIDER_META_KEYS.has(name) && value !== undefined)
				.map(([name]) => name)
		);
		for (const networkName of Object.keys(providerConfig.networks ?? {})) {
			if (directNetworks.has(networkName)) {
				throw new ConfigError(
					`Provider '${providerName}' defines network '${networkName}' both directly and in provider.${providerName}.networks`
				);
			}
		}

		for (const [name, value] of Object.entries(provider)) {
			if (PROVIDER_META_KEYS.has(name)) continue;
			// The three legacy shorthand networks are optional, so an explicit
			// `undefined` is harmless there. Any other direct property denotes a
			// custom network; silently skipping `undefined` would turn a misspelled
			// provider option into an accepted configuration.
			if (value === undefined && (name === "mainnet" || name === "testnet" || name === "previewnet")) continue;
			if (!isRecord(value)) configError(`provider.${providerName}.${name}`, "must be a network object", value);
			validateRawNetworkConfig(value as unknown as NetworkConfig, `provider.${providerName}.${name}`);
		}
		for (const [networkName, network] of Object.entries(providerConfig.networks ?? {})) {
			validateName(networkName, `provider.${providerName} network name`);
			if (!isRecord(network)) configError(`provider.${providerName}.networks.${networkName}`, "must be a network object", network);
			validateRawNetworkConfig(network as NetworkConfig, `provider.${providerName}.networks.${networkName}`);
		}
	}
}

function validateAndNormalizeProviders(providers: ProviderConfigMap): void {
	for (const [providerName, provider] of Object.entries(providers)) {
		validateName(providerName, "provider name");
		if (!provider || typeof provider !== "object" || Array.isArray(provider)) configError(`provider.${providerName}`, "must be an object", provider);
		validateHeaders(provider.headers, `provider.${providerName}.headers`);
		validateHttpConfig(provider.http, `provider.${providerName}.http`);
		validatePageConfig(provider.page, `provider.${providerName}.page`);

		for (const [networkName, network] of networkEntries(provider)) {
			validateName(networkName, `provider.${providerName} network name`);
			if (!network || typeof network !== "object" || Array.isArray(network)) {
				configError(`provider.${providerName}.${networkName}`, "must be an object", network);
			}
			validateRawNetworkConfig(network, `provider.${providerName}.${networkName}`);
			network.url = normalizeMirrorNodeBaseUrl(network.url);

			const page = resolvePageConfig(provider.page, network.page);
			if (page.defaultLimit > page.maxLimit) {
				throw new ConfigError(
					`Effective page.defaultLimit for provider '${providerName}' network '${networkName}' must be less than or equal to page.maxLimit`
				);
			}
			for (const [endpoint, limits] of Object.entries(page.endpoints ?? {})) {
				if (limits.defaultLimit > limits.maxLimit) {
					throw new ConfigError(
						`Effective page limits for endpoint '${endpoint}' on provider '${providerName}' network '${networkName}' require defaultLimit to be less than or equal to maxLimit`
					);
				}
			}
		}
	}
}

/** Merge only defined retry fields so `undefined` continues to mean inherit. */
function mergeRetryPolicies(provider?: RetryPolicy, network?: RetryPolicy): RetryPolicy | undefined {
	const merged: RetryPolicy = {};
	let hasValue = false;
	for (const source of [provider, network]) {
		for (const [key, value] of Object.entries(source ?? {})) {
			if (value === undefined) continue;
			(merged as Record<string, unknown>)[key] = value;
			hasValue = true;
		}
	}
	return hasValue ? merged : undefined;
}

interface ResolvedPageConfig {
	defaultLimit: number;
	maxLimit: number;
	endpoints?: Record<string, { defaultLimit: number; maxLimit: number }>;
}

/** Resolve global and endpoint page limits with fieldwise provider/network inheritance. */
function resolvePageConfig(provider?: PageConfig, network?: PageConfig): ResolvedPageConfig {
	const defaultLimit = network?.defaultLimit ?? provider?.defaultLimit ?? 25;
	const maxLimit = network?.maxLimit ?? provider?.maxLimit ?? 100;
	const endpointNames = new Set([
		...Object.keys(provider?.endpoints ?? {}),
		...Object.keys(network?.endpoints ?? {}),
	]);
	const endpointEntries = [...endpointNames].map((endpoint) => {
		const providerLimits = provider?.endpoints?.[endpoint];
		const networkLimits = network?.endpoints?.[endpoint];
		return [
			endpoint,
			{
				defaultLimit: networkLimits?.defaultLimit ?? providerLimits?.defaultLimit ?? defaultLimit,
				maxLimit: networkLimits?.maxLimit ?? providerLimits?.maxLimit ?? maxLimit,
			},
		] as const;
	});

	return endpointEntries.length > 0
		? { defaultLimit, maxLimit, endpoints: Object.fromEntries(endpointEntries) }
		: { defaultLimit, maxLimit };
}

/** Build a collision-free opaque key for a limiter's configuration scope. */
function limiterBucket(provider: ProviderName, network?: NetworkName): string {
	return JSON.stringify(network === undefined ? ["provider", provider] : ["network", provider, network]);
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
	if (signal.reason !== undefined) return signal.reason;
	const error = new Error("The operation was aborted");
	error.name = "AbortError";
	return error;
}

/** Reject promptly on abort while retaining a handler for queued limiter work. */
function observeAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return work;
	if (signal.aborted) {
		void work.catch(() => {});
		return Promise.reject(abortReason(signal));
	}

	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			callback();
		};
		const onAbort = () => finish(() => reject(abortReason(signal)));

		signal.addEventListener("abort", onAbort, { once: true });
		work.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		);
		if (signal.aborted) onAbort();
	});
}

function mergeHeaders(...sources: Array<Readonly<Record<string, string>> | undefined>): Record<string, string> {
	const headers = new Headers();
	for (const source of sources) {
		for (const [name, value] of Object.entries(source || {})) headers.set(name, value);
	}
	const merged = Object.create(null) as Record<string, string>;
	headers.forEach((value, name) => {
		merged[name] = value;
	});
	return merged;
}

/** Resolve both the legacy canonical keys and the extensible `networks` map. */
function getNetworkConfig(provider: ProviderConfig, network: NetworkName): NetworkConfig | undefined {
	const direct = Object.prototype.hasOwnProperty.call(provider, network)
		? (provider as Record<string, unknown>)[network]
		: undefined;
	if (direct && typeof direct === "object" && typeof (direct as NetworkConfig).url === "string") {
		return direct as NetworkConfig;
	}
	const networks = (provider as ProviderConfig & { networks?: Record<string, NetworkConfig> }).networks;
	return networks && Object.prototype.hasOwnProperty.call(networks, network) ? networks[network] : undefined;
}

/**
 * Fully-resolved network target used by the transport layer.
 *
 * This is produced by {@link ProviderRegistry.resolve} by combining:
 * - the chosen **provider** (e.g., `"public"`, `"p1"`)
 * - the chosen **network** (e.g., `"testnet"`, `"mainnet"`)
 * - provider-level + network-level **HTTP config** (retries, limiter)
 * - provider-level and per-network static headers
 * - default paging limits
 *
 * Builders and resources pass this to {@link ProviderRegistry.get} / {@link ProviderRegistry.post}.
 */
export interface ResolvedTarget {
	/** Provider name chosen for this request (e.g., `"public"`). */
	provider: ProviderName;
	/** Network name under the chosen provider (e.g., `"testnet"`). */
	network: NetworkName;
	/** Base URL for the provider+network (no trailing slash). */
	baseUrl: string;
	/** Static headers to attach to every request (e.g., API key). */
	headers: Record<string, string>;
	/** Effective HTTP configuration (retries, limiter, etc.). */
	http: HttpConfig;
	/**
	 * Limiter bucket key:
	 * - provider-scoped when a provider-level limiter is defined,
	 * - provider-and-network-scoped when a per-network limiter is defined,
	 * - `undefined` when no limiter applies.
	 *
	 * The concrete string encoding is internal and must not be parsed by callers.
	 */
	limiterBucket?: string;
	/** Default and maximum paging limits exposed by the remote API. */
	page: {
		/** Server default page size used when the client passes `"default"`. */
		defaultLimit: number;
		/** Server maximum page size used to clamp user input. */
		maxLimit: number;
		/** Fully resolved operation-specific limits keyed by logical endpoint name. */
		endpoints?: Readonly<Record<string, { defaultLimit: number; maxLimit: number }>>;
	};
}

/**
 * Result of a routed GET request.
 *
 * Unlike {@link ProviderRegistry.get}, this retains the provider that actually
 * served the request after overflow selection or failover. `requestUrl` is the
 * final effective URL for that request after any same-origin redirects.
 * Consumers can also inspect the native `response.url` when needed.
 */
export interface ProviderGetResponse {
	/** Native Fetch response returned by the transport. */
	response: Response;
	/** Effective provider/network target which served the response. */
	target: ResolvedTarget;
	/** Final effective HTTP(S) URL after any same-origin redirects. */
	requestUrl: string;
}

/** Per-request options supported by the shared POST pipeline. */
export interface ProviderPostOptions {
	/** Query parameters appended to the POST URL. */
	query?: Record<string, any>;
	/** Request-specific headers. These override configured static headers. */
	headers?: Readonly<Record<string, string>>;
	/** Optional cancellation signal. */
	signal?: AbortSignal;
	/** Per-attempt timeout in milliseconds. */
	timeoutMs?: number;
}

function isAbortSignal(value: AbortSignal | ProviderPostOptions): value is AbortSignal {
	return "aborted" in value && typeof (value as AbortSignal).addEventListener === "function" && !("query" in value) && !("headers" in value) && !("signal" in value);
}

function normalizePostOptions(value?: AbortSignal | ProviderPostOptions): ProviderPostOptions {
	if (!value) return {};
	return isAbortSignal(value) ? { signal: value } : value;
}

type TargetGetOutcome =
	| ({ ok: true } & ProviderGetResponse)
	| { ok: false; target: ResolvedTarget; error: unknown };

type TargetPostOutcome =
	| { ok: true; target: ResolvedTarget; response: Response }
	| { ok: false; target: ResolvedTarget; error: unknown };

/**
 * Central registry orchestrating:
 *
 * - Provider/network configuration resolution
 * - Logger and HTTP transport access
 * - Rate limiting (via {@link LimiterRegistry})
 * - Preemptive provider selection (capacity probing) when `switchProviderWhenOverflow` is enabled
 * - HTTP failover (provider cycling) on errors when `switchProviderOnFailure` is enabled
 *
 * Typical flow from a resource:
 * 1) Resolve a {@link ResolvedTarget} with {@link ProviderRegistry.resolve}.
 * 2) Call {@link ProviderRegistry.get} or {@link ProviderRegistry.post}.
 * 3) The registry enforces limiter behavior and failover rules.
 */
export class ProviderRegistry {
	private providers: ProviderConfigMap;
	private defaultProvider: ProviderName;
	private defaultNetwork: NetworkName;
	private logger: Logger;
	private limiterReg = new LimiterRegistry();
	private httpTransport: HttpTransport;
	private switchProviderWhenOverflow: boolean;
	private switchProviderOnFailure: boolean;

	/**
	 * Create a registry from the top-level client config.
	 *
	 * If no `provider` map is supplied, built‑in public Mirror Node endpoints are used.
	 * Caller-owned configuration is snapshotted and is never mutated by the registry.
	 */
	constructor(cfg: HederaRestClientConfig) {
		validateRawClientConfig(cfg);
		// ------------------------------
		// Defaults if providers not given
		// ------------------------------
		const defaultProviders: ProviderConfigMap = {
			public: {
				testnet: {
					url: "https://testnet.mirrornode.hedera.com",
					http: {
						// 50 requests per second
						limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
					},
				},
				mainnet: {
					url: "https://mainnet.mirrornode.hedera.com",
					http: {
						// 50 requests per second
						limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
					},
				},
				previewnet: {
					url: "https://previewnet.mirrornode.hedera.com",
					http: {
						// 50 requests per second
						limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
					},
				},
				page: {
					defaultLimit: 25,
					maxLimit: 100,
					endpoints: {
						"network.nodes": { defaultLimit: 10, maxLimit: 25 },
					},
				},
			},
		};

		this.providers = cloneProviderMap(cfg.provider === undefined ? defaultProviders : cfg.provider);
		validateAndNormalizeProviders(this.providers);
		this.defaultProvider = cfg.defaultProvider ?? "public";
		this.defaultNetwork = cfg.defaultNetwork ?? "testnet";
		validateName(this.defaultProvider, "defaultProvider");
		validateName(this.defaultNetwork, "defaultNetwork");
		this.logger = new Logger({ enabled: !!cfg.log });
		this.httpTransport = new HttpTransport(this.logger);
		this.switchProviderWhenOverflow = !!cfg.switchProviderWhenOverflow;
		this.switchProviderOnFailure = !!cfg.switchProviderOnFailure;
		// Resolve eagerly so invalid defaults fail at construction rather than on
		// the first request, after an application has already started.
		this.resolve(this.defaultProvider, this.defaultNetwork);
	}

	/** Access the shared {@link Logger} instance. */
	getLogger() {
		return this.logger;
	}
	/** Access the shared {@link HttpTransport} instance. */
	getHttp() {
		return this.httpTransport;
	}
	/** Access the shared {@link LimiterRegistry} instance. */
	getLimiterReg() {
		return this.limiterReg;
	}
	/**
	 * Whether *preemptive provider selection* (overflow switching) is enabled.
	 *
	 * When `true`, `get`/`post` probe providers for immediate capacity and switch
	 * to another provider if the current one is at capacity.
	 */
	isOverflowSwitchEnabled() {
		return this.switchProviderWhenOverflow;
	}

	/**
	 * Whether *HTTP failover* (failure switching) is enabled.
	 *
	 * When `true`, after a retryable request failure, try each remaining
	 * provider on the same network at most once (without local retries).
	 */
	isFailoverEnabled() {
		return this.switchProviderOnFailure;
	}

	/**
	 * Compute the ordered list of providers that **define** the given network,
	 * rotated so that `start` appears first.
	 *
	 * Used by preemptive probing and failover to decide the iteration order.
	 */
	private providersForNetwork(start: ProviderName, network: NetworkName): ProviderName[] {
		const all = Object.keys(this.providers).filter((p) => !!getNetworkConfig(this.providers[p], network));
		const idx = all.indexOf(start);
		return idx >= 0 ? all.slice(idx).concat(all.slice(0, idx)) : all;
	}

	/** Construct a full URL using the target base and optional query parameters. */
	private url(t: ResolvedTarget, path: string, q?: Record<string, any>) {
		const endpoint = inferPageEndpoint(path);
		const hasQueryLimit = q !== undefined && Object.prototype.hasOwnProperty.call(q, "limit");
		const effectiveQuery = hasQueryLimit
			? { ...q, limit: resolvedQueryLimit(t, q!, endpoint) }
			: q;
		const requestUrl = resolveMirrorNodeUrl(t.baseUrl, path, buildQuery(effectiveQuery || {}));

		// Pagination links carry their query in `path`, rather than `q`. Re-resolve
		// that concrete limit for every provider selected by overflow/failover so a
		// link emitted by a permissive mirror can never exceed another mirror's max.
		if (!hasQueryLimit) {
			const parsed = new URL(requestUrl);
			const embeddedLimit = parsed.searchParams.get("limit");
			if (embeddedLimit !== null) {
				const requested: LimitValue = embeddedLimit === "default" || embeddedLimit === "max" ? embeddedLimit : Number(embeddedLimit);
				parsed.searchParams.set("limit", String(resolveLimitValue(t, requested, endpoint)));
				return parsed.toString();
			}
		}

		return requestUrl;
	}

	/**
	 * Resolve the effective configuration for a given provider/network pair.
	 *
	 * - Merges provider/network retry fields (network fields override provider fields).
	 * - A network limiter declaration replaces the provider limiter for that network;
	 *   otherwise the provider limiter is inherited as a shared bucket.
	 * - Merges provider headers, the legacy API-key header, and network headers.
	 * - Determines the limiter bucket key (provider-level or network-level).
	 * - Supplies default/max page size limits (network overrides provider; final fallback 25/100).
	 *
	 * @throws If the provider or network are unknown.
	 */
	resolve(provider?: ProviderName, network?: NetworkName): ResolvedTarget {
		if (provider !== undefined) validateName(provider, "provider");
		if (network !== undefined) validateName(network, "network");
		const p = provider === undefined ? this.defaultProvider : provider;
		const n = network === undefined ? this.defaultNetwork : network;
		validateName(p, "provider");
		validateName(n, "network");
		const prov = Object.prototype.hasOwnProperty.call(this.providers, p) ? this.providers[p] : undefined;
		if (!prov) throw new ConfigError(`Unknown provider: ${p}`);
		const net = getNetworkConfig(prov, n);
		if (!net) throw new ConfigError(`Provider '${p}' does not define network '${n}'`);

		const retry = mergeRetryPolicies(prov.http?.retry, net.http?.retry) ?? { enabled: false };
		const hasNetworkLimiter = net.http?.limiter !== undefined;
		const limiter = cloneLimiterConfig(hasNetworkLimiter ? net.http?.limiter : prov.http?.limiter);
		const http: HttpConfig = {};
		http.retry = retry;
		if (limiter) http.limiter = limiter;
		const timeoutMs = net.http?.timeoutMs ?? prov.http?.timeoutMs;
		if (timeoutMs !== undefined) http.timeoutMs = timeoutMs;
		const legacyApiKey = net.apiKey ? { [net.apiKey.key]: net.apiKey.value } : undefined;
		const headers = mergeHeaders(prov.headers, legacyApiKey, net.headers);
		const bucket = limiter ? (hasNetworkLimiter ? limiterBucket(p, n) : limiterBucket(p)) : undefined;
		const page = resolvePageConfig(prov.page, net.page);
		return { provider: p, network: n, baseUrl: normalizeMirrorNodeBaseUrl(net.url), headers, http, limiterBucket: bucket, page };
	}

	// --------- internal schedule helpers (behavior-aware) ---------

	/** Build a dispatcher that charges the target's bucket for every fetch. */
	private attemptDispatcher(t: ResolvedTarget, firstAttemptBehavior: LimiterBehavior, signal?: AbortSignal): HttpAttemptDispatcher | undefined {
		if (!t.limiterBucket || !t.http.limiter) return undefined;
		return <T>(attemptTask: () => Promise<T>, attemptIndex: number): Promise<T> => {
			if (signal?.aborted) return Promise.reject(abortReason(signal));
			const behavior = attemptIndex === 0 ? firstAttemptBehavior : "queue";
			this.logger.debug(`limiter schedule${behavior === "overflow" ? " (overflow-probe)" : ""}`, t.limiterBucket);
			const scheduled = this.limiterReg.schedule(t.limiterBucket!, t.http.limiter, behavior, () => {
				// Bottleneck has no supported single-job removal API. Recheck at the
				// execution boundary so an abort while queued can never reach fetch.
				if (signal?.aborted) throw abortReason(signal);
				return attemptTask();
			});
			return observeAbort(scheduled, signal);
		};
	}

	/**
	 * Schedule a **GET** request on a target with the selected behavior.
	 *
	 * - When a limiter exists:
	 *   - `queue`: waits until capacity is available, then runs the request.
	 *   - `overflow`: if capacity is not immediately available, the limiter throws
	 *     a dedicated {@link LimiterCapacityError}.
	 * - When no limiter exists, the request runs immediately.
	 */
	private async scheduleOnTargetGET(
		t: ResolvedTarget,
		requestUrl: string,
		signal?: AbortSignal,
		timeoutMs?: number,
		behavior: LimiterBehavior = "queue",
		retry: RetryPolicy | undefined = t.http.retry
	) {
		const dispatcher = this.attemptDispatcher(t, behavior, signal);
		const options: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {
			method: "GET",
			headers: t.headers,
			signal,
		};
		const effectiveTimeout = timeoutMs ?? t.http.timeoutMs;
		if (effectiveTimeout !== undefined) options.timeoutMs = effectiveTimeout;
		return dispatcher
			? this.httpTransport.request(requestUrl, options, retry, dispatcher)
			: this.httpTransport.request(requestUrl, options, retry);
	}

	/**
	 * Schedule a **POST** request on a target with the selected behavior.
	 * See {@link scheduleOnTargetGET} for behavior semantics.
	 */
	private async scheduleOnTargetPOST(
		t: ResolvedTarget,
		path: string,
		body: any,
		options: ProviderPostOptions = {},
		behavior: LimiterBehavior = "queue",
		retry: RetryPolicy | undefined = t.http.retry
	) {
		const url = this.url(t, path, options.query);
		// Static headers are defaults. The operation's media type must win over a
		// conflicting configured value, and explicit per-request headers win last.
		const headers = mergeHeaders(t.headers, { "content-type": "application/json" }, options.headers);
		const dispatcher = this.attemptDispatcher(t, behavior, options.signal);
		const request: { method: "POST"; headers: Record<string, string>; body: any; signal?: AbortSignal; timeoutMs?: number } = {
			method: "POST",
			headers,
			body,
			signal: options.signal,
		};
		const effectiveTimeout = options.timeoutMs ?? t.http.timeoutMs;
		if (effectiveTimeout !== undefined) request.timeoutMs = effectiveTimeout;
		return dispatcher
			? this.httpTransport.request(url, request, retry, dispatcher)
			: this.httpTransport.request(url, request, retry);
	}

	/**
	 * **Preemptive GET** (overflow switching):
	 *
	 * When multiple providers support the same network and `switchProviderWhenOverflow` is enabled,
	 * we first try an **overflow probe** on providers (in a rotated order that starts with the
	 * requested provider). The first provider with immediate capacity is used.
	 *
	 * If none can start immediately, we **queue on the originally requested provider**.
	 *
	 * For single‑provider networks, we never probe: we simply queue on the requested provider.
	 */
	private async captureGet(
		target: ResolvedTarget,
		path: string,
		params?: Record<string, any>,
		signal?: AbortSignal,
		timeoutMs?: number,
		behavior: LimiterBehavior = "queue",
		retry: RetryPolicy | undefined = target.http.retry
	): Promise<TargetGetOutcome> {
		const requestUrl = this.url(target, path, params);
		try {
			const response =
				retry === target.http.retry
					? await this.scheduleOnTargetGET(target, requestUrl, signal, timeoutMs, behavior)
					: await this.scheduleOnTargetGET(target, requestUrl, signal, timeoutMs, behavior, retry);
			return { ok: true, target, response, requestUrl: response.url || requestUrl };
		} catch (error) {
			return { ok: false, target, error };
		}
	}

	private async preemptiveGet(
		target: ResolvedTarget,
		path: string,
		params?: Record<string, any>,
		signal?: AbortSignal,
		timeoutMs?: number
	): Promise<TargetGetOutcome> {
		const providers = this.providersForNetwork(target.provider, target.network);

		// A single provider has nowhere else to route, so it always queues.
		if (providers.length <= 1) {
			this.logger.debug("single-provider network; queueing on requested provider", target.provider, target.network);
			return this.captureGet(target, path, params, signal, timeoutMs, "queue");
		}

		// First provider whose shared limiter can accept the physical attempt now wins.
		for (const p of providers) {
			const t = this.resolve(p, target.network);
			const outcome = await this.captureGet(t, path, params, signal, timeoutMs, "overflow");
			if (outcome.ok || !(outcome.error instanceof LimiterCapacityError)) return outcome;
			this.logger.warn("overflow on", p, "-> trying next provider");
		}

		// Nobody can start now: queue once on the originally requested bucket.
		this.logger.debug("All providers at capacity, queueing on", target.provider);
		return this.captureGet(target, path, params, signal, timeoutMs, "queue");
	}

	/**
	 * **Preemptive POST** (overflow switching): identical to {@link preemptiveGet} but for POST requests.
	 */
	private async capturePost(
		target: ResolvedTarget,
		path: string,
		body: any,
		options: ProviderPostOptions = {},
		behavior: LimiterBehavior = "queue",
		retry: RetryPolicy | undefined = target.http.retry
	): Promise<TargetPostOutcome> {
		try {
			const response =
				retry === target.http.retry
					? await this.scheduleOnTargetPOST(target, path, body, options, behavior)
					: await this.scheduleOnTargetPOST(target, path, body, options, behavior, retry);
			return { ok: true, target, response };
		} catch (error) {
			return { ok: false, target, error };
		}
	}

	private async preemptivePost(target: ResolvedTarget, path: string, body: any, options: ProviderPostOptions = {}): Promise<TargetPostOutcome> {
		const providers = this.providersForNetwork(target.provider, target.network);

		// A single provider has nowhere else to route, so it always queues.
		if (providers.length <= 1) {
			this.logger.debug("single-provider network; queueing on requested provider (POST)", target.provider, target.network);
			return this.capturePost(target, path, body, options, "queue");
		}

		// First provider whose shared limiter can accept the physical attempt now wins.
		for (const p of providers) {
			const t = this.resolve(p, target.network);
			const outcome = await this.capturePost(t, path, body, options, "overflow");
			if (outcome.ok || !(outcome.error instanceof LimiterCapacityError)) return outcome;
			this.logger.warn("overflow (POST) on", p, "-> trying next provider");
		}

		return this.capturePost(target, path, body, options, "queue");
	}

	// ---------- Public GET / POST ----------

	/**
	 * Perform a **GET** request with limiter integration, optional overflow switching, and optional failover.
	 *
	 * Behavior:
	 * - When `switchProviderWhenOverflow` is true: uses {@link preemptiveGet} to probe for immediate capacity.
	 * - When `switchProviderOnFailure` is true: on failure (after retries),
	 *   visits every remaining provider at most once.
	 * - Otherwise: always queues on the requested provider.
	 */
	async getWithTarget(
		target: ResolvedTarget,
		path: string,
		query?: Record<string, any>,
		signal?: AbortSignal,
		timeoutMs?: number
	): Promise<ProviderGetResponse> {
		const initial = this.switchProviderWhenOverflow
			? await this.preemptiveGet(target, path, query, signal, timeoutMs)
			: await this.captureGet(target, path, query, signal, timeoutMs, "queue");
		if (initial.ok) {
			return { response: initial.response, target: initial.target, requestUrl: initial.requestUrl };
		}

		if (!this.switchProviderOnFailure || !this.isFailoverFailure(initial.error, signal)) throw initial.error;

		this.logger.warn("Request failed on provider", initial.target.provider, "-> attempting failover");
		return this.failoverGet(initial.target, path, query, signal, timeoutMs, new Set([initial.target.provider]), initial.error);
	}

	/**
	 * Perform a routed GET and return only its Fetch response.
	 *
	 * Use {@link getWithTarget} when subsequent work (such as pagination) must
	 * remain bound to the provider that actually served this request.
	 */
	async get(target: ResolvedTarget, path: string, query?: Record<string, any>, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
		return (await this.getWithTarget(target, path, query, signal, timeoutMs)).response;
	}

	/**
	 * Perform a **POST** request with the same behavior as {@link get}:
	 * overflow switching and HTTP failover when enabled.
	 */
	async post(target: ResolvedTarget, path: string, body: any, signalOrOptions?: AbortSignal | ProviderPostOptions): Promise<Response> {
		const options = normalizePostOptions(signalOrOptions);
		const initial = this.switchProviderWhenOverflow
			? await this.preemptivePost(target, path, body, options)
			: await this.capturePost(target, path, body, options, "queue");
		if (initial.ok) return initial.response;

		if (!this.switchProviderOnFailure || !this.isFailoverFailure(initial.error, options.signal)) throw initial.error;

		this.logger.warn("POST failed on provider", initial.target.provider, "-> attempting failover");
		return this.failoverPost(initial.target, path, body, options, new Set([initial.target.provider]), initial.error);
	}

	/**
	 * **HTTP failover (GET)** - one attempt on each remaining provider.
	 *
	 * After the selected provider fails (after its retries), visit each remaining
	 * provider on the same network at most once with retries disabled.
	 *
	 * - Retryable HTTP errors (429, 5xx) and network errors trigger failover.
	 * - Non-retryable errors (4xx except 429) are thrown immediately.
	 * - If no other provider is available, the exact original error is thrown.
	 */
	private async failoverGet(
		failedTarget: ResolvedTarget,
		path: string,
		params: Record<string, any> | undefined,
		signal: AbortSignal | undefined,
		timeoutMs: number | undefined,
		attempted: Set<ProviderName>,
		originalError: unknown
	): Promise<ProviderGetResponse> {
		let lastError = originalError;
		const capacityBlocked: ResolvedTarget[] = [];
		for (const provider of this.providersForNetwork(failedTarget.provider, failedTarget.network)) {
			if (attempted.has(provider)) continue;
			attempted.add(provider);
			const alternate = this.resolve(provider, failedTarget.network);
			this.logger.debug("Failover: trying provider", provider);

			const behavior: LimiterBehavior = this.switchProviderWhenOverflow ? "overflow" : "queue";
			const outcome = await this.captureGet(alternate, path, params, signal, timeoutMs, behavior, { enabled: false });
			if (outcome.ok) {
				return { response: outcome.response, target: outcome.target, requestUrl: outcome.requestUrl };
			}
			if (this.switchProviderWhenOverflow && outcome.error instanceof LimiterCapacityError) {
				capacityBlocked.push(alternate);
				this.logger.warn("Failover overflow on", provider, "-> trying next provider");
				continue;
			}
			lastError = outcome.error;
			if (!this.isFailoverFailure(lastError, signal)) throw lastError;
		}

		// Capacity probes do not issue HTTP requests. Queue the blocked targets in
		// deterministic order and retain the same failover rules for their eventual
		// HTTP attempts. Stopping after the first queued failure would leave an
		// untried healthy provider, contrary to the failover contract.
		if (this.switchProviderWhenOverflow && capacityBlocked.length > 0) {
			for (const queued of capacityBlocked) {
				this.logger.debug("Failover provider was at capacity; queueing on", queued.provider);
				const outcome = await this.captureGet(queued, path, params, signal, timeoutMs, "queue", { enabled: false });
				if (outcome.ok) return { response: outcome.response, target: outcome.target, requestUrl: outcome.requestUrl };
				lastError = outcome.error;
				if (!this.isFailoverFailure(lastError, signal)) throw lastError;
			}
		}

		throw lastError;
	}

	/**
	 * **HTTP failover (POST)** - one attempt on each remaining provider.
	 */
	private async failoverPost(
		failedTarget: ResolvedTarget,
		path: string,
		body: any,
		options: ProviderPostOptions,
		attempted: Set<ProviderName>,
		originalError: unknown
	): Promise<Response> {
		let lastError = originalError;
		const capacityBlocked: ResolvedTarget[] = [];
		for (const provider of this.providersForNetwork(failedTarget.provider, failedTarget.network)) {
			if (attempted.has(provider)) continue;
			attempted.add(provider);
			const alternate = this.resolve(provider, failedTarget.network);
			this.logger.debug("Failover POST: trying provider", provider);

			const behavior: LimiterBehavior = this.switchProviderWhenOverflow ? "overflow" : "queue";
			const outcome = await this.capturePost(alternate, path, body, options, behavior, { enabled: false });
			if (outcome.ok) return outcome.response;
			if (this.switchProviderWhenOverflow && outcome.error instanceof LimiterCapacityError) {
				capacityBlocked.push(alternate);
				this.logger.warn("Failover POST overflow on", provider, "-> trying next provider");
				continue;
			}
			lastError = outcome.error;
			if (!this.isFailoverFailure(lastError, options.signal)) throw lastError;
		}

		if (this.switchProviderWhenOverflow && capacityBlocked.length > 0) {
			for (const queued of capacityBlocked) {
				this.logger.debug("POST failover provider was at capacity; queueing on", queued.provider);
				const outcome = await this.capturePost(queued, path, body, options, "queue", { enabled: false });
				if (outcome.ok) return outcome.response;
				lastError = outcome.error;
				if (!this.isFailoverFailure(lastError, options.signal)) throw lastError;
			}
		}

		throw lastError;
	}

	private isRetryableStatus(status: number) {
		return (status >= 300 && status < 400) || status === 429 || status >= 500;
	}

	private isFailoverFailure(error: unknown, signal?: AbortSignal): boolean {
		if (isAbortFailure(error, signal)) return false;
		if (error instanceof HttpError) return this.isRetryableStatus(error.status);
		return error instanceof HttpNetworkError;
	}
}
