import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HederaRestClient } from "../src/HederaRestClient";
import { HttpError } from "../src/core/errors";
import { ProviderRegistry } from "../src/core/provider";

// Helper to create mock JSON responses
function jsonResponse(data: any, init?: ResponseInit): Response {
	const body = JSON.stringify(data);
	return new Response(body, {
		status: init?.status || 200,
		headers: { "content-type": "application/json", ...init?.headers },
	});
}

describe("Complex Integration Scenarios", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers(); // Always restore to real timers after each test
	});

	describe("Overflow + Failover + Retry Interactions", () => {
		it("overflow switches to p2, p2 fails, failover to p3 succeeds", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
				switchProviderOnFailure: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							limiter: { minTime: 10 },
							retry: { enabled: false },
						},
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: {
							limiter: { minTime: 10 },
							retry: { enabled: true, maxAttempts: 2 },
						},
					},
					p3: {
						testnet: { url: "https://p3.local" },
						http: {
							limiter: { minTime: 10 },
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			// p1 succeeds (first request uses p1)
			spy.mockResolvedValueOnce(jsonResponse({ data: "from-p1" }));

			// Second parallel request: p1 at capacity (overflow), goes to p2, p2 fails, failover to p3
			spy.mockRejectedValueOnce(new HttpError(500, "https://p2.local/test", "HTTP 500")) // p2 fails (with retries)
				.mockResolvedValueOnce(jsonResponse({ data: "from-p3" })); // p3 succeeds (failover)

			const target = registry.resolve("p1", "testnet");

			// Fire two parallel requests
			const r1 = registry.get(target, "/test", {});
			const r2 = registry.get(target, "/test", {});

			const [res1, res2] = await Promise.all([r1, r2]);
			const [body1, body2] = await Promise.all([res1.json(), res2.json()]);

			// First request uses p1
			expect(body1.data).toBe("from-p1");
			// Second request overflows to p2, fails, fails over to p3
			expect(body2.data).toBe("from-p3");

			// Total calls: 1 (p1) + 1 (p2 with retries) + 1 (p3 failover)
			expect(spy).toHaveBeenCalledTimes(3);
		});

		it("overflow switching disabled, retry enabled, failover enabled - all work correctly", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: false, // Queue on same provider
				switchProviderOnFailure: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							limiter: { minTime: 5 },
							retry: { enabled: true, maxAttempts: 3 },
						},
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: {
							limiter: { minTime: 5 },
							retry: { enabled: true, maxAttempts: 3 },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			// p1 fails after retries, then failover to p2 succeeds
			spy.mockRejectedValueOnce(new HttpError(503, "https://p1.local/test", "HTTP 503")).mockResolvedValueOnce(jsonResponse({ data: "from-p2" }));

			const target = registry.resolve("p1", "testnet");
			const res = await registry.get(target, "/test", {});
			const body = await res.json();

			expect(body.data).toBe("from-p2");
			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy.mock.calls[0][0]).toContain("p1.local");
			expect(spy.mock.calls[1][0]).toContain("p2.local");
		});
	});

	describe("Caching + Failover Interactions", () => {
		it("cache miss on 404, no failover (singular resource)", async () => {
			vi.useRealTimers();
			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				cache: { isEnabled: true, duration: 60 },
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;
			vi.spyOn(transport, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/accounts/0.0.999", "HTTP 404"));

			const result = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.999", useCache: true }).get();

			expect(result).toBeNull();
			// Should only try once (no failover on 404)
			expect(transport.request).toHaveBeenCalledTimes(1);
		});

		it("cache miss, p1 fails with 500, failover to p2, cache result from p2", async () => {
			vi.useRealTimers();
			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				cache: { isEnabled: true, duration: 60 },
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			const accountData = {
				account: "0.0.123",
				balance: { balance: 1000 },
				auto_renew_period: 7776000,
				expiry_timestamp: null,
				key: { _type: "ED25519", key: "abc123" },
				memo: "test",
			};

			spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/accounts/0.0.123", "HTTP 500")).mockResolvedValueOnce(jsonResponse(accountData));

			const result1 = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.123", useCache: true }).get();

			expect(result1).toMatchObject(accountData);
			expect(typeof result1?.next).toBe("function");
			expect(spy).toHaveBeenCalledTimes(2);

			// Second call should hit cache (no new HTTP calls)
			const result2 = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.123", useCache: true }).get();

			expect(result2).toMatchObject(accountData);
			expect(typeof result2?.next).toBe("function");
			expect(spy).toHaveBeenCalledTimes(2); // No additional calls
		});

		it("cache hit, no network call at all", async () => {
			vi.useRealTimers();
			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				cache: { isEnabled: true, duration: 60 },
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			const tokenData = {
				token_id: "0.0.456",
				symbol: "TEST",
				name: "Test Token",
			};

			spy.mockResolvedValueOnce(jsonResponse(tokenData));

			// First call - cache miss
			const result1 = await client.tokens().one({ tokenId: "0.0.456", useCache: true }).get();
			expect(result1).toEqual(tokenData);
			expect(spy).toHaveBeenCalledTimes(1);

			// Second call - cache hit
			const result2 = await client.tokens().one({ tokenId: "0.0.456", useCache: true }).get();
			expect(result2).toEqual(tokenData);
			expect(spy).toHaveBeenCalledTimes(1); // No additional call
		});
	});

	describe("Caching + Retry Interactions", () => {
		it("retries on 500, eventually succeeds, caches the successful result", async () => {
			vi.useFakeTimers();
			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				cache: { isEnabled: true, duration: 60 },
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							retry: { enabled: true, maxAttempts: 3, initialDelayMs: 10, on5xx: true },
						},
					},
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;

			const blockData = {
				number: 12345,
				hash: "0xabc",
				timestamp: { from: "1234567890.000000000", to: "1234567890.999999999" },
			};

			vi.spyOn(global, "fetch")
				.mockResolvedValueOnce(jsonResponse({ error: "server error" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "still failing" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse(blockData));

			const p = client.blocks().one({ hashOrNumber: 12345, useCache: true }).get();

			// Let the request install and exhaust its retry timers. Advancing two
			// fixed windows can race the asynchronous limiter under full-suite load.
			await vi.runAllTimersAsync();

			const result = await p;

			expect(result).toEqual(blockData);
			expect((global.fetch as any).mock.calls.length).toBe(3);

			// Second call should hit cache
			const result2 = await client.blocks().one({ hashOrNumber: 12345, useCache: true }).get();
			expect(result2).toEqual(blockData);
			expect((global.fetch as any).mock.calls.length).toBe(3); // No additional calls

			vi.useRealTimers();
		});

		it("useCache=false skips cached reads and fetches fresh even when caching is enabled", async () => {
			vi.useRealTimers();
			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				cache: { isEnabled: true, duration: 60 },
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			const tokenData1 = { token_id: "0.0.789", symbol: "FIRST", name: "First" };
			const tokenData2 = { token_id: "0.0.789", symbol: "SECOND", name: "Second" };

			spy.mockResolvedValueOnce(jsonResponse(tokenData1)).mockResolvedValueOnce(jsonResponse(tokenData2));

			// First call with useCache=false fetches fresh (and refreshes the entry).
			const result1 = await client.tokens().one({ tokenId: "0.0.789", useCache: false }).get();
			expect(result1).not.toBeNull();
			expect(result1!.symbol).toBe("FIRST");

			// A second useCache=false call still fetches fresh rather than reading that entry.
			const result2 = await client.tokens().one({ tokenId: "0.0.789", useCache: false }).get();
			expect(result2).not.toBeNull();
			expect(result2!.symbol).toBe("SECOND");

			expect(spy).toHaveBeenCalledTimes(2);
		});
	});

	// Note: Failover + Caching + Retry combination is already covered by
	// "cache miss, p1 fails with 500, failover to p2, cache result from p2" test above

	describe("Rate Limit Exhaustion Scenarios", () => {
		it("all providers at capacity, requests queue on original provider", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: { limiter: { reservoir: 1, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 } },
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: { limiter: { reservoir: 1, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 } },
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			// Create new Response for each call to avoid "body already read" error
			spy.mockImplementation(() => Promise.resolve(jsonResponse({ data: "ok" })));

			const target = registry.resolve("p1", "testnet");

			// Fire 3 requests - first uses p1, second uses p2, third queues on p1
			const requests = [registry.get(target, "/test", {}), registry.get(target, "/test", {}), registry.get(target, "/test", {})];

			const results = await Promise.all(requests);

			// All should succeed
			expect(results.length).toBe(3);
			for (const res of results) {
				const body = await res.json();
				expect(body.data).toBe("ok");
			}

			// At least 3 calls made
			expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("Error Propagation in Complex Scenarios", () => {
		it("404 error propagates correctly through overflow + failover", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
				switchProviderOnFailure: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							limiter: { reservoir: 1, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 },
							retry: { enabled: false },
						},
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: {
							limiter: { reservoir: 10, reservoirRefreshInterval: 250, reservoirRefreshAmount: 10 },
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			// Consume p1's token
			spy.mockResolvedValueOnce(jsonResponse({ data: "ok" }));

			const target = registry.resolve("p1", "testnet");
			await registry.get(target, "/test", {});

			// Second request overflows to p2, gets 404 - should NOT failover (404 is non-retryable)
			spy.mockRejectedValueOnce(new HttpError(404, "https://p2.local/test", "HTTP 404"));

			await expect(registry.get(target, "/test", {})).rejects.toMatchObject({ status: 404 });

			// Should be 2 calls: 1 to p1, 1 to p2 (no failover after 404)
			expect(spy).toHaveBeenCalledTimes(2);
		});

		it("non-retryable 400 error propagates without retry or failover", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: { retry: { enabled: true, maxAttempts: 3 } },
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: { retry: { enabled: false } },
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			spy.mockRejectedValueOnce(new HttpError(400, "https://p1.local/test", "Bad Request"));

			const target = registry.resolve("p1", "testnet");

			await expect(registry.get(target, "/test", {})).rejects.toMatchObject({ status: 400 });

			// Should only try once (no retry, no failover for 400)
			expect(spy).toHaveBeenCalledTimes(1);
		});
	});

	describe("Configuration Edge Cases", () => {
		it("works with minimal configuration (all defaults)", async () => {
			vi.useRealTimers();

			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				provider: {
					p1: { testnet: { url: "https://p1.local" } },
				},
			} as any);

			const registry = (client as any).registry;
			const transport = (registry as any).httpTransport;
			vi.spyOn(transport, "request").mockResolvedValue(jsonResponse({ tokens: [], links: { next: null } }));

			const result = await client.tokens().list({ limit: 10 }).get();

			expect(result.tokens).toEqual([]);
			expect(transport.request).toHaveBeenCalledTimes(1);
		});

		it("works with only retry enabled, no failover or overflow", async () => {
			vi.useFakeTimers();

			const client = new HederaRestClient({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: false,
				switchProviderOnFailure: false,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: { retry: { enabled: true, maxAttempts: 3, initialDelayMs: 10, backoff: "fixed" } },
					},
				},
			} as any);

			const registry = (client as any).registry;

			vi.spyOn(global, "fetch")
				.mockResolvedValueOnce(jsonResponse({ error: "fail" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "fail" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ balances: [], links: { next: null } }));

			const p = client.balances().list({ limit: 10 }).get();

			await vi.advanceTimersByTimeAsync(10);
			await vi.advanceTimersByTimeAsync(10);

			const result = await p;

			expect(result.balances).toEqual([]);
			expect((global.fetch as any).mock.calls.length).toBe(3);

			vi.useRealTimers();
		});

		it("works with only failover enabled, no retry or overflow", async () => {
			vi.useRealTimers();
			vi.clearAllMocks();

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: false,
				switchProviderOnFailure: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: { retry: { enabled: false } },
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: { retry: { enabled: false } },
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			spy.mockRejectedValueOnce(new HttpError(503, "https://p1.local/test", "Service Unavailable")).mockResolvedValueOnce(jsonResponse({ data: "from-p2" }));

			const target = registry.resolve("p1", "testnet");
			const res = await registry.get(target, "/test", {});
			const body = await res.json();

			expect(body.data).toBe("from-p2");
			expect(spy).toHaveBeenCalledTimes(2);
		});
	});
});
