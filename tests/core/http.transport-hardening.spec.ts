import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpNetworkError } from "../../src/core/errors";
import { HttpTransport, type HttpAttemptDispatcher } from "../../src/core/http";
import { LimiterRegistry } from "../../src/core/limiter";
import { ProviderRegistry } from "../../src/core/provider";

const REQUEST_URL = "https://mirror.example/api/v1/accounts";
const retryNetworkImmediately = {
	enabled: true,
	maxAttempts: 2,
	initialDelayMs: 0,
	maxDelayMs: 0,
	backoff: "fixed" as const,
	onNetworkError: true,
	honorRetryAfter: false,
};

function transport(): HttpTransport {
	return new HttpTransport({ debug: () => {}, warn: () => {} });
}

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("HttpTransport redirect policy", () => {
	it("never follows or leaks headers to a cross-origin redirect", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { location: "https://attacker.example/collect" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const request = transport().request(REQUEST_URL, {
			method: "GET",
			headers: { "x-api-key": "secret", authorization: "Bearer private" },
		});

		await expect(request).rejects.toBeInstanceOf(HttpNetworkError);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0][0]).toBe(REQUEST_URL);
		expect(fetchMock.mock.calls[0][1]).toMatchObject({
			redirect: "manual",
			headers: { "x-api-key": "secret", authorization: "Bearer private" },
		});
	});

	it("charges every same-origin redirect hop and preserves final provenance", async () => {
		const sourceResponse = jsonResponse({ accounts: [] });
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/api/v1/accounts?page=2" } }))
			.mockResolvedValueOnce(sourceResponse);
		vi.stubGlobal("fetch", fetchMock);
		const dispatchIndexes: number[] = [];
		const dispatcher: HttpAttemptDispatcher = async (task, index) => {
			dispatchIndexes.push(index);
			return await task();
		};

		const response = await transport().request(
			REQUEST_URL,
			{ method: "GET", headers: { "x-api-key": "secret" } },
			undefined,
			dispatcher
		);

		expect(dispatchIndexes).toEqual([0, 1]);
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([REQUEST_URL, "https://mirror.example/api/v1/accounts?page=2"]);
		expect(fetchMock.mock.calls[1][1]).toMatchObject({ headers: { "x-api-key": "secret" }, redirect: "manual" });
		expect(response.url).toBe("https://mirror.example/api/v1/accounts?page=2");
		expect(response.redirected).toBe(true);
		expect(response).toBe(sourceResponse);
		expect(response.bodyUsed).toBe(false);
		await expect(response.json()).resolves.toEqual({ accounts: [] });
	});

	it("applies Fetch POST-to-GET semantics without forwarding body headers", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/finished" } }))
			.mockResolvedValueOnce(jsonResponse({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const headers = JSON.parse('{"content-type":"application/json","x-api-key":"secret","__proto__":"preserved"}') as Record<string, string>;
		await transport().request(REQUEST_URL, {
			method: "POST",
			body: { value: 1 },
			headers,
		});

		expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: '{"value":1}' });
		expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "GET", headers: { "x-api-key": "secret" } });
		expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined();
		expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("content-type")).toBe(false);
		const redirectedHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
		expect(Object.prototype.hasOwnProperty.call(redirectedHeaders, "__proto__")).toBe(true);
		expect(redirectedHeaders.__proto__).toBe("preserved");
	});

	it("stops a unique same-origin redirect chain at the hop limit", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const current = new URL(String(input));
			const hop = Number(current.searchParams.get("hop") || "0");
			return new Response(null, { status: 302, headers: { location: `${REQUEST_URL}?hop=${hop + 1}` } });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(transport().request(REQUEST_URL, { method: "GET" })).rejects.toMatchObject({
			cause: expect.objectContaining({ name: "RedirectPolicyError" }),
		});
		expect(fetchMock).toHaveBeenCalledTimes(21);
	});

	it("reports the final physical URL when a redirected request fails", async () => {
		const destination = "https://mirror.example/api/v1/accounts?page=broken";
		const failure = new TypeError("connection closed at redirected endpoint");
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: destination } }))
			.mockRejectedValueOnce(failure);
		vi.stubGlobal("fetch", fetchMock);

		await expect(transport().request(REQUEST_URL, { method: "GET" })).rejects.toMatchObject({
			name: "HttpNetworkError",
			url: destination,
			attempts: 2,
			cause: failure,
		});
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([REQUEST_URL, destination]);
	});
});

