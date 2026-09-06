import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { ConfigError, HttpError } from "../src/core/errors";
import { HttpTransport, MAX_TIMER_DELAY_MS } from "../src/core/http";
import { ProviderRegistry } from "../src/core/provider";
import { HederaRestClient } from "../src/HederaRestClient";

// Helper to build JSON responses
function jsonResponse(body: any, init: { status: number; headers?: Record<string, string> }) {
	const headers = new Headers({ "content-type": "application/json", ...(init.headers || {}) });
	const payload = JSON.stringify(body);
	return new Response(payload, { status: init.status, headers });
}

describe("HttpTransport: Retry Policy Behavior", () => {
	let transport: HttpTransport;

	beforeEach(() => {
		transport = new HttpTransport({
			debug: () => {},
			warn: () => {},
		});
		vi.useFakeTimers();
		vi.spyOn(global, "fetch");
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.restoreAllMocks();
		vi.useFakeTimers(); // Reset to fake timers for next test
	});

	describe("Retry Disabled (default behavior)", () => {
		it("does not retry on 404 when retries are disabled", async () => {
			(fetch as unknown as Mock).mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }));
			await expect(transport.request("https://api.test/x", { method: "GET" })).rejects.toMatchObject({ status: 404 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("does not retry on 429 when retries are disabled", async () => {
			(fetch as unknown as Mock).mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }));
			await expect(transport.request("https://api.test/x", { method: "GET" })).rejects.toMatchObject({ status: 429 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("does not retry on 500 when retries are disabled", async () => {
			(fetch as unknown as Mock).mockResolvedValueOnce(jsonResponse({ error: "server error" }, { status: 500 }));
			await expect(transport.request("https://api.test/x", { method: "GET" })).rejects.toMatchObject({ status: 500 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("does not retry on network errors when retries are disabled", async () => {
			(fetch as any).mockRejectedValueOnce(new Error("ECONNRESET"));
			await expect(transport.request("https://api.test/x", { method: "GET" })).rejects.toThrow("ECONNRESET");
			expect((fetch as any).mock.calls.length).toBe(1);
		});
	});

	describe("Retry on 404 (on404 flag)", () => {
		it("does NOT retry on 404 by default even when retries are enabled", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3 })).rejects.toMatchObject({ status: 404 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("retries on 404 when on404=true", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }))
				.mockResolvedValueOnce(jsonResponse({ error: "still not found" }, { status: 404 }))
				.mockResolvedValueOnce(jsonResponse({ data: "found" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, on404: true, initialDelayMs: 100, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(3);
		});

		it("exhausts retries on 404 when on404=true", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }))
				.mockResolvedValueOnce(jsonResponse({ error: "still not found" }, { status: 404 }))
				.mockResolvedValueOnce(jsonResponse({ error: "never found" }, { status: 404 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, on404: true, initialDelayMs: 50, backoff: "fixed" });

		// Attach rejection handler first to avoid unhandled rejection
		const expectation = expect(p).rejects.toMatchObject({ status: 404 });
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(50);
			await expectation;
			expect((fetch as any).mock.calls.length).toBe(3);
		});
	});

	describe("Retry on 429 (on429 flag)", () => {
		it("retries on 429 when enabled and on429=true (default)", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }))
				.mockResolvedValueOnce(jsonResponse({ error: "still limited" }, { status: 429 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, initialDelayMs: 100, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(3);
		});

		it("does NOT retry on 429 when on429=false", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, on429: false })).rejects.toMatchObject({ status: 429 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("honors Retry-After header on 429", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "2" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 10, honorRetryAfter: true });

			// Should wait ~2000ms (from Retry-After), not 10ms
			await vi.advanceTimersByTimeAsync(1000);
			expect((fetch as any).mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1500);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});

		it.each([
			"Sun, 06 Nov 1994 08:49:37 GMT",
			"Sunday, 06-Nov-94 08:49:37 GMT",
			"Sun Nov  6 08:49:37 1994",
		])("honors Retry-After HTTP-date form %s", async (retryAt) => {
			const now = new Date("1994-11-06T08:49:07.000Z");
			vi.setSystemTime(now);
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503, headers: { "retry-after": retryAt } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const request = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 0, backoff: "fixed", honorRetryAfter: true });
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(29_999);
			expect((fetch as any).mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1);

			await expect(request).resolves.toMatchObject({ status: 200 });
			expect((fetch as any).mock.calls.length).toBe(2);
		});

		it("falls back to configured backoff for malformed Retry-After", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503, headers: { "retry-after": "1.5" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const request = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 25, backoff: "fixed", honorRetryAfter: true });
			await vi.advanceTimersByTimeAsync(24);
			expect((fetch as any).mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1);

			await expect(request).resolves.toMatchObject({ status: 200 });
		});

		it("clamps an oversized Retry-After value to the host timer maximum", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "2147484" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const request = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, honorRetryAfter: true });
			await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS - 1);
			expect((fetch as any).mock.calls.length).toBe(1);
			await vi.advanceTimersByTimeAsync(1);

			await expect(request).resolves.toMatchObject({ status: 200 });
			expect((fetch as any).mock.calls.length).toBe(2);
		});

		it("ignores Retry-After when honorRetryAfter=false", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "10" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 50, honorRetryAfter: false, backoff: "fixed" });

		// Should use initialDelayMs (50ms), not Retry-After (10000ms)
		await vi.advanceTimersByTimeAsync(50);
		const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});
	});

	describe("Retry on 5xx (on5xx flag)", () => {
	it("retries on 500 when enabled and on5xx=true (default)", async () => {
		(fetch as any)
			.mockResolvedValueOnce(jsonResponse({ error: "server error" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ error: "still broken" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ data: "recovered" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, initialDelayMs: 100, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(100);
		const res = await p;

		expect(res.status).toBe(200);
		expect((fetch as any).mock.calls.length).toBe(3);
	});

		it("retries on 503 when enabled", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "service unavailable" }, { status: 503 })).mockResolvedValueOnce(jsonResponse({ data: "back online" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 50, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(50);
		const res = await p;

		expect(res.status).toBe(200);
		expect((fetch as any).mock.calls.length).toBe(2);
	});

		it("does NOT retry on 5xx when on5xx=false", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "server error" }, { status: 500 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, on5xx: false })).rejects.toMatchObject({ status: 500 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});
	});

	describe("Retry on Network Errors (onNetworkError flag)", () => {
		it("retries on network error when enabled and onNetworkError=true (default)", async () => {
			(fetch as any)
				.mockRejectedValueOnce(new Error("ECONNRESET"))
				.mockRejectedValueOnce(new Error("ETIMEDOUT"))
				.mockResolvedValueOnce(jsonResponse({ data: "connected" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, initialDelayMs: 50, onNetworkError: true, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(50);
		const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(3);
		});

		it("does NOT retry on network error when onNetworkError=false", async () => {
			(fetch as any).mockRejectedValueOnce(new Error("ECONNRESET"));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, onNetworkError: false })).rejects.toThrow("ECONNRESET");
			expect((fetch as any).mock.calls.length).toBe(1);
		});
	});

	describe("MaxAttempts behavior", () => {
		it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
			"rejects invalid enabled maxAttempts=%s before fetching",
			async (maxAttempts) => {
				await expect(
					transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts })
				).rejects.toBeInstanceOf(ConfigError);
				expect(fetch).not.toHaveBeenCalled();
			}
		);

		it("respects maxAttempts=1 (no retries)", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "fail" }, { status: 500 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 1 })).rejects.toMatchObject({ status: 500 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

	it("respects maxAttempts=5 (initial + 4 retries)", async () => {
		(fetch as any)
			.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ error: "2" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ error: "3" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ error: "4" }, { status: 500 }))
			.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 5, initialDelayMs: 10, backoff: "fixed" });

		await vi.advanceTimersByTimeAsync(10);
		await vi.advanceTimersByTimeAsync(10);
		await vi.advanceTimersByTimeAsync(10);
		await vi.advanceTimersByTimeAsync(10);
		const res = await p;

		expect(res.status).toBe(200);
		expect((fetch as any).mock.calls.length).toBe(5);
	});

		it("exhausts maxAttempts when all fail", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "2" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "3" }, { status: 500 }));

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, initialDelayMs: 10, backoff: "fixed" });

		// Attach rejection handler first to avoid unhandled rejection
		const expectation = expect(p).rejects.toMatchObject({ status: 500 });
		await vi.advanceTimersByTimeAsync(10);
		await vi.advanceTimersByTimeAsync(10);
		await expectation;
			expect((fetch as any).mock.calls.length).toBe(3);
		});
	});

	describe("Non-retryable status codes", () => {
		it("does NOT retry on 400 (bad request)", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "bad request" }, { status: 400 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3 })).rejects.toMatchObject({ status: 400 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("does NOT retry on 401 (unauthorized)", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, { status: 401 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3 })).rejects.toMatchObject({ status: 401 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});

		it("does NOT retry on 403 (forbidden)", async () => {
			(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, { status: 403 }));
			await expect(transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3 })).rejects.toMatchObject({ status: 403 });
			expect((fetch as any).mock.calls.length).toBe(1);
		});
	});
});

