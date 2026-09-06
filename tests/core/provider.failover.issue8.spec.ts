import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpNetworkError as PublicHttpNetworkError } from "../../src/index";
import { HttpError, HttpNetworkError } from "../../src/core/errors";
import { LimiterCapacityError } from "../../src/core/limiter";
import { ProviderRegistry } from "../../src/core/provider";
import type { LimiterConfig, ProviderConfigMap, RetryPolicy } from "../../src/types";

const RETRY_DISABLED: RetryPolicy = { enabled: false };

interface RegistryOptions {
	switchProviderWhenOverflow?: boolean;
	retryByProvider?: Readonly<Record<string, RetryPolicy>>;
	limiterByProvider?: Readonly<Record<string, LimiterConfig>>;
}

function createRegistry(providerNames: readonly string[], options: RegistryOptions = {}): ProviderRegistry {
	const provider: ProviderConfigMap = {};
	for (const name of providerNames) {
		const limiter = options.limiterByProvider?.[name];
		provider[name] = {
			headers: { "x-provider": name },
			testnet: {
				url: `https://${name}.local`,
				http: {
					retry: options.retryByProvider?.[name] ?? RETRY_DISABLED,
					...(limiter ? { limiter } : {}),
				},
			},
		};
	}

	return new ProviderRegistry({
		defaultProvider: providerNames[0],
		defaultNetwork: "testnet",
		switchProviderOnFailure: true,
		switchProviderWhenOverflow: options.switchProviderWhenOverflow,
		provider,
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function networkFailure(message: string, code: string): TypeError & { cause: Error & { code: string } } {
	const cause = Object.assign(new Error(message), { code });
	return Object.assign(new TypeError(message), { cause });
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
	return fetchMock.mock.calls.map(([input]) => String(input));
}

async function captureFailure(request: Promise<unknown>): Promise<unknown> {
	try {
		await request;
	} catch (error) {
		return error;
	}
	throw new Error("Expected request to fail");
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("ProviderRegistry issue #8 failure routing", () => {
	it("exports HttpNetworkError from the package entry point", () => {
		expect(PublicHttpNetworkError).toBe(HttpNetworkError);
	});

	it("fails over a GET after a DNS failure exhausts the selected provider", async () => {
		const dnsError = networkFailure("getaddrinfo ENOTFOUND p1.local", "ENOTFOUND");
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			if (String(input).startsWith("https://p1.local/")) throw dnsError;
			return jsonResponse({ source: "p2" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2"]);
		const response = await registry.get(registry.resolve(), "/api/v1/accounts", { limit: 1 });

		await expect(response.json()).resolves.toEqual({ source: "p2" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/accounts?limit=1",
			"https://p2.local/api/v1/accounts?limit=1",
		]);
	});

	it("fails over a POST after a connection failure without losing its request options", async () => {
		const connectionError = networkFailure("connect ECONNREFUSED", "ECONNREFUSED");
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			if (String(input).startsWith("https://p1.local/")) throw connectionError;
			return jsonResponse({ source: "p2" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2"]);
		const body = { to: "0x01", data: "0x1234" };
		const controller = new AbortController();
		const response = await registry.post(registry.resolve(), "/api/v1/contracts/call", body, {
			query: { estimate: true },
			headers: { "x-request": "preserved" },
			signal: controller.signal,
		});

		await expect(response.json()).resolves.toEqual({ source: "p2" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/contracts/call?estimate=true",
			"https://p2.local/api/v1/contracts/call?estimate=true",
		]);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init).toMatchObject({ method: "POST", body: JSON.stringify(body), signal: controller.signal });
			expect(new Headers(init?.headers).get("x-request")).toBe("preserved");
		}
		expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-provider")).toBe("p1");
		expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("x-provider")).toBe("p2");
	});

	it("finishes every configured network retry before failing over", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			if (String(input).startsWith("https://p1.local/")) {
				throw networkFailure("connect ETIMEDOUT", "ETIMEDOUT");
			}
			return jsonResponse({ source: "p2" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2"], {
			retryByProvider: {
				p1: {
					enabled: true,
					maxAttempts: 3,
					initialDelayMs: 0,
					maxDelayMs: 0,
					backoff: "fixed",
					onNetworkError: true,
				},
			},
		});

		const response = await registry.get(registry.resolve(), "/api/v1/network/nodes");

		await expect(response.json()).resolves.toEqual({ source: "p2" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/network/nodes",
			"https://p1.local/api/v1/network/nodes",
			"https://p1.local/api/v1/network/nodes",
			"https://p2.local/api/v1/network/nodes",
		]);
	});

	it("charges the limiter reservoir once for every physical retry attempt", async () => {
		const limiterConfig: LimiterConfig = { reservoir: 3 };
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(jsonResponse({ attempt: 1 }, 503))
			.mockResolvedValueOnce(jsonResponse({ attempt: 2 }, 503))
			.mockResolvedValueOnce(jsonResponse({ attempt: 3 }, 200));
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1"], {
			retryByProvider: {
				p1: {
					enabled: true,
					maxAttempts: 3,
					initialDelayMs: 0,
					maxDelayMs: 0,
					backoff: "fixed",
					on5xx: true,
				},
			},
			limiterByProvider: { p1: limiterConfig },
		});
		const target = registry.resolve();
		const limiter = registry.getLimiterReg().get(target.limiterBucket!, target.http.limiter);
		expect(await limiter?.currentReservoir()).toBe(3);

		const response = await registry.get(target, "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ attempt: 3 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(await limiter?.currentReservoir()).toBe(0);
	});

	it("releases maxConcurrent while a request is waiting in retry backoff", async () => {
		let releaseFirstAttempt!: () => void;
		const firstAttemptCompleted = new Promise<void>((resolve) => {
			releaseFirstAttempt = resolve;
		});
		let firstRequestAttempts = 0;
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.endsWith("request=first")) {
				firstRequestAttempts++;
				if (firstRequestAttempts === 1) {
					releaseFirstAttempt();
					return jsonResponse({ retry: true }, 503);
				}
			}
			return jsonResponse({ request: url.endsWith("request=second") ? "second" : "first" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1"], {
			retryByProvider: {
				p1: {
					enabled: true,
					maxAttempts: 2,
					initialDelayMs: 1_000,
					maxDelayMs: 1_000,
					backoff: "fixed",
					on5xx: true,
				},
			},
			limiterByProvider: { p1: { maxConcurrent: 1 } },
		});
		const controller = new AbortController();
		const abortReason = Object.assign(new Error("stop retry wait"), { name: "AbortError" });
		const firstRequest = registry.get(registry.resolve(), "/api/v1/accounts", { request: "first" }, controller.signal);
		const firstOutcome = firstRequest.then(
			(response) => ({ response, error: undefined }),
			(error: unknown) => ({ response: undefined, error })
		);
		await firstAttemptCompleted;

		let secondSettled = false;
		const secondRequest = registry.get(registry.resolve(), "/api/v1/accounts", { request: "second" }).then((response) => {
			secondSettled = true;
			return response;
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		const releasedDuringBackoff = secondSettled;

		controller.abort(abortReason);
		const [first, secondResponse] = await Promise.all([firstOutcome, secondRequest]);
		expect(first.error).toBe(abortReason);
		await expect(secondResponse.json()).resolves.toEqual({ request: "second" });
		expect(releasedDuringBackoff).toBe(true);
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/accounts?request=first",
			"https://p1.local/api/v1/accounts?request=second",
		]);
	});

	it("continues to another provider after a failover provider has a network failure", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p1.local/")) return jsonResponse({ source: "p1" }, 503);
			if (url.startsWith("https://p2.local/")) throw networkFailure("socket hang up", "ECONNRESET");
			return jsonResponse({ source: "p3" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"]);
		const response = await registry.get(registry.resolve(), "/api/v1/tokens");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/tokens",
			"https://p2.local/api/v1/tokens",
			"https://p3.local/api/v1/tokens",
		]);
	});

	it("continues after a retryable HTTP failure on an alternate selected after a network failure", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p1.local/")) throw networkFailure("fetch failed", "EAI_AGAIN");
			if (url.startsWith("https://p2.local/")) return jsonResponse({ source: "p2" }, 429);
			return jsonResponse({ source: "p3" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"]);
		const response = await registry.get(registry.resolve(), "/api/v1/topics");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/topics",
			"https://p2.local/api/v1/topics",
			"https://p3.local/api/v1/topics",
		]);
	});

	it("never fails over an aborted request", async () => {
		const controller = new AbortController();
		const reason = Object.assign(new Error("cancelled by caller"), { name: "AbortError" });
		controller.abort(reason);
		const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(reason);
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2"]);
		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts", undefined, controller.signal));

		expect(error).toBe(reason);
		expect(requestedUrls(fetchMock)).toEqual(["https://p1.local/api/v1/accounts"]);
	});

	it("observes aborts promptly while the request is waiting in a limiter queue", async () => {
		const limiterConfig: LimiterConfig = { reservoir: 0 };
		const controller = new AbortController();
		const reason = Object.assign(new Error("cancelled while queued"), { name: "AbortError" });
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (_input, init) => {
			if (init?.signal?.aborted) throw init.signal.reason;
			return jsonResponse({ unexpected: true });
		});
		vi.stubGlobal("fetch", fetchMock);
		const registry = createRegistry(["p1", "p2"], { limiterByProvider: { p1: limiterConfig } });
		const target = registry.resolve();
		const limiter = registry.getLimiterReg().get(target.limiterBucket!, target.http.limiter);
		if (!limiter) throw new Error("Expected the primary provider limiter to exist");

		const request = registry.get(target, "/api/v1/accounts", undefined, controller.signal).then(
			(response) => ({ state: "resolved" as const, response, error: undefined }),
			(error: unknown) => ({ state: "rejected" as const, response: undefined, error })
		);
		controller.abort(reason);
		const earlyOutcome = await Promise.race([
			request,
			new Promise<{ state: "pending"; response: undefined; error: undefined }>((resolve) =>
				setTimeout(() => resolve({ state: "pending", response: undefined, error: undefined }), 100)
			),
		]);
		const fetchCallsBeforeCleanup = fetchMock.mock.calls.length;

		// Ensure neither a passing nor a broken implementation leaves the
		// deliberately capacity-starved Bottleneck job alive after the test.
		await limiter.stop({ dropWaitingJobs: true });
		if (earlyOutcome.state === "pending") await request;

		expect(earlyOutcome).toMatchObject({ state: "rejected", error: reason });
		expect(fetchCallsBeforeCleanup).toBe(0);
		expect(requestedUrls(fetchMock).every((url) => url.startsWith("https://p1.local/"))).toBe(true);
	});

	it("preserves the exact HttpError when the network has only one provider", async () => {
		const registry = createRegistry(["p1"]);
		const original = new HttpError(503, "https://p1.local/api/v1/accounts", "primary unavailable", {
			_status: { messages: [{ message: "unavailable" }] },
		});
		vi.spyOn(registry.getHttp(), "request").mockRejectedValue(original);

		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts"));

		expect(error).toBe(original);
		expect(error).toMatchObject({ status: 503, url: original.url, body: original.body });
	});

	it("preserves the exact typed network error when the network has only one provider", async () => {
		const registry = createRegistry(["p1"]);
		const cause = networkFailure("getaddrinfo ENOTFOUND p1.local", "ENOTFOUND");
		const original = new HttpNetworkError("https://p1.local/api/v1/accounts", 1, cause);
		vi.spyOn(registry.getHttp(), "request").mockRejectedValue(original);

		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts"));

		expect(error).toBe(original);
		expect((error as HttpNetworkError).cause).toBe(cause);
	});

	it("exposes typed network diagnostics when a single provider's fetch attempts are exhausted", async () => {
		const original = networkFailure("connect ECONNREFUSED", "ECONNREFUSED");
		const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(original);
		vi.stubGlobal("fetch", fetchMock);
		const registry = createRegistry(["p1"]);

		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts"));

		expect(error).toBeInstanceOf(HttpNetworkError);
		expect(error).toMatchObject({
			url: "https://p1.local/api/v1/accounts",
			attempts: 1,
			cause: original,
		});
		expect(requestedUrls(fetchMock)).toEqual(["https://p1.local/api/v1/accounts"]);
	});

	it("tracks the provider that actually executed after overflow and never attempts a provider twice", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p1.local/")) throw new Error("p1 must only be capacity-probed");
			if (url.startsWith("https://p2.local/")) return jsonResponse({ source: "p2" }, 503);
			return jsonResponse({ source: "p3" });
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"], {
			switchProviderWhenOverflow: true,
			limiterByProvider: { p1: { reservoir: 1 } },
		});
		const primaryTarget = registry.resolve();
		const primaryLimiter = registry.getLimiterReg().get(primaryTarget.limiterBucket!, primaryTarget.http.limiter);
		if (!primaryLimiter) throw new Error("Expected the primary provider limiter to exist");
		vi.spyOn(primaryLimiter, "schedule").mockRejectedValue(new LimiterCapacityError(primaryTarget.limiterBucket!));
		const response = await registry.get(primaryTarget, "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p2.local/api/v1/accounts",
			"https://p3.local/api/v1/accounts",
		]);
		expect(new Set(requestedUrls(fetchMock)).size).toBe(fetchMock.mock.calls.length);
	});

	it("uses the destination limiter and disables retries on every failover provider", async () => {
		const destinationLimiter: LimiterConfig = { reservoir: 5 };
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p3.local/")) return jsonResponse({ source: "p3" });
			return jsonResponse({ unavailable: true }, 503);
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"], {
			retryByProvider: {
				p2: {
					enabled: true,
					maxAttempts: 4,
					initialDelayMs: 0,
					maxDelayMs: 0,
					backoff: "fixed",
					on5xx: true,
				},
			},
			limiterByProvider: { p2: destinationLimiter },
		});
		const destination = registry.resolve("p2", "testnet");
		const limiter = registry.getLimiterReg().get(destination.limiterBucket!, destination.http.limiter);
		expect(await limiter?.currentReservoir()).toBe(5);

		const response = await registry.get(registry.resolve(), "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/accounts",
			"https://p2.local/api/v1/accounts",
			"https://p3.local/api/v1/accounts",
		]);
		expect(await limiter?.currentReservoir()).toBe(4);
	});

	it("applies destination limiters and one-attempt failover semantics to POST", async () => {
		const limiterConfig: LimiterConfig = { reservoir: 2 };
		const configuredRetry: RetryPolicy = {
			enabled: true,
			maxAttempts: 4,
			initialDelayMs: 0,
			maxDelayMs: 0,
			backoff: "fixed",
			on5xx: true,
		};
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://p3.local/")) return jsonResponse({ source: "p3" });
			return jsonResponse({ unavailable: true }, 503);
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"], {
			retryByProvider: { p2: configuredRetry, p3: configuredRetry },
			limiterByProvider: { p2: limiterConfig, p3: limiterConfig },
		});
		const p2 = registry.resolve("p2", "testnet");
		const p3 = registry.resolve("p3", "testnet");
		const p2Limiter = registry.getLimiterReg().get(p2.limiterBucket!, p2.http.limiter)!;
		const p3Limiter = registry.getLimiterReg().get(p3.limiterBucket!, p3.http.limiter)!;

		const response = await registry.post(registry.resolve(), "/api/v1/contracts/call", { data: "0x1234" });

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/contracts/call",
			"https://p2.local/api/v1/contracts/call",
			"https://p3.local/api/v1/contracts/call",
		]);
		expect(await p2Limiter.currentReservoir()).toBe(1);
		expect(await p3Limiter.currentReservoir()).toBe(1);
	});

	it("throws the final real HttpError with its status, URL, and body when every provider fails", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const provider = new URL(String(input)).hostname.split(".")[0];
			return jsonResponse({ provider, detail: `${provider} unavailable` }, 503);
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"]);
		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts"));

		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({
			status: 503,
			url: "https://p3.local/api/v1/accounts",
			body: { provider: "p3", detail: "p3 unavailable" },
		});
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/accounts",
			"https://p2.local/api/v1/accounts",
			"https://p3.local/api/v1/accounts",
		]);
	});

	it("throws the final provider's typed network error with its original cause when every provider is unreachable", async () => {
		const failures = {
			p1: networkFailure("p1 DNS failure", "ENOTFOUND"),
			p2: networkFailure("p2 connection failure", "ECONNREFUSED"),
			p3: networkFailure("p3 connection reset", "ECONNRESET"),
		};
		const fetchMock = vi.fn<typeof fetch>();
		fetchMock.mockImplementation(async (input) => {
			const provider = new URL(String(input)).hostname.split(".")[0] as keyof typeof failures;
			throw failures[provider];
		});
		vi.stubGlobal("fetch", fetchMock);

		const registry = createRegistry(["p1", "p2", "p3"]);
		const error = await captureFailure(registry.get(registry.resolve(), "/api/v1/accounts"));

		expect(error).toBeInstanceOf(HttpNetworkError);
		expect(error).toMatchObject({
			url: "https://p3.local/api/v1/accounts",
			attempts: 1,
			cause: failures.p3,
		});
		expect(requestedUrls(fetchMock)).toEqual([
			"https://p1.local/api/v1/accounts",
			"https://p2.local/api/v1/accounts",
			"https://p3.local/api/v1/accounts",
		]);
	});
});
