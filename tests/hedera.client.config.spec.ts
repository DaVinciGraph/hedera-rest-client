import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { HederaRestClient } from "../src/HederaRestClient";
import { ProviderRegistry } from "../src/core/provider";
import { ConfigError } from "../src/core/errors";

// Resource builder classes for type/instance sanity checks
import { AccountsBuilder } from "../src/resources/accounts/builder";
import { BalancesBuilder } from "../src/resources/balances/builder";
import { BlocksBuilder } from "../src/resources/blocks/builder";
import { SchedulesBuilder } from "../src/resources/schedules/builder";
import { TokensBuilder } from "../src/resources/tokens/builder";
import { TopicsBuilder } from "../src/resources/topics/builder";
import { TransactionsBuilder } from "../src/resources/transactions/builder";
import { ContractsBuilder } from "../src/resources/contracts/builder";
import { NetworkBuilder } from "../src/resources/network/builder";

import type { CacheAdapter } from "../src/types";

const okJson = (data: any) => ({ json: async () => data, text: async () => JSON.stringify(data) } as any);

describe("HederaRestClient — config behavior", () => {
	let getSpy: ReturnType<typeof vi.spyOn>;
	let postSpy: ReturnType<typeof vi.spyOn>;
	let loggerSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Default GET/POST return a trivial payload
		getSpy = vi.spyOn(ProviderRegistry.prototype as any, "get").mockResolvedValue(okJson({ ok: true }) as any);
		vi.spyOn(ProviderRegistry.prototype as any, "getWithTarget").mockImplementation(async (target: any, path: string, query?: any, signal?: AbortSignal) => {
			const response = await (getSpy as any)(target, path, query, signal);
			return {
				response,
				target,
				requestUrl: new URL(path, `${target.baseUrl}/`).toString(),
			};
		});

		postSpy = vi.spyOn(ProviderRegistry.prototype as any, "post").mockResolvedValue(okJson({ ok: true }) as any);

		// Stub logger so we can assert init message
		loggerSpy = vi.spyOn(ProviderRegistry.prototype as any, "getLogger").mockReturnValue({
			info: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("constructs with defaults, exposes resource factories & emits init log", () => {
		const client = new HederaRestClient({});

		// Logger.info called once with expected init message
		const logger = loggerSpy.mock.results[0].value as any;
		expect(logger.info).toHaveBeenCalledTimes(1);
		const [msg, meta] = logger.info.mock.calls[0];
		expect(msg).toBe("HederaRestClient initialized");
		expect(meta).toEqual(
			expect.objectContaining({
				defaults: { provider: "public", network: "testnet" },
			})
		);

		// Resource factories exist and return expected builder instances
		expect(client.accounts()).toBeInstanceOf(AccountsBuilder);
		expect(client.balances()).toBeInstanceOf(BalancesBuilder);
		expect(client.blocks()).toBeInstanceOf(BlocksBuilder);
		expect(client.schedules()).toBeInstanceOf(SchedulesBuilder);
		expect(client.tokens()).toBeInstanceOf(TokensBuilder);
		expect(client.topics()).toBeInstanceOf(TopicsBuilder);
		expect(client.transactions()).toBeInstanceOf(TransactionsBuilder);
		expect(client.contracts()).toBeInstanceOf(ContractsBuilder);
		expect(client.network()).toBeInstanceOf(NetworkBuilder);

		// limits() returns sensible numbers (we only assert shape/positivity)
		const limits = client.limits();
		expect(limits.default).toBeGreaterThan(0);
		expect(limits.max).toBeGreaterThanOrEqual(limits.default);
	});

	it("scoped useProvider/useNetwork impacts resolved target used by builders", async () => {
		const client = new HederaRestClient({});

		let capturedProvider: string | undefined;
		let capturedNetwork: string | undefined;

		getSpy.mockImplementationOnce(async (target: any) => {
			capturedProvider = target.provider;
			capturedNetwork = target.network;
			// Provide a payload a paged endpoint might expect
			return okJson({ messages: [], links: {} });
		});

		// Choose a simple GET that doesn't require complex shapes
		await client.useProvider("public").useNetwork("mainnet").topics().messages({ topicId: "0.0.9" }).get();

		expect(capturedProvider).toBe("public");
		expect(capturedNetwork).toBe("mainnet");
	});

	it("rejects missing or empty names at every public scoping boundary", () => {
		const client = new HederaRestClient({});
		expect(() => client.useProvider(null as any)).toThrow(ConfigError);
		expect(() => client.useNetwork(undefined as any)).toThrow(ConfigError);
		expect(() => client.useProvider(" ")).toThrow(ConfigError);

		const scoped = client.useProvider("public");
		expect(() => scoped.useProvider(null as any)).toThrow(ConfigError);
		expect(() => scoped.useNetwork(undefined as any)).toThrow(ConfigError);
	});

	it("applies per-resource TTLs and prefixes cache keys with the scoped network", async () => {
		const setCalls: Array<{ key: string; ttl: number; value: any }> = [];
		const adapter: CacheAdapter<any> = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(async (key, value, ttl) => {
				setCalls.push({ key, ttl, value });
			}),
		};

		const client = new HederaRestClient({
			cache: {
				isEnabled: true,
				duration: 333, // global fallback
				adapter,
				resources: {
					topics: { duration: 60 },
					transactions: { duration: 70 },
					contracts: { duration: 80 },
					// tokens: { duration: 40 }, // if/when you need it
				},
			},
		});

		// Ensure GET returns shapes that cacheable endpoints expect
		getSpy
			.mockResolvedValueOnce(okJson({ topic_id: "0.0.123" })) // topics.one
			.mockResolvedValueOnce(okJson({})) // transactions.byId
			.mockResolvedValueOnce(okJson({})); // contracts.one

		// 1) topics.one — scoped to mainnet; TTL from resources.topics = 60
		await client.useNetwork("mainnet").topics().one({ topicId: "0.0.123", useCache: true }).get();

		// 2) transactions.byId — default testnet; TTL from resources.transactions = 70
		await client.transactions().byId({ transactionId: "0.0.7-1700-1", useCache: true }).get();

		// 3) contracts.one — default testnet; TTL from resources.contracts = 80
		await client.contracts().one({ idOrAddress: "0.0.5005", useCache: true }).get();

		// Assertions for network-prefixed keys & TTLs
		// We only check prefix + TTL because the inner cacheKey format belongs to each mapper.
		const k0 = setCalls[0]!.key;
		expect(k0.startsWith('hedera-rest-client:2:"mainnet":')).toBe(true);
		expect(setCalls[0]!.ttl).toBe(60);

		const k1 = setCalls[1]!.key;
		expect(k1.startsWith('hedera-rest-client:2:"testnet":')).toBe(true);
		expect(setCalls[1]!.ttl).toBe(70);

		const k2 = setCalls[2]!.key;
		expect(k2.startsWith('hedera-rest-client:2:"testnet":')).toBe(true);
		expect(setCalls[2]!.ttl).toBe(80);

		// And the adapter.set was invoked for every cacheable call
		expect(adapter.set).toHaveBeenCalledTimes(3);
	});

	it("falls back to global cache duration when per-resource TTL is not provided", async () => {
		const setCalls: Array<{ key: string; ttl: number; value: any }> = [];
		const adapter: CacheAdapter<any> = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(async (key, value, ttl) => {
				setCalls.push({ key, ttl, value });
			}),
		};

		const client = new HederaRestClient({
			cache: {
				isEnabled: true,
				duration: 333, // global fallback
				adapter,
				resources: {}, // purposely omit 'transactions' to test fallback
			},
		});

		getSpy.mockResolvedValueOnce(okJson({}));

		await client.transactions().byId({ transactionId: "0.0.7-1700-1", useCache: true }).get();

		expect(adapter.set).toHaveBeenCalledTimes(1);
		expect(setCalls[0]!.ttl).toBe(333);
		expect(setCalls[0]!.key.startsWith('hedera-rest-client:2:"testnet":')).toBe(true);
	});

	it("performs no cache I/O when the global master switch is disabled", async () => {
		const adapter: CacheAdapter<any> = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(), // should not be called
		};

		const client = new HederaRestClient({
			cache: {
				isEnabled: false,
				duration: 600,
				adapter,
				resources: { contracts: { isEnabled: true } },
			},
		});

		getSpy.mockResolvedValueOnce(okJson({}));

		await client.contracts().one({ idOrAddress: "0.0.9999", useCache: true }).get();

		expect(adapter.get).not.toHaveBeenCalled();
		expect(adapter.set).not.toHaveBeenCalled();
	});

	it("rejects an explicitly empty provider map instead of routing to public testnet", () => {
		expect(() => new HederaRestClient({ provider: {} })).toThrow(ConfigError);
	});

	it("allows an enabled global cache to opt out one resource", async () => {
		const adapter: CacheAdapter<any> = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(),
		};
		const client = new HederaRestClient({
			cache: {
				isEnabled: true,
				adapter,
				resources: { tokens: { isEnabled: false } },
			},
		});

		getSpy.mockResolvedValueOnce(okJson({ token_id: "0.0.9999" }));
		await client.tokens().one({ tokenId: "0.0.9999", useCache: true }).get();

		expect(adapter.get).not.toHaveBeenCalled();
		expect(adapter.set).not.toHaveBeenCalled();
		expect(getSpy).toHaveBeenCalledTimes(1);
	});

	it("prefixes cache keys with the currently scoped network name", async () => {
		const setKeys: string[] = [];
		const adapter: CacheAdapter<any> = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(async (key) => {
				setKeys.push(key);
			}),
		};

		const client = new HederaRestClient({
			cache: {
				isEnabled: true,
				duration: 111,
				adapter,
				resources: { contracts: {} },
			},
		});

		getSpy
			.mockResolvedValueOnce(okJson({})) // mainnet call
			.mockResolvedValueOnce(okJson({})); // testnet call

		// First on mainnet
		await client.useNetwork("mainnet").contracts().one({ idOrAddress: "0.0.1", useCache: true }).get();

		// Then on testnet
		await client.useNetwork("testnet").contracts().one({ idOrAddress: "0.0.2", useCache: true }).get();

		expect(setKeys[0]!.startsWith('hedera-rest-client:2:"mainnet":')).toBe(true);
		expect(setKeys[1]!.startsWith('hedera-rest-client:2:"testnet":')).toBe(true);
	});

	it("writes fresh responses without useCache and shares them across providers on the same network", async () => {
		const store = new Map<string, { value: any; expiresAt: number }>();
		const adapter: CacheAdapter<any> = {
			get: vi.fn(async (key) => store.get(key)),
			set: vi.fn(async (key, value, ttlSeconds) => {
				store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
			}),
		};

		const client = new HederaRestClient({
			defaultProvider: "public",
			defaultNetwork: "testnet",
			provider: {
				public: { testnet: { url: "https://public.example" } },
				arkhia: { testnet: { url: "https://arkhia.example" } },
			},
			cache: { isEnabled: true, duration: 120, adapter },
		});

		getSpy.mockImplementation(async (target: any) => okJson({ token_id: "0.0.123", served_by: target.provider }));

		const fresh = await client.useProvider("arkhia").tokens().one({ tokenId: "0.0.123" }).get();
		expect(fresh).toMatchObject({ served_by: "arkhia" });
		expect(adapter.get).not.toHaveBeenCalled();
		expect(adapter.set).toHaveBeenCalledWith('hedera-rest-client:2:"testnet":token:0.0.123:', fresh, 120);

		const cached = await client.useProvider("public").tokens().one({ tokenId: "0.0.123", useCache: true }).get();
		expect(cached).toEqual(fresh);
		expect(getSpy).toHaveBeenCalledTimes(1);
		expect(adapter.get).toHaveBeenCalledWith('hedera-rest-client:2:"testnet":token:0.0.123:');
	});

	it("isolates cache entries by the network resolved when get() executes", async () => {
		const legacyKey = "mainnet:token:0.0.456:";
		const store = new Map<string, { value: any; expiresAt: number }>([
			[legacyKey, { value: { token_id: "0.0.456", network: "legacy" }, expiresAt: Number.MAX_SAFE_INTEGER }],
		]);
		const adapter: CacheAdapter<any> = {
			get: vi.fn(async (key) => store.get(key)),
			set: vi.fn(async (key, value, ttlSeconds) => {
				store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
			}),
		};

		const client = new HederaRestClient({
			defaultProvider: "public",
			defaultNetwork: "testnet",
			provider: {
				public: {
					testnet: { url: "https://testnet.example" },
					mainnet: { url: "https://mainnet.example" },
				},
			},
			cache: { isEnabled: true, duration: 120, adapter },
		});

		getSpy.mockImplementation(async (target: any) => okJson({ token_id: "0.0.456", network: target.network }));
		const tokens = client.tokens();

		const mainnetFresh = await tokens.network("mainnet").one({ tokenId: "0.0.456" }).get();
		const testnetMiss = await tokens.network("testnet").one({ tokenId: "0.0.456", useCache: true }).get();
		const mainnetHit = await tokens.network("mainnet").one({ tokenId: "0.0.456", useCache: true }).get();

		expect(mainnetFresh).toMatchObject({ network: "mainnet" });
		expect(testnetMiss).toMatchObject({ network: "testnet" });
		expect(mainnetHit).toEqual(mainnetFresh);
		expect(getSpy).toHaveBeenCalledTimes(2);
		expect(adapter.get).toHaveBeenCalledWith('hedera-rest-client:2:"testnet":token:0.0.456:');
		expect(adapter.get).toHaveBeenCalledWith('hedera-rest-client:2:"mainnet":token:0.0.456:');
		expect(adapter.get).not.toHaveBeenCalledWith(legacyKey);
	});
});
