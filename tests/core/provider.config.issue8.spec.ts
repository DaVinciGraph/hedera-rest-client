import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/core/provider";
import type { HederaRestClientConfig, LimiterConfig, NetworkConfig, RetryPolicy } from "../../src/types";

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return Object.freeze(value);
}

function configWithHttpOverrides(): HederaRestClientConfig {
	return {
		defaultProvider: "p",
		defaultNetwork: "testnet",
		provider: {
			p: {
				headers: { "x-provider": "provider" },
				page: { defaultLimit: 20, maxLimit: 200 },
				http: {
					limiter: { reservoir: 20, minTime: 5, maxConcurrent: 2 },
					retry: {
						enabled: true,
						maxAttempts: 5,
						initialDelayMs: 50,
						maxDelayMs: 500,
						backoff: "fixed",
						on429: false,
						on5xx: false,
						onNetworkError: true,
						honorRetryAfter: false,
					},
				},
				testnet: {
					url: "https://test.example",
					headers: { "x-network": "testnet" },
					page: { defaultLimit: 30, maxLimit: 300 },
					http: {
						retry: { maxAttempts: 2, on5xx: true },
						limiter: { reservoir: 3 },
					},
				},
				mainnet: { url: "https://main.example" },
			},
		},
	};
}

describe("ProviderRegistry issue 8 configuration semantics", () => {
	it("constructs from a deeply frozen configuration without mutating it", () => {
		const config = configWithHttpOverrides();
		const before = structuredClone(config);
		deepFreeze(config);

		expect(() => new ProviderRegistry(config)).not.toThrow();
		expect(config).toEqual(before);
		expect(Object.isFrozen(config.provider?.p.testnet?.http?.retry)).toBe(true);
	});

	it("does not mutate a mutable caller-owned configuration during construction", () => {
		const config = configWithHttpOverrides();
		const before = structuredClone(config);

		new ProviderRegistry(config);

		expect(config).toEqual(before);
	});

	it("snapshots provider configuration so later caller mutations cannot change resolution", () => {
		const providerHeaders = { "x-provider": "original-provider" };
		const networkHeaders = { "x-network": "original-network" };
		const providerRetry: RetryPolicy = { enabled: true, maxAttempts: 4, on5xx: false };
		const providerLimiter: LimiterConfig = { reservoir: 12, minTime: 5 };
		const providerPage = { defaultLimit: 20, maxLimit: 200 };
		const network: NetworkConfig = {
			url: "https://original.example",
			headers: networkHeaders,
			http: { retry: { maxAttempts: 2 } },
		};
		const config: HederaRestClientConfig = {
			defaultProvider: "p",
			defaultNetwork: "testnet",
			provider: {
				p: {
					headers: providerHeaders,
					page: providerPage,
					http: { retry: providerRetry, limiter: providerLimiter },
					testnet: network,
				},
			},
		};
		const registry = new ProviderRegistry(config);

		providerHeaders["x-provider"] = "changed-provider";
		networkHeaders["x-network"] = "changed-network";
		providerRetry.enabled = false;
		providerRetry.on5xx = true;
		providerLimiter.reservoir = 99;
		providerPage.defaultLimit = 99;
		network.url = "https://changed.example";
		network.http!.retry!.maxAttempts = 99;

		const target = registry.resolve();
		expect(target.baseUrl).toBe("https://original.example");
		expect(target.headers).toEqual({ "x-network": "original-network", "x-provider": "original-provider" });
		expect(target.http.retry).toMatchObject({ enabled: true, maxAttempts: 2, on5xx: false });
		expect(target.http.limiter).toEqual({ reservoir: 12, minTime: 5 });
		expect(target.page).toEqual({ defaultLimit: 20, maxLimit: 200 });
	});

	it("returns fresh nested target structures on every resolution", () => {
		const registry = new ProviderRegistry(configWithHttpOverrides());
		const first = registry.resolve("p", "testnet");
		const second = registry.resolve("p", "testnet");

		expect(first).not.toBe(second);
		expect(first.http).not.toBe(second.http);
		expect(first.http.retry).not.toBe(second.http.retry);
		expect(first.http.limiter).not.toBe(second.http.limiter);
		expect(first.headers).not.toBe(second.headers);
		expect(first.page).not.toBe(second.page);

		first.http.retry!.maxAttempts = 99;
		first.http.limiter!.reservoir = 99;
		first.headers["x-provider"] = "changed";
		first.page.defaultLimit = 99;

		expect(registry.resolve("p", "testnet")).toMatchObject({
			headers: { "x-network": "testnet", "x-provider": "provider" },
			http: {
				limiter: { reservoir: 3 },
				retry: { maxAttempts: 2 },
			},
			page: { defaultLimit: 30, maxLimit: 300 },
		});
	});

	it("merges retry fields from provider then network while treating undefined as omitted", () => {
		const config = configWithHttpOverrides();
		config.provider!.p.testnet!.http!.retry = {
			enabled: undefined,
			maxAttempts: 2,
			initialDelayMs: undefined,
			on5xx: true,
		};

		const retry = new ProviderRegistry(config).resolve().http.retry;

		expect(retry).toEqual({
			enabled: true,
			maxAttempts: 2,
			initialDelayMs: 50,
			maxDelayMs: 500,
			backoff: "fixed",
			on429: false,
			on5xx: true,
			onNetworkError: true,
			honorRetryAfter: false,
		});
	});

	it("uses an explicit network limiter as a complete isolated override", () => {
		const registry = new ProviderRegistry(configWithHttpOverrides());
		const target = registry.resolve("p", "testnet");

		expect(target.http.limiter).toEqual({ reservoir: 3 });
		expect(target.limiterBucket).toBeDefined();
		expect(target.limiterBucket).not.toBe(registry.resolve("p", "mainnet").limiterBucket);
	});

	it("otherwise inherits the provider limiter and its shared provider bucket", () => {
		const target = new ProviderRegistry(configWithHttpOverrides()).resolve("p", "mainnet");

		expect(target.http.limiter).toEqual({ reservoir: 20, minTime: 5, maxConcurrent: 2 });
		expect(target.limiterBucket).toBeDefined();
	});

	it("keeps limiter settings deterministic regardless of network resolution order", async () => {
		async function resolveInOrder(networks: Array<"testnet" | "mainnet">) {
			const config = configWithHttpOverrides();
			config.provider!.p.mainnet!.http = { limiter: { reservoir: 7 } };
			const registry = new ProviderRegistry(config);
			const state: Record<string, { bucket: string | undefined; reservoir: number | null }> = {};
			const limiters = new Set<NonNullable<ReturnType<ReturnType<ProviderRegistry["getLimiterReg"]>["get"]>>>();

			for (const network of networks) {
				const target = registry.resolve("p", network);
				const limiter = registry.getLimiterReg().get(target.limiterBucket!, target.http.limiter);
				if (!limiter) throw new Error(`Expected limiter for ${network}`);
				limiters.add(limiter);
				state[network] = {
					bucket: target.limiterBucket,
					reservoir: await limiter.currentReservoir(),
				};
			}

			await Promise.all(Array.from(limiters, (limiter) => limiter.stop()));
			return state;
		}

		const forward = await resolveInOrder(["testnet", "mainnet"]);
		const reverse = await resolveInOrder(["mainnet", "testnet"]);

		expect(forward.testnet.reservoir).toBe(3);
		expect(forward.mainnet.reservoir).toBe(7);
		expect(forward.testnet.bucket).not.toBe(forward.mainnet.bucket);
		expect(reverse).toEqual(forward);
	});

	it("cannot collide provider-scoped and network-scoped limiter buckets", async () => {
		const registry = new ProviderRegistry({
			defaultProvider: "a:b",
			defaultNetwork: "x",
			provider: {
				"a:b": {
					http: { limiter: { reservoir: 1 } },
					networks: { x: { url: "https://provider-scope.example" } },
				},
				a: {
					networks: {
						b: { url: "https://network-scope.example", http: { limiter: { reservoir: 9 } } },
					},
				},
			},
		});
		const providerScoped = registry.resolve("a:b", "x");
		const networkScoped = registry.resolve("a", "b");

		expect(providerScoped.limiterBucket).not.toBe(networkScoped.limiterBucket);
		const providerLimiter = registry.getLimiterReg().get(providerScoped.limiterBucket!, providerScoped.http.limiter)!;
		const networkLimiter = registry.getLimiterReg().get(networkScoped.limiterBucket!, networkScoped.http.limiter)!;
		try {
			expect(providerLimiter).not.toBe(networkLimiter);
			expect(await providerLimiter.currentReservoir()).toBe(1);
			expect(await networkLimiter.currentReservoir()).toBe(9);
		} finally {
			await Promise.all([providerLimiter.stop(), networkLimiter.stop()]);
		}
	});

	it("does not leak HTTP settings when one NetworkConfig object is shared by providers", () => {
		const sharedNetwork: NetworkConfig = { url: "https://shared.example" };
		const config: HederaRestClientConfig = {
			defaultProvider: "first",
			defaultNetwork: "testnet",
			provider: {
				first: {
					http: { retry: { enabled: true, maxAttempts: 2 }, limiter: { reservoir: 2 } },
					testnet: sharedNetwork,
				},
				second: {
					http: { retry: { enabled: false, maxAttempts: 9 }, limiter: { reservoir: 9 } },
					testnet: sharedNetwork,
				},
			},
		};

		const registry = new ProviderRegistry(config);

		expect(registry.resolve("first", "testnet").http).toMatchObject({
			retry: { enabled: true, maxAttempts: 2 },
			limiter: { reservoir: 2 },
		});
		expect(registry.resolve("second", "testnet").http).toMatchObject({
			retry: { enabled: false, maxAttempts: 9 },
			limiter: { reservoir: 9 },
		});
		expect(sharedNetwork).toEqual({ url: "https://shared.example" });
	});

	it("does not resolve inherited object properties as provider or network names", () => {
		const registry = new ProviderRegistry({
			defaultProvider: "p",
			defaultNetwork: "testnet",
			provider: {
				p: { testnet: { url: "https://test.example" } },
			},
		});

		expect(() => registry.resolve("toString", "testnet")).toThrow("Unknown provider: toString");
		expect(() => registry.resolve("p", "toString")).toThrow("Provider 'p' does not define network 'toString'");
	});

	it("still supports own provider and network names that match object prototype keys", () => {
		const registry = new ProviderRegistry({
			defaultProvider: "toString",
			defaultNetwork: "constructor",
			provider: {
				toString: {
					networks: {
						constructor: { url: "https://prototype-names.example" },
					},
				},
			},
		});

		expect(registry.resolve().baseUrl).toBe("https://prototype-names.example");
	});
});
