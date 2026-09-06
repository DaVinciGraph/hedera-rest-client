import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/core/provider";
import { ConfigError } from "../../src/core/errors";
import { LimiterCapacityError } from "../../src/core/limiter";
import { HederaRestClient } from "../../src/HederaRestClient";
import type { HederaRestClientConfig } from "../../src/types";

function registryFor(url: string, networkConfig: Record<string, unknown> = {}, providerConfig: Record<string, unknown> = {}) {
	const config: HederaRestClientConfig = {
		defaultProvider: "custom",
		defaultNetwork: "testnet",
		provider: {
			custom: {
				...providerConfig,
				testnet: { url, ...networkConfig },
			},
		},
	};
	return new ProviderRegistry(config);
}

function spyOnRequests(registry: ProviderRegistry) {
	return vi.spyOn(registry.getHttp(), "request").mockResolvedValue(new Response("{}", { status: 200 }));
}

describe("ProviderRegistry URL configuration", () => {
	it.each([
		["https://mirror.example", "https://mirror.example/api/v1/accounts?limit=10"],
		["https://mirror.example/", "https://mirror.example/api/v1/accounts?limit=10"],
	])("appends API paths to a public-style origin URL (%s)", async (configuredUrl, expectedUrl) => {
		const registry = registryFor(configuredUrl);
		const request = spyOnRequests(registry);

		await registry.get(registry.resolve(), "/api/v1/accounts", { limit: 10 });

		expect(request).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({ method: "GET" }), expect.any(Object));
	});

	it.each([
		["https://pool.arkhia.io/hedera/testnet", "https://pool.arkhia.io/hedera/testnet/api/v1/accounts"],
		["https://pool.arkhia.io/hedera/testnet/", "https://pool.arkhia.io/hedera/testnet/api/v1/accounts"],
		["https://pool.arkhia.io/hedera/testnet/api/v1", "https://pool.arkhia.io/hedera/testnet/api/v1/accounts"],
		["https://pool.arkhia.io/hedera/testnet/api/v1/", "https://pool.arkhia.io/hedera/testnet/api/v1/accounts"],
	])("preserves path prefixes and adds /api/v1 exactly once (%s)", async (configuredUrl, expectedUrl) => {
		const registry = registryFor(configuredUrl);
		const request = spyOnRequests(registry);

		await registry.get(registry.resolve(), "/api/v1/accounts");

		expect(request).toHaveBeenCalledWith(expectedUrl, expect.any(Object), expect.any(Object));
	});

	it("does not duplicate a configured prefix already present in a pagination path", async () => {
		const registry = registryFor("https://pool.arkhia.io/hedera/testnet/api/v1");
		const request = spyOnRequests(registry);

		await registry.get(registry.resolve(), "/hedera/testnet/api/v1/accounts?cursor=next");

		expect(request.mock.calls[0][0]).toBe("https://pool.arkhia.io/hedera/testnet/api/v1/accounts?cursor=next");
	});

	it.each([
		"mirror.example",
		"ftp://mirror.example/api/v1",
		"https://user:password@mirror.example/api/v1",
		"https://mirror.example/api/v1?token=secret",
		"https://mirror.example/api/v1#accounts",
	])(
		"rejects an ambiguous or unsupported provider URL (%s)",
		(configuredUrl) => {
			expect(() => registryFor(configuredUrl)).toThrow(ConfigError);
		}
	);
});