describe("ProviderRegistry: switchProviderWhenOverflow (Overflow Switching)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useFakeTimers(); // Restore fake timers after real timer tests
	});

	describe("switchProviderWhenOverflow=false (default)", () => {
		it("queues on the requested provider when rate limit is full", async () => {
			vi.useRealTimers(); // Bottleneck needs real timers
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: false,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							// Use minTime instead of reservoir to avoid blocking
							limiter: { minTime: 10 },
							retry: { enabled: false },
						},
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: {
							limiter: { minTime: 10 },
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockResolvedValue(jsonResponse({ data: "ok" }, { status: 200 }));

			const target = registry.resolve("p1", "testnet");

			// Both requests should queue on p1, not switch to p2
			const p1 = registry.get(target, "/api/v1/test", {});
			const p2 = registry.get(target, "/api/v1/test", {});

			await Promise.all([p1, p2]);

			// Both should have used p1
			expect((transport as any).request).toHaveBeenCalledTimes(2);
			const calls = (transport as any).request.mock.calls;
			expect(calls[0][0]).toContain("https://p1.local");
			expect(calls[1][0]).toContain("https://p1.local");
		});
	});

	describe("switchProviderWhenOverflow=true", () => {
		it("switches to provider with capacity when first is at limit", async () => {
			vi.useRealTimers(); // Bottleneck needs real timers
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							limiter: { reservoir: 1 },
							retry: { enabled: false },
						},
					},
					p2: {
						testnet: { url: "https://p2.local" },
						http: {
							limiter: { reservoir: 100 },
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: "ok" }, { status: 200 }));
			vi.stubGlobal("fetch", fetchMock);

			const target = registry.resolve("p1", "testnet");

			// Fire 3 requests in parallel - first should use p1, rest should overflow to p2
			const requests = [registry.get(target, "/api/v1/test", {}), registry.get(target, "/api/v1/test", {}), registry.get(target, "/api/v1/test", {})];

			await Promise.all(requests);

			expect(fetchMock).toHaveBeenCalledTimes(3);
			const calls = fetchMock.mock.calls;

			// At least one should use p2 due to overflow
			const p1Calls = calls.filter((c: any) => c[0].includes("https://p1.local")).length;
			const p2Calls = calls.filter((c: any) => c[0].includes("https://p2.local")).length;

			expect(p1Calls).toBeGreaterThan(0);
			expect(p2Calls).toBeGreaterThan(0);
		});

		it("queues on original provider when all providers are full", async () => {
			vi.useRealTimers(); // Bottleneck needs real timers
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
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
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockResolvedValue(jsonResponse({ data: "ok" }, { status: 200 }));

			const target = registry.resolve("p1", "testnet");

			// All requests should eventually complete (some queued)
			const requests = [registry.get(target, "/api/v1/test", {}), registry.get(target, "/api/v1/test", {}), registry.get(target, "/api/v1/test", {})];

			await Promise.all(requests);

			expect((transport as any).request).toHaveBeenCalledTimes(3);
		});

		it("does not probe for overflow in single-provider network", async () => {
			vi.useRealTimers(); // Bottleneck needs real timers
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderWhenOverflow: true,
				provider: {
					p1: {
						testnet: { url: "https://p1.local" },
						http: {
							limiter: { minTime: 10 },
							retry: { enabled: false },
						},
					},
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockResolvedValue(jsonResponse({ data: "ok" }, { status: 200 }));

			const target = registry.resolve("p1", "testnet");

			// Should queue on p1, not attempt overflow switching
			await registry.get(target, "/api/v1/test", {});

			expect((transport as any).request).toHaveBeenCalledTimes(1);
			expect((transport as any).request.mock.calls[0][0]).toContain("https://p1.local");
		});
	});
});

