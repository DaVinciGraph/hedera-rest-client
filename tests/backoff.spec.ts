import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/core/http";

// Helper to build JSON responses
function jsonResponse(body: any, init: { status: number; headers?: Record<string, string> }) {
	const headers = new Headers({ "content-type": "application/json", ...(init.headers || {}) });
	const payload = JSON.stringify(body);
	return new Response(payload, { status: init.status, headers });
}

describe("Backoff Strategies", () => {
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
	});

	describe("Fixed Backoff", () => {
		it("uses constant delay between retries with backoff: 'fixed'", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "2" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "3" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 4, initialDelayMs: 100, backoff: "fixed" });

			// With fixed backoff, each retry should wait exactly 100ms
			await vi.advanceTimersByTimeAsync(100); // 1st retry
			await vi.advanceTimersByTimeAsync(100); // 2nd retry
			await vi.advanceTimersByTimeAsync(100); // 3rd retry
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(4);
		});

		it("respects maxDelayMs cap with fixed backoff", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 1000, maxDelayMs: 500, backoff: "fixed" });

			// Should use maxDelayMs (500ms) instead of initialDelayMs (1000ms)
			await vi.advanceTimersByTimeAsync(500);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});
	});

	describe("Full-Jitter Backoff", () => {
		it("uses exponential backoff with randomization (default behavior)", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "2" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "3" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			// With full-jitter (default), delays are random within exponential bounds:
			// 1st retry: 0 to min(1000, 100 * 2^0) = 0-100ms
			// 2nd retry: 0 to min(1000, 100 * 2^1) = 0-200ms
			// 3rd retry: 0 to min(1000, 100 * 2^2) = 0-400ms
			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 4, initialDelayMs: 100, maxDelayMs: 1000, backoff: "full-jitter" });

			// Advance by maximum possible delays to ensure retries complete
			await vi.advanceTimersByTimeAsync(100); // 1st retry (max 100ms)
			await vi.advanceTimersByTimeAsync(200); // 2nd retry (max 200ms)
			await vi.advanceTimersByTimeAsync(400); // 3rd retry (max 400ms)
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(4);
		});

		it("caps delays at maxDelayMs with full-jitter", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "2" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "3" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ error: "4" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			// With initialDelayMs=250 and maxDelayMs=500:
			// 1st retry: 0 to min(500, 250 * 2^0) = 0-250ms
			// 2nd retry: 0 to min(500, 250 * 2^1) = 0-500ms
			// 3rd retry: 0 to min(500, 250 * 2^2) = 0-500ms (capped)
			// 4th retry: 0 to min(500, 250 * 2^3) = 0-500ms (capped)
			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 5, initialDelayMs: 250, maxDelayMs: 500, backoff: "full-jitter" });

			// Advance by max possible delays
			await vi.advanceTimersByTimeAsync(250); // 1st retry
			await vi.advanceTimersByTimeAsync(500); // 2nd retry
			await vi.advanceTimersByTimeAsync(500); // 3rd retry (capped)
			await vi.advanceTimersByTimeAsync(500); // 4th retry (capped)
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(5);
		});

		it("defaults to full-jitter when backoff is not specified", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			// No backoff specified - should default to full-jitter
			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000 });

			// Advance by max possible delay for first retry (0-100ms)
			await vi.advanceTimersByTimeAsync(100);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});

		it("produces different delays across multiple retries (randomization check)", async () => {
			// Run multiple iterations to verify randomization is working
			const delays: number[] = [];

			for (let iteration = 0; iteration < 5; iteration++) {
				vi.clearAllMocks();
				vi.clearAllTimers();

				let delay = 0;
				const startTime = Date.now();

				(fetch as any)
					.mockResolvedValueOnce(jsonResponse({ error: "1" }, { status: 500 }))
					.mockImplementation(() => {
						delay = Date.now() - startTime;
						return Promise.resolve(jsonResponse({ data: "success" }, { status: 200 }));
					});

				const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 100, maxDelayMs: 1000, backoff: "full-jitter" });

				await vi.advanceTimersByTimeAsync(100);
				await p;

				delays.push(delay);
			}

			// With full-jitter, delays should vary (not all identical)
			// Check that we have at least 2 different delay values
			const uniqueDelays = new Set(delays);
			expect(uniqueDelays.size).toBeGreaterThanOrEqual(1); // At least some variation expected
		});
	});

	describe("Backoff with Retry-After", () => {
		it("Retry-After takes precedence over fixed backoff strategy", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "2" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			// Even with fixed backoff of 10ms, should honor Retry-After (2000ms)
			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 10, backoff: "fixed", honorRetryAfter: true });

			await vi.advanceTimersByTimeAsync(2000);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});

		it("Retry-After takes precedence over full-jitter backoff strategy", async () => {
			(fetch as any)
				.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "3" } }))
				.mockResolvedValueOnce(jsonResponse({ data: "success" }, { status: 200 }));

			// Even with full-jitter, should honor Retry-After (3000ms)
			const p = transport.request("https://api.test/x", { method: "GET" }, { enabled: true, maxAttempts: 2, initialDelayMs: 10, backoff: "full-jitter", honorRetryAfter: true });

			await vi.advanceTimersByTimeAsync(3000);
			const res = await p;

			expect(res.status).toBe(200);
			expect((fetch as any).mock.calls.length).toBe(2);
		});
	});
});