describe("ProviderRegistry construction-time validation", () => {
	function construct(network: unknown, providerExtras: Record<string, unknown> = {}) {
		return () =>
			new ProviderRegistry({
				defaultProvider: "custom",
				defaultNetwork: "testnet",
				provider: { custom: { ...providerExtras, testnet: network } as any },
			});
	}

	it.each([
		[{ url: "https://mirror.example", page: { defaultLimit: 0 } }],
		[{ url: "https://mirror.example", page: { defaultLimit: 20, maxLimit: 10 } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoir: -1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoirRefreshInterval: 1000 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoirRefreshInterval: 1000, reservoirRefreshAmount: 1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoir: 1, reservoirRefreshInterval: 2_147_483_648, reservoirRefreshAmount: 1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoir: 1, reservoirRefreshInterval: 249, reservoirRefreshAmount: 1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoir: 1, reservoirRefreshInterval: 251, reservoirRefreshAmount: 1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { reservoir: 1, reservoirRefreshInterval: 250.5, reservoirRefreshAmount: 1 } } }],
		[{ url: "https://mirror.example", http: { limiter: { minTime: 2_147_483_648 } } }],
		[{ url: "https://mirror.example", http: { limiter: { minTime: 0.5 } } }],
		[{ url: "https://mirror.example", http: { limiter: { maxConcurrent: 0 } } }],
		[{ url: "https://mirror.example", http: { retry: { enabled: false, maxAttempts: 0 } } }],
		[{ url: "https://mirror.example", http: { retry: { initialDelayMs: Number.NaN } } }],
		[{ url: "https://mirror.example", http: { retry: { initialDelayMs: 0.5 } } }],
		[{ url: "https://mirror.example", http: { retry: { maxDelayMs: 2_147_483_648 } } }],
		[{ url: "https://mirror.example", http: { retry: { backoff: "linear" } } }],
		[{ url: "https://mirror.example", http: { timeoutMs: 2_147_483_648 } }],
		[{ url: "https://mirror.example", headers: { "x-api-key": 123 } }],
		[{ url: "https://mirror.example", apiKey: { key: "x-api-key", value: "" } }],
		[{ url: "https://mirror.example", http: null }],
		[null],
	])("rejects malformed provider/network configuration as ConfigError (%o)", (network) => {
		expect(construct(network)).toThrow(ConfigError);
	});

	it("allows an empty ordinary HTTP header value", () => {
		expect(construct({ url: "https://mirror.example", headers: { "x-optional": "" } })).not.toThrow();
	});

	it("accepts Bottleneck's minimum valid local reservoir refresh interval", () => {
		expect(
			construct({
				url: "https://mirror.example",
				http: { limiter: { reservoir: 1, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 } },
			})
		).not.toThrow();
	});

	it("rejects invalid top-level flags and invalid defaults as ConfigError", () => {
		expect(() => new ProviderRegistry({ log: "yes" } as any)).toThrow(ConfigError);
		expect(() => new ProviderRegistry({ defaultProvider: "" } as any)).toThrow(ConfigError);
		expect(
			() =>
				new ProviderRegistry({
					defaultProvider: "missing",
					defaultNetwork: "testnet",
					provider: { custom: { testnet: { url: "https://mirror.example" } } },
				})
		).toThrow(ConfigError);
	});

	it.each([
		["NetworkConfig", { url: "https://mirror.example", timeotMs: 10 }, "timeotMs"],
		["ApiKey", { url: "https://mirror.example", apiKey: { key: "x-api-key", value: "secret", header: true } }, "header"],
		["HttpConfig", { url: "https://mirror.example", http: { timeotMs: 10 } }, "timeotMs"],
		["RetryPolicy", { url: "https://mirror.example", http: { retry: { enable: true } } }, "enable"],
		["LimiterConfig", { url: "https://mirror.example", http: { limiter: { maxConcurent: 2 } } }, "maxConcurent"],
		["PageConfig", { url: "https://mirror.example", page: { defautLimit: 10 } }, "defautLimit"],
		[
			"PageLimitConfig",
			{ url: "https://mirror.example", page: { endpoints: { "network.nodes": { maxLmit: 25 } } } },
			"maxLmit",
		],
	] as const)("rejects unknown %s keys", (_shape, network, typo) => {
		expect(construct(network as any)).toThrowError(new RegExp(typo));
	});

	it("rejects unknown root keys in both construction entry points", () => {
		expect(() => new ProviderRegistry({ switchProviderOnFailur: true } as any)).toThrowError(/switchProviderOnFailur/);
		expect(() => new HederaRestClient({ switchProviderOnFailur: true } as any)).toThrowError(/switchProviderOnFailur/);
	});

	it("does not let undefined hide a misspelled direct provider option", () => {
		expect(construct({ url: "https://mirror.example" }, { heders: undefined })).toThrowError(/heders/);
		expect(construct({ url: "https://mirror.example" }, { mainnet: undefined })).not.toThrow();
	});

	it("requires plain config records and rejects symbol keys on fixed-shape configs", () => {
		class ConfigLike {}
		expect(() => new ProviderRegistry(new ConfigLike() as any)).toThrow(ConfigError);
		expect(() => new HederaRestClient(new Date() as any)).toThrow(ConfigError);
		expect(construct(new Map() as any)).toThrow(ConfigError);

		const symbolConfig = { defaultNetwork: "testnet" } as any;
		symbolConfig[Symbol("typo")] = true;
		expect(() => new ProviderRegistry(symbolConfig)).toThrow(ConfigError);

		const endpointMap = { "network.nodes": { maxLimit: 25 } } as any;
		endpointMap[Symbol("endpoint")] = { maxLimit: 50 };
		expect(construct({ url: "https://mirror.example", page: { endpoints: endpointMap } })).toThrow(ConfigError);
	});

	it("keeps malformed null-prototype field values inside the ConfigError taxonomy", () => {
		expect(
			construct({ url: "https://mirror.example", page: { defaultLimit: Object.create(null) } } as any)
		).toThrow(ConfigError);
	});

	it("rejects an ambiguous network identity declared directly and in networks", () => {
		expect(
			() =>
				new ProviderRegistry({
					defaultProvider: "custom",
					defaultNetwork: "testnet",
					provider: {
						custom: {
							testnet: { url: "https://direct.example" },
							networks: { testnet: { url: "https://mapped.example" } },
						},
					},
				})
		).toThrowError(/both directly and/);
	});

	it("rejects explicitly empty provider or network names instead of falling back", () => {
		const subject = registryFor("https://mirror.example");
		expect(() => subject.resolve("", "testnet")).toThrow(ConfigError);
		expect(() => subject.resolve("custom", "")).toThrow(ConfigError);
		expect(() => subject.resolve(null as any, "testnet")).toThrow(ConfigError);
		expect(() => subject.resolve("custom", null as any)).toThrow(ConfigError);
	});
});

