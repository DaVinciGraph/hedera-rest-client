import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/core/errors";
import { ProviderRegistry } from "../../src/core/provider";
import { HederaRestClient } from "../../src/HederaRestClient";

const disabledRetry = { enabled: false } as const;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function textResponse(body: string | null, status: number, contentType?: string): Response {
	return new Response(body, {
		status,
		headers: contentType ? { "content-type": contentType } : undefined,
	});
}

function providerRegistry(providerNames: readonly string[] = ["p1", "p2"]): ProviderRegistry {
	return new ProviderRegistry({
		defaultProvider: providerNames[0],
		defaultNetwork: "testnet",
		switchProviderOnFailure: true,
		provider: Object.fromEntries(
			providerNames.map((name) => [
				name,
				{
					testnet: { url: `https://${name}.local` },
					http: { retry: disabledRetry },
				},
			])
		),
	});
}

function clientWithFailover(): HederaRestClient {
	return new HederaRestClient({
		defaultProvider: "p1",
		defaultNetwork: "testnet",
		switchProviderOnFailure: true,
		provider: {
			p1: { testnet: { url: "https://p1.local" }, http: { retry: disabledRetry } },
			p2: { testnet: { url: "https://p2.local" }, http: { retry: disabledRetry } },
		},
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("non-JSON HTTP errors through the real transport", () => {
	it("fails over a GET from an HTML 503 response to the next provider", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(textResponse("<html><body>temporarily unavailable</body></html>", 503, "text/html"))
			.mockResolvedValueOnce(jsonResponse({ accounts: [{ account: "0.0.7" }] }));
		vi.stubGlobal("fetch", fetchMock);

		const registry = providerRegistry();
		const response = await registry.get(registry.resolve(), "/api/v1/accounts", { limit: 1 });

		await expect(response.json()).resolves.toEqual({ accounts: [{ account: "0.0.7" }] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			"https://p1.local/api/v1/accounts?limit=1",
			"https://p2.local/api/v1/accounts?limit=1",
		]);
	});

	it("fails over a POST without losing the request body", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(textResponse("upstream unavailable", 503, "text/plain"))
			.mockResolvedValueOnce(jsonResponse({ result: "0x01" }));
		vi.stubGlobal("fetch", fetchMock);

		const registry = providerRegistry();
		const body = {
			to: "0x0000000000000000000000000000000000000001",
			data: "0x1234",
		};
		const response = await registry.post(registry.resolve(), "/api/v1/contracts/call", body);

		await expect(response.json()).resolves.toEqual({ result: "0x01" });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			"https://p1.local/api/v1/contracts/call",
			"https://p2.local/api/v1/contracts/call",
		]);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init).toMatchObject({ method: "POST", body: JSON.stringify(body) });
		}
	});

	it("continues rotating when multiple providers return non-JSON 503 responses", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(textResponse("first unavailable", 503, "text/plain"))
			.mockResolvedValueOnce(textResponse("<h1>second unavailable</h1>", 503, "text/html"))
			.mockResolvedValueOnce(jsonResponse({ source: "p3" }));
		vi.stubGlobal("fetch", fetchMock);

		const registry = providerRegistry(["p1", "p2", "p3"]);
		const response = await registry.get(registry.resolve(), "/api/v1/network/nodes");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			"https://p1.local/api/v1/network/nodes",
			"https://p2.local/api/v1/network/nodes",
			"https://p3.local/api/v1/network/nodes",
		]);
	});

	it("preserves a non-retryable text 400 as HttpError and does not fail over", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(textResponse("invalid account filter", 400, "text/plain"));
		vi.stubGlobal("fetch", fetchMock);

		const registry = providerRegistry();
		const request = registry.get(registry.resolve(), "/api/v1/accounts");

		await expect(request).rejects.toMatchObject({
			status: 400,
			url: "https://p1.local/api/v1/accounts",
			body: "invalid account filter",
		});
		await expect(request).rejects.toBeInstanceOf(HttpError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("singular-resource 404 handling through the real transport", () => {
	it.each([
		{ label: "an empty", body: null, contentType: undefined },
		{ label: "a plain-text", body: "account not found", contentType: "text/plain" },
		{ label: "an HTML", body: "<html><body>account not found</body></html>", contentType: "text/html" },
	])("returns null without failover for $label 404 response", async ({ body, contentType }) => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(textResponse(body, 404, contentType));
		vi.stubGlobal("fetch", fetchMock);

		const result = await clientWithFailover().accounts().one({ idOrAliasOrEvmAddress: "0.0.999" }).get();

		expect(result).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0][0])).toBe("https://p1.local/api/v1/accounts/0.0.999");
	});
});
