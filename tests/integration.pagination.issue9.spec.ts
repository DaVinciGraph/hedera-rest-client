import { afterEach, describe, expect, it, vi } from "vitest";
import { HederaRestClient } from "../src/HederaRestClient";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("issue #9 pagination routing integration", () => {
	it("keeps a first-page failover provider and never duplicates custom prefixes", async () => {
		const nextUrl = "https://b.local/b/api/v1/tokens?limit=1&token.id=gt%3A0.0.1";
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({ message: "provider A unavailable" }, 503))
			.mockResolvedValueOnce(json({ tokens: [{ token_id: "0.0.1" }], links: { next: nextUrl } }))
			.mockResolvedValueOnce(json({ tokens: [{ token_id: "0.0.2" }], links: { next: null } }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new HederaRestClient({
			defaultProvider: "a",
			defaultNetwork: "testnet",
			switchProviderOnFailure: true,
			provider: {
				a: {
					testnet: {
						url: "https://a.local/a/api/v1",
						http: { retry: { enabled: false } },
					},
				},
				b: {
					testnet: {
						url: "https://b.local/b/api/v1",
						http: { retry: { enabled: false } },
					},
				},
			},
		});

		const first = await client.tokens().list({ limit: 1 }).get();
		expect(first.tokens).toEqual([{ token_id: "0.0.1" }]);
		expect(first.next.url()).toBe(nextUrl);

		const second = await first.next();
		expect(second?.tokens).toEqual([{ token_id: "0.0.2" }]);
		expect(second?.next.url()).toBeNull();

		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
			"https://a.local/a/api/v1/tokens?limit=1",
			"https://b.local/b/api/v1/tokens?limit=1",
			nextUrl,
		]);
	});
});