describe("ProviderRegistry static headers", () => {
	it("merges provider defaults, legacy apiKey, and network headers case-insensitively", async () => {
		const registry = registryFor(
			"https://pool.arkhia.io/hedera/testnet/api/v1",
			{
				apiKey: { key: "X-API-Key", value: "legacy-key" },
				headers: {
					"x-api-key": "network-key",
					"X-API-Secret": "network-secret",
					"X-Scope": "network",
				},
			},
			{
				headers: {
					"x-api-key": "provider-key",
					"x-provider": "provider-value",
					"x-scope": "provider",
				},
			}
		);
		const target = registry.resolve();

		expect(target.headers).toEqual({
			"x-api-key": "network-key",
			"x-api-secret": "network-secret",
			"x-provider": "provider-value",
			"x-scope": "network",
		});

		const request = spyOnRequests(registry);
		await registry.get(target, "/api/v1/accounts");
		expect(request.mock.calls[0][1].headers).toEqual(target.headers);
	});

	it("keeps the legacy apiKey shorthand while operation POST headers override static media types", async () => {
		const registry = registryFor("https://mirror.example/gateway/testnet/api/v1/", {
			apiKey: { key: "X-Legacy-Key", value: "legacy-value" },
			headers: { "Content-Type": "application/hedera+json" },
		});
		const target = registry.resolve();
		expect(target.headers["x-legacy-key"]).toBe("legacy-value");

		const request = spyOnRequests(registry);
		await registry.post(target, "/api/v1/contracts/call", { data: "0x" });

		expect(request.mock.calls[0][0]).toBe("https://mirror.example/gateway/testnet/api/v1/contracts/call");
		expect(request.mock.calls[0][1].headers).toMatchObject({
			"content-type": "application/json",
			"x-legacy-key": "legacy-value",
		});
	});

	it("preserves collision-shaped static header names", () => {
		const headers = JSON.parse('{"__proto__":"secret","x-ok":"yes"}') as Record<string, string>;
		const target = registryFor("https://mirror.example", { headers }).resolve();

		expect(Object.prototype.hasOwnProperty.call(target.headers, "__proto__")).toBe(true);
		expect(target.headers.__proto__).toBe("secret");
		expect(target.headers["x-ok"]).toBe("yes");
	});

	it("supports POST query parameters, request headers, and binary bodies", async () => {
		const registry = registryFor("https://mirror.example/api/v1", {
			headers: { "x-api-key": "secret", "content-type": "application/provider-default" },
		});
		const target = registry.resolve();
		const request = spyOnRequests(registry);
		const transaction = new Uint8Array([0x0a, 0x02, 0x08, 0x01]);
		const signal = new AbortController().signal;

		await registry.post(target, "/api/v1/network/fees", transaction, {
			query: { mode: "STATE", high_volume_throttle: 250 },
			headers: { "Content-Type": "application/protobuf" },
			signal,
		});

		expect(request).toHaveBeenCalledWith(
			"https://mirror.example/api/v1/network/fees?mode=STATE&high_volume_throttle=250",
			{
				method: "POST",
				headers: {
					"content-type": "application/protobuf",
					"x-api-key": "secret",
				},
				body: transaction,
				signal,
			},
			expect.any(Object)
		);
	});

	it("keeps the legacy fourth-position AbortSignal API working", async () => {
		const registry = registryFor("https://mirror.example");
		const target = registry.resolve();
		const request = spyOnRequests(registry);
		const signal = new AbortController().signal;

		await registry.post(target, "/api/v1/contracts/call", { data: "0x" }, signal);

		expect(request.mock.calls[0][1]).toMatchObject({ signal });
	});

	it("preserves POST options while selecting a provider with overflow routing", async () => {
		const registry = new ProviderRegistry({
			defaultProvider: "first",
			defaultNetwork: "testnet",
			switchProviderWhenOverflow: true,
			provider: {
				first: { testnet: { url: "https://first.example" } },
				second: { testnet: { url: "https://second.example" } },
			},
		});
		const overflow = new LimiterCapacityError("first:testnet");
		const schedule = vi
			.spyOn(registry as any, "scheduleOnTargetPOST")
			.mockRejectedValueOnce(overflow)
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		const transaction = new Uint8Array([1, 2, 3]);
		const options = {
			query: { mode: "STATE" },
			headers: { "content-type": "application/protobuf" },
		};

		await registry.post(registry.resolve(), "/api/v1/network/fees", transaction, options);

		expect(schedule).toHaveBeenCalledTimes(2);
		expect(schedule.mock.calls[0].slice(1)).toEqual(["/api/v1/network/fees", transaction, options, "overflow"]);
		expect(schedule.mock.calls[1].slice(1)).toEqual(["/api/v1/network/fees", transaction, options, "overflow"]);
		expect(schedule.mock.calls[0][0].provider).toBe("first");
		expect(schedule.mock.calls[1][0].provider).toBe("second");
	});

	it("preserves binary POST options when failing over to another provider", async () => {
		const registry = new ProviderRegistry({
			defaultProvider: "first",
			defaultNetwork: "testnet",
			switchProviderOnFailure: true,
			provider: {
				first: { testnet: { url: "https://first.example", headers: { "x-provider": "first" } } },
				second: { testnet: { url: "https://second.example", headers: { "x-provider": "second" } } },
			},
		});
		const request = vi
			.spyOn(registry.getHttp(), "request")
			.mockRejectedValueOnce(new (await import("../../src/core/errors")).HttpError(503, "https://first.example/api/v1/network/fees"))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		const transaction = new Uint8Array([1, 2, 3]);

		await registry.post(registry.resolve(), "/api/v1/network/fees", transaction, {
			query: { mode: "INTRINSIC" },
			headers: { "content-type": "application/x-protobuf" },
		});

		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0][0]).toBe("https://first.example/api/v1/network/fees?mode=INTRINSIC");
		expect(request.mock.calls[1][0]).toBe("https://second.example/api/v1/network/fees?mode=INTRINSIC");
		expect(request.mock.calls[0][1]).toMatchObject({
			body: transaction,
			headers: { "content-type": "application/x-protobuf", "x-provider": "first" },
		});
		expect(request.mock.calls[1][1]).toMatchObject({
			body: transaction,
			headers: { "content-type": "application/x-protobuf", "x-provider": "second" },
		});
		expect(request.mock.calls[1][2]).toEqual({ enabled: false });
	});
});