describe("ProviderRegistry: switchProviderOnFailure (Failure Failover)", () => {
	afterEach(() => {
		vi.useFakeTimers(); // Restore fake timers after real timer tests
	});

	describe("switchProviderOnFailure=false (default)", () => {
		it("does NOT failover to next provider on 500 error", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: false,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(500, "https://p1.local/api/v1/test", "HTTP 500"));

			const target = registry.resolve("p1", "testnet");

			await expect(registry.get(target, "/api/v1/test", {})).rejects.toMatchObject({ status: 500 });

			// Should only try p1, not failover to p2
			expect((transport as any).request).toHaveBeenCalledTimes(1);
		});
	});

	describe("switchProviderOnFailure=true", () => {
		it("fails over to next provider on 500 error (retryable)", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			const spy = vi.spyOn(transport as any, "request");
			spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/test", "HTTP 500")).mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const target = registry.resolve("p1", "testnet");
			const res = await registry.get(target, "/api/v1/test", {});
			const body = await res.json();

			expect(body).toEqual({ data: "success" });
			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy.mock.calls[0][0]).toContain("https://p1.local");
			expect(spy.mock.calls[1][0]).toContain("https://p2.local");
		});

		it("fails over to next provider on 429 error (retryable)", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			const spy = vi.spyOn(transport as any, "request");
			spy.mockRejectedValueOnce(new HttpError(429, "https://p1.local/api/v1/test", "HTTP 429")).mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const target = registry.resolve("p1", "testnet");
			const res = await registry.get(target, "/api/v1/test", {});
			const body = await res.json();

			expect(body).toEqual({ data: "success" });
			expect(spy).toHaveBeenCalledTimes(2);
		});

		it("does NOT failover on 404 error (non-retryable)", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/test", "HTTP 404"));

			const target = registry.resolve("p1", "testnet");

			await expect(registry.get(target, "/api/v1/test", {})).rejects.toMatchObject({ status: 404 });

			// Should only try p1, not failover to p2 on 404
			expect((transport as any).request).toHaveBeenCalledTimes(1);
		});

		it("does NOT failover on 400 error (non-retryable)", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(400, "https://p1.local/api/v1/test", "HTTP 400"));

			const target = registry.resolve("p1", "testnet");

			await expect(registry.get(target, "/api/v1/test", {})).rejects.toMatchObject({ status: 400 });
			expect((transport as any).request).toHaveBeenCalledTimes(1);
		});

		it("tries all providers in rotation before failing", async () => {
			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: false } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: false } } },
					p3: { testnet: { url: "https://p3.local" }, http: { retry: { enabled: false } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).getHttp();
			const spy = vi.spyOn(transport as any, "request");
			spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/test", "HTTP 500"))
				.mockRejectedValueOnce(new HttpError(500, "https://p2.local/api/v1/test", "HTTP 500"))
				.mockRejectedValueOnce(new HttpError(500, "https://p3.local/api/v1/test", "HTTP 500"));

			const target = registry.resolve("p1", "testnet");

			await expect(registry.get(target, "/api/v1/test", {})).rejects.toMatchObject({ status: 500 });

			// Should try all 3 providers
			expect(spy).toHaveBeenCalledTimes(3);
			expect(spy.mock.calls[0][0]).toContain("https://p1.local");
			expect(spy.mock.calls[1][0]).toContain("https://p2.local");
			expect(spy.mock.calls[2][0]).toContain("https://p3.local");
		});

		it("failover attempts have NO retries (single attempt per provider)", async () => {
			vi.useRealTimers(); // Need real timers for async operations
			vi.clearAllMocks(); // Clear any previous mocks

			const cfg = {
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				log: false,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: true, maxAttempts: 3 } } },
					p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: true, maxAttempts: 3 } } },
				},
			} as any;

			const registry = new ProviderRegistry(cfg);
			const transport = (registry as any).httpTransport;
			const spy = vi.spyOn(transport, "request");

			// Note: transport.request() handles retries internally, so we only mock the top-level calls
			spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/test", "HTTP 500")) // p1 (will retry internally)
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 })); // p2 failover (no retries)

			const target = registry.resolve("p1", "testnet");
			const res = await registry.get(target, "/api/v1/test", {});
			const body = await res.json();

			expect(body).toEqual({ data: "success" });
			// 1 call to p1 (which retries internally) + 1 call to p2 (failover, no retries)
			expect(spy).toHaveBeenCalledTimes(2);
			expect(spy.mock.calls[0][0]).toContain("https://p1.local");
			expect(spy.mock.calls[1][0]).toContain("https://p2.local");
		});
	});
});

