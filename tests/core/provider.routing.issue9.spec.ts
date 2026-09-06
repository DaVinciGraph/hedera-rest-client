import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/core/provider";
import type { ProviderConfigMap } from "../../src/types";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function registry(
	provider: ProviderConfigMap,
	options: { switchProviderOnFailure?: boolean; switchProviderWhenOverflow?: boolean } = {}
): ProviderRegistry {
	return new ProviderRegistry({
		defaultProvider: "p1",
		defaultNetwork: "testnet",
		provider,
		...options,
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("ProviderRegistry issue #9 routed response provenance", () => {
	it("reports the requested target and exact request URL when no routing switch occurs", async () => {
		const response = jsonResponse({ source: "p1" });
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
		vi.stubGlobal("fetch", fetchMock);

		const providers: ProviderConfigMap = {
			p1: {
				testnet: {
					url: "https://p1.local/mirror-one",
					http: { retry: { enabled: false } },
				},
			},
		};
		const subject = registry(providers);
		const requestedTarget = subject.resolve("p1", "testnet");

		const routed = await subject.getWithTarget(requestedTarget, "/api/v1/accounts", { limit: 1 });

		expect(routed).toEqual({
			response,
			target: requestedTarget,
			requestUrl: "https://p1.local/mirror-one/api/v1/accounts?limit=1",
		});
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0][0])).toBe(routed.requestUrl);
	});

	it("reports the actual alternate target and URL after HTTP failover", async () => {
		const primaryFailure = jsonResponse({ message: "temporarily unavailable" }, 503);
		const alternateResponse = jsonResponse({ source: "p2" });
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(primaryFailure).mockResolvedValueOnce(alternateResponse);
		vi.stubGlobal("fetch", fetchMock);

		const providers: ProviderConfigMap = {
			p1: {
				testnet: {
					url: "https://p1.local/mirror-one",
					http: { retry: { enabled: false } },
				},
			},
			p2: {
				testnet: {
					url: "https://p2.local/mirror-two/api/v1",
					http: { retry: { enabled: false } },
				},
			},
		};
		const subject = registry(providers, { switchProviderOnFailure: true });

		const routed = await subject.getWithTarget(subject.resolve("p1", "testnet"), "/api/v1/tokens", { limit: 2 });

		expect(routed.response).toBe(alternateResponse);
		expect(routed.target).toEqual(subject.resolve("p2", "testnet"));
		expect(routed.requestUrl).toBe("https://p2.local/mirror-two/api/v1/tokens?limit=2");
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
			"https://p1.local/mirror-one/api/v1/tokens?limit=2",
			"https://p2.local/mirror-two/api/v1/tokens?limit=2",
		]);
	});

	it("reports the provider selected by an overflow-capacity probe", async () => {
		const alternateResponse = jsonResponse({ source: "p2" });
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(alternateResponse);
		vi.stubGlobal("fetch", fetchMock);

		const providers: ProviderConfigMap = {
			p1: {
				testnet: {
					url: "https://p1.local/primary",
					http: { retry: { enabled: false }, limiter: { reservoir: 0 } },
				},
			},
			p2: {
				testnet: {
					url: "https://p2.local/alternate",
					http: { retry: { enabled: false } },
				},
			},
		};
		const subject = registry(providers, { switchProviderWhenOverflow: true });

		const routed = await subject.getWithTarget(subject.resolve("p1", "testnet"), "/api/v1/blocks");

		expect(routed.response).toBe(alternateResponse);
		expect(routed.target.provider).toBe("p2");
		expect(routed.target.baseUrl).toBe("https://p2.local/alternate");
		expect(routed.requestUrl).toBe("https://p2.local/alternate/api/v1/blocks");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0][0])).toBe(routed.requestUrl);
	});

	it("keeps get() source-compatible by returning the Response itself", async () => {
		const response = jsonResponse({ source: "p1" });
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
		vi.stubGlobal("fetch", fetchMock);

		const providers: ProviderConfigMap = {
			p1: {
				testnet: {
					url: "https://p1.local",
					http: { retry: { enabled: false } },
				},
			},
		};
		const subject = registry(providers);

		const result = await subject.get(subject.resolve(), "/api/v1/network/nodes");

		expect(result).toBe(response);
		expect(result).toBeInstanceOf(Response);
	});
});