describe("HttpTransport complete-response execution", () => {
	it("retries a successful response whose body stream resets", async () => {
		const broken = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error("connection reset while reading body"));
			},
		});
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(broken, { status: 200 })).mockResolvedValueOnce(jsonResponse({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await transport().request(REQUEST_URL, { method: "GET" }, retryNetworkImmediately);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("retries malformed and non-JSON successful payloads before returning", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("<html>upstream proxy</html>", { status: 200 }))
			.mockResolvedValueOnce(jsonResponse({ ok: true }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await transport().request(REQUEST_URL, { method: "GET" }, retryNetworkImmediately);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("holds maxConcurrent capacity until the response body has completed", async () => {
		let releaseFirst!: () => void;
		const firstBody = new ReadableStream<Uint8Array>({
			start(controller) {
				releaseFirst = () => {
					controller.enqueue(new TextEncoder().encode("{}"));
					controller.close();
				};
			},
		});
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(firstBody, { status: 200 })).mockResolvedValueOnce(jsonResponse({ second: true }));
		vi.stubGlobal("fetch", fetchMock);
		const limiter = new LimiterRegistry();
		const dispatcher: HttpAttemptDispatcher = (task) => limiter.schedule("body-slot", { maxConcurrent: 1 }, "queue", task);

		const first = transport().request(`${REQUEST_URL}?request=first`, { method: "GET" }, undefined, dispatcher);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const second = transport().request(`${REQUEST_URL}?request=second`, { method: "GET" }, undefined, dispatcher);
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		releaseFirst();
		await first;
		await second;
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("HttpTransport provider failover integration", () => {
	function failoverRegistry(): ProviderRegistry {
		return new ProviderRegistry({
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			switchProviderOnFailure: true,
			provider: {
				p1: {
					testnet: { url: "https://p1.example", headers: { "x-api-key": "p1-secret" } },
					http: { retry: { enabled: false } },
				},
				p2: {
					testnet: { url: "https://p2.example", headers: { "x-api-key": "p2-secret" } },
					http: { retry: { enabled: false } },
				},
			},
		});
	}

	it("fails over without visiting a cross-origin redirect destination", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p1.example/")) {
				return new Response(null, { status: 302, headers: { location: "https://attacker.example/collect" } });
			}
			return jsonResponse({ source: "p2" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = failoverRegistry();
		const response = await registry.get(registry.resolve(), "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ source: "p2" });
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
			"https://p1.example/api/v1/accounts",
			"https://p2.example/api/v1/accounts",
		]);
		expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ "x-api-key": "p2-secret" });
	});

	it("fails over when a provider returns HTTP 200 with malformed JSON", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 200 }))
			.mockResolvedValueOnce(jsonResponse({ source: "p2" }));
		vi.stubGlobal("fetch", fetchMock);

		const registry = failoverRegistry();
		const response = await registry.get(registry.resolve(), "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ source: "p2" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe("HttpTransport cancellation and timeouts", () => {
	function abortAwarePendingFetch(): typeof fetch {
		return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				const rejectFromSignal = () => reject(signal?.reason || new DOMException("The operation was aborted", "AbortError"));
				if (signal?.aborted) rejectFromSignal();
				else signal?.addEventListener("abort", rejectFromSignal, { once: true });
			});
		}) as typeof fetch;
	}

	it("treats each timeout as retryable and reports a typed terminal network error", async () => {
		const fetchMock = abortAwarePendingFetch();
		vi.stubGlobal("fetch", fetchMock);

		const request = transport().request(REQUEST_URL, { method: "GET", timeoutMs: 5 }, retryNetworkImmediately);

		await expect(request).rejects.toMatchObject({
			name: "HttpNetworkError",
			attempts: 2,
			cause: expect.objectContaining({ name: "TimeoutError", timeoutMs: 5 }),
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("never retries an explicit caller abort", async () => {
		const fetchMock = abortAwarePendingFetch();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		const reason = new DOMException("cancelled by caller", "AbortError");

		const request = transport().request(REQUEST_URL, { method: "GET", signal: controller.signal, timeoutMs: 60_000 }, retryNetworkImmediately);
		controller.abort(reason);

		await expect(request).rejects.toBe(reason);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
		"rejects timeout values that cannot be represented safely by runtime timers (%s)",
		async (timeoutMs) => {
			await expect(transport().request(REQUEST_URL, { method: "GET", timeoutMs })).rejects.toMatchObject({ name: "ConfigError" });
		}
	);
});