describe("built-in public networks", () => {
	it("includes Hedera previewnet", () => {
		const target = new ProviderRegistry({ defaultNetwork: "previewnet" }).resolve();

		expect(target.provider).toBe("public");
		expect(target.network).toBe("previewnet");
		expect(target.baseUrl).toBe("https://previewnet.mirrornode.hedera.com");
		expect(target.page).toEqual({
			defaultLimit: 25,
			maxLimit: 100,
			endpoints: { "network.nodes": { defaultLimit: 10, maxLimit: 25 } },
		});
	});
});

describe("endpoint-specific page configuration", () => {
	it("merges global and endpoint limits fieldwise across provider and network scopes", () => {
		const subject = registryFor(
			"https://mirror.example",
			{
				page: {
					maxLimit: 100,
					endpoints: {
						"network.nodes": { maxLimit: 25 },
						custom: { maxLimit: 10 },
					},
				},
			},
			{
				page: {
					defaultLimit: 20,
					maxLimit: 200,
					endpoints: {
						"network.nodes": { defaultLimit: 10, maxLimit: 50 },
						custom: { defaultLimit: 5 },
					},
				},
			}
		);

		expect(subject.resolve().page).toEqual({
			defaultLimit: 20,
			maxLimit: 100,
			endpoints: {
				"network.nodes": { defaultLimit: 10, maxLimit: 25 },
				custom: { defaultLimit: 5, maxLimit: 10 },
			},
		});
	});

	it("rejects invalid effective endpoint limits inherited across scopes", () => {
		expect(() =>
			registryFor(
				"https://mirror.example",
				{ page: { endpoints: { "network.nodes": { maxLimit: 25 } } } },
				{ page: { endpoints: { "network.nodes": { defaultLimit: 50 } } } }
			)
		).toThrowError(/network\.nodes/);
	});

	it("snapshots endpoint overrides and preserves collision-prone endpoint names", () => {
		const endpoints = Object.create(null) as Record<string, { defaultLimit?: number; maxLimit?: number }>;
		endpoints.__proto__ = { defaultLimit: 7, maxLimit: 9 };
		const config = {
			defaultProvider: "custom",
			defaultNetwork: "testnet",
			provider: {
				custom: {
					testnet: { url: "https://mirror.example", page: { endpoints } },
				},
			},
		} as const;
		const subject = new ProviderRegistry(config);

		endpoints.__proto__!.maxLimit = 99;
		expect(subject.resolve().page.endpoints?.__proto__).toEqual({ defaultLimit: 7, maxLimit: 9 });
	});
});