describe("Integration: Retry + Overflow + Failover", () => {
	afterEach(() => {
		vi.useFakeTimers(); // Restore fake timers after real timer tests
	});

	it("retries on original provider, then fails over ONCE to next provider", async () => {
		vi.useRealTimers(); // Need real timers for async operations
		vi.clearAllMocks(); // Clear any previous mocks

		const cfg = {
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			log: false,
			switchProviderWhenOverflow: false,
			switchProviderOnFailure: true,
			provider: {
				p1: { testnet: { url: "https://p1.local" }, http: { retry: { enabled: true, maxAttempts: 2 } } },
				p2: { testnet: { url: "https://p2.local" }, http: { retry: { enabled: true, maxAttempts: 2 } } },
			},
		} as any;

		const registry = new ProviderRegistry(cfg);
		const transport = (registry as any).httpTransport;
		const spy = vi.spyOn(transport, "request");

		// Note: transport.request() handles retries internally, so we only mock the top-level calls
		spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/test", "HTTP 500")) // p1 (retries internally)
			.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 })); // p2 failover

		const target = registry.resolve("p1", "testnet");
		const res = await registry.get(target, "/api/v1/test", {});
		const body = await res.json();

		expect(body).toEqual({ data: "success" });
		// 1 call to p1 (which retries internally) + 1 call to p2 (failover)
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls[0][0]).toContain("https://p1.local");
		expect(spy.mock.calls[1][0]).toContain("https://p2.local");
	});

	it("overflow switching + failover work together", async () => {
		vi.useRealTimers(); // Bottleneck needs real timers
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
						retry: { enabled: false },
					},
				},
			},
		} as any;

		const registry = new ProviderRegistry(cfg);
		const transport = (registry as any).getHttp();
		const spy = vi.spyOn(transport as any, "request");

		// First request uses p1, second overflows to p2 but fails (500), then fails over back to p1
		spy.mockResolvedValueOnce(jsonResponse({ data: "first" }, { status: 200 })) // p1
			.mockRejectedValueOnce(new HttpError(500, "https://p2.local/api/v1/test", "HTTP 500")) // p2 overflow but fails
			.mockResolvedValueOnce(jsonResponse({ data: "failover" }, { status: 200 })); // failover to p1

		const target = registry.resolve("p1", "testnet");

		// Fire two requests
		const r1 = registry.get(target, "/api/v1/test", {});
		const r2 = registry.get(target, "/api/v1/test", {});

		const [res1, res2] = await Promise.all([r1, r2]);
		const body1 = await res1.json();
		const body2 = await res2.json();

		expect(body1.data).toBeTruthy();
		expect(body2.data).toBeTruthy();
	});
});