describe("custom network identities", () => {
	it("preserves collision-prone provider and direct network identities", () => {
		const provider = Object.create(null) as Record<string, unknown>;
		provider.__proto__ = { url: "https://mirror.example/collision/api/v1" };
		const providers = Object.create(null) as Record<string, unknown>;
		providers.__proto__ = provider;
		const registry = new ProviderRegistry({
			defaultProvider: "__proto__",
			defaultNetwork: "__proto__",
			provider: providers as any,
		});

		const resolved = registry.resolve();
		expect(resolved.provider).toBe("__proto__");
		expect(resolved.network).toBe("__proto__");
		expect(resolved.baseUrl).toBe("https://mirror.example/collision/api/v1");
	});

	it("resolves a custom/fork network from the collision-free networks map", () => {
		const registry = new ProviderRegistry({
			defaultProvider: "fork",
			defaultNetwork: "localnet",
			provider: {
				fork: {
					headers: { "x-provider": "fork" },
					http: { retry: { enabled: true, maxAttempts: 4 } },
					networks: {
						localnet: {
							url: "https://mirror.example/fork/localnet/api/v1",
							headers: { "x-network": "localnet" },
							page: { defaultLimit: 40, maxLimit: 400 },
						},
					},
				},
			},
		});

		const target = registry.resolve();
		expect(target.network).toBe("localnet");
		expect(target.baseUrl).toBe("https://mirror.example/fork/localnet/api/v1");
		expect(target.headers).toEqual({ "x-network": "localnet", "x-provider": "fork" });
		expect(target.http.retry).toMatchObject({ enabled: true, maxAttempts: 4 });
		expect(target.page).toEqual({ defaultLimit: 40, maxLimit: 400 });
	});

	it("includes custom networks when selecting a failover provider", async () => {
		const registry = new ProviderRegistry({
			defaultProvider: "first",
			defaultNetwork: "devnet",
			switchProviderOnFailure: true,
			provider: {
				first: { networks: { devnet: { url: "https://first.example" } } },
				second: { networks: { devnet: { url: "https://second.example" } } },
			},
		});
		const request = vi
			.spyOn(registry.getHttp(), "request")
			.mockRejectedValueOnce(new (await import("../../src/core/errors")).HttpError(503, "https://first.example/api/v1/accounts"))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));

		await registry.get(registry.resolve(), "/api/v1/accounts");

		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0][0]).toBe("https://first.example/api/v1/accounts");
		expect(request.mock.calls[1][0]).toBe("https://second.example/api/v1/accounts");
	});
});