describe("Builder-level: 404 Handling for Singular Resources", () => {
	let client: HederaRestClient;

	beforeEach(() => {
		vi.restoreAllMocks();
		client = new HederaRestClient({
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
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("accounts.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/accounts/0.0.999", "HTTP 404"));

		const result = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.999" }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("blocks.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/blocks/999", "HTTP 404"));

		const result = await client.blocks().one({ hashOrNumber: 999 }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("schedules.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/schedules/0.0.999", "HTTP 404"));

		const result = await client.schedules().one({ scheduleId: "0.0.999" }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("tokens.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/tokens/0.0.999", "HTTP 404"));

		const result = await client.tokens().one({ tokenId: "0.0.999" }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("transactions.byId() returns {transactions: []} on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/transactions/0.0.1-1-1", "HTTP 404"));

		const result = await client.transactions().byId({ transactionId: "0.0.1-1-1" }).get();

		expect(result).toEqual({ transactions: [] });
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("topics.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/topics/0.0.999", "HTTP 404"));

		const result = await client.topics().one({ topicId: "0.0.999" }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("contracts.one() returns null on 404 (no failover)", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		vi.spyOn(transport as any, "request").mockRejectedValue(new HttpError(404, "https://p1.local/api/v1/contracts/0.0.999", "HTTP 404"));

		const result = await client.contracts().one({ idOrAddress: "0.0.999" }).get();

		expect(result).toBeNull();
		expect((transport as any).request).toHaveBeenCalledTimes(1);
	});

	it("singular resource with 500 fails over to next provider", async () => {
		const reg = (client as any).registry as any;
		const transport = (reg as any).getHttp();
		const spy = vi.spyOn(transport as any, "request");
		spy.mockRejectedValueOnce(new HttpError(500, "https://p1.local/api/v1/accounts/0.0.42", "HTTP 500")).mockResolvedValueOnce(jsonResponse({ account: "0.0.42" }, { status: 200 }));

		const result = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.42" }).get();

		expect(result).toBeTruthy();
		expect((result as any).account).toBe("0.0.42");
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy.mock.calls[0][0]).toContain("https://p1.local");
		expect(spy.mock.calls[1][0]).toContain("https://p2.local");
	});
});

describe("Edge Cases and Error Scenarios", () => {
	it("handles mixed retryable and non-retryable errors correctly", async () => {
		const transport = new HttpTransport({ debug: () => {}, warn: () => {} });
		vi.useFakeTimers();
		vi.spyOn(global, "fetch");

		(fetch as any)
			.mockResolvedValueOnce(jsonResponse({ error: "server" }, { status: 500 })) // retryable
			.mockResolvedValueOnce(jsonResponse({ error: "bad request" }, { status: 400 })); // non-retryable

		const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3, initialDelayMs: 10, backoff: "fixed" });

		// Attach rejection handler first to avoid unhandled rejection
		const expectation = expect(p).rejects.toMatchObject({ status: 400 });
		await vi.advanceTimersByTimeAsync(10);
		await expectation;

		// Should stop at 400, not continue retrying
		expect((fetch as any).mock.calls.length).toBe(2);

		vi.clearAllTimers();
		vi.restoreAllMocks();
	});

	it("handles abort signal during retry", async () => {
		vi.useRealTimers(); // Use real timers for abort signal test
		const transport = new HttpTransport({ debug: () => {}, warn: () => {} });
		vi.clearAllMocks(); // Clear any previous fetch mocks
		vi.spyOn(global, "fetch");

		const controller = new AbortController();

		(fetch as any).mockResolvedValueOnce(jsonResponse({ error: "server" }, { status: 500 })).mockImplementation(() => {
			controller.abort();
			return Promise.reject(new Error("AbortError"));
		});

		const p = transport.request("https://api.test/x", { method: "GET", signal: controller.signal }, { enabled: true, maxAttempts: 3, initialDelayMs: 10 });

		// Wait for the request to complete
		await expect(p).rejects.toThrow();

		vi.useFakeTimers(); // Restore fake timers for next tests
	});

	it("handles successful response on first attempt (no retries needed)", async () => {
		const transport = new HttpTransport({ debug: () => {}, warn: () => {} });
		vi.clearAllMocks(); // Clear any previous fetch mocks
		const fetchSpy = vi.spyOn(global, "fetch");

		fetchSpy.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

		const res = await transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 3 });

		expect(res.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("empty provider list fails gracefully", async () => {
		const cfg = {
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			log: false,
			switchProviderOnFailure: true,
			provider: {
				p1: { mainnet: { url: "https://p1.mainnet" } }, // only mainnet, not testnet
			},
		} as any;

		// Invalid defaults are rejected eagerly instead of failing on first use.
		expect(() => new ProviderRegistry(cfg)).toThrow(ConfigError);
	});
});
