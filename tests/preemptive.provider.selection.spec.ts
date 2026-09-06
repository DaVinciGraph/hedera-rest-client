import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HederaRestClient } from "../src/HederaRestClient";

// Small helper to start a mock Mirror server that returns a token indicating which provider served it.
async function startMockServer(name: string) {
	const server = http.createServer((req, res) => {
		if (req.url?.startsWith("/api/v1/tokens")) {
			const body = JSON.stringify({
				tokens: [{ token_id: "0.0.1", symbol: `SYM-${name}`, name }],
				links: { next: null },
			});
			res.writeHead(200, { "content-type": "application/json" });
			res.end(body);
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ message: "not found" }));
	});

	await new Promise<void>((resolve) => server.listen(0, resolve)); // 0 => ephemeral port
	const addr = server.address() as AddressInfo;
	const port = addr.port;
	return {
		server,
		url: `http://127.0.0.1:${port}`,
		name,
	};
}

async function stopServer(srv: http.Server) {
	await new Promise<void>((resolve) => srv.close(() => resolve()));
}

// Fire N parallel token list requests scoped to provider "p1" / network "testnet".
// Returns counts of how many responses came from p1 vs p2 (based on token.name).
async function runBurst(client: HederaRestClient, N: number) {
	const tasks = Array.from({ length: N }, async () => {
		const page = await client.useProvider("p1").useNetwork("testnet").tokens().list({ limit: 1 }).get();

		const token = page.tokens[0];
		return token.name; // "p1" or "p2" as served by the mock
	});

	const results = await Promise.all(tasks);
	return results.reduce<Record<string, number>>((acc, name) => {
		acc[name] = (acc[name] || 0) + 1;
		return acc;
	}, {});
}

describe.sequential("Preemptive provider selection — Bottleneck capacity", () => {
	let p1: { server: http.Server; url: string; name: string };
	let p2: { server: http.Server; url: string; name: string };

	beforeAll(async () => {
		p1 = await startMockServer("p1");
		p2 = await startMockServer("p2");
	});

	afterAll(async () => {
		await stopServer(p1.server);
		await stopServer(p2.server);
	});

	it("1) Two providers, switchProviderOnFailure=false → all requests stick to p1", async () => {
		const client = new HederaRestClient({
			log: false,
			switchProviderWhenOverflow: false, // preemptive switch disabled
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			provider: {
				p1: {
					testnet: {
						url: p1.url,
						http: {
							limiter: {
								reservoir: 100,
								reservoirRefreshInterval: 60_000,
								reservoirRefreshAmount: 100,
							},
						},
					},
				},
				p2: {
					testnet: {
						url: p2.url,
						http: {
							limiter: {
								reservoir: 100,
								reservoirRefreshInterval: 60_000,
								reservoirRefreshAmount: 100,
							},
						},
					},
				},
			},
		});

		const N = 25;
		const counts = await runBurst(client, N);
		expect(counts["p1"]).toBe(N);
		expect(counts["p2"] ?? 0).toBe(0);
	}, 10_000);

	it("2) Two providers, switchProviderWhenOverflow=true with p1 capacity=1 → some p1, some p2", async () => {
		const client = new HederaRestClient({
			log: false,
			switchProviderWhenOverflow: true, // enable preemptive/overflow-based provider switch
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			provider: {
				p1: {
					testnet: {
						url: p1.url,
						http: {
							limiter: {
								reservoir: 2, // only allow first job to be scheduled on p1
								reservoirRefreshInterval: 1000, // do not refill during the test
								reservoirRefreshAmount: 2,
							},
						},
					},
				},
				p2: {
					testnet: {
						url: p2.url,
						http: {
							limiter: {
								reservoir: 100,
								reservoirRefreshInterval: 60_000,
								reservoirRefreshAmount: 100,
							},
						},
					},
				},
			},
		});

		const N = 25;
		const counts = await runBurst(client, N);

		// We expect at least the very first request to hit p1, and the rest to preemptively go to p2
		expect(counts["p1"] ?? 0).toBeGreaterThan(0);
		expect(counts["p2"] ?? 0).toBeGreaterThan(0);
		expect((counts["p1"] ?? 0) + (counts["p2"] ?? 0)).toBe(N);
	}, 10_000);

	it("3) One provider only, switchProviderWhenOverflow=true → all requests use p1", async () => {
		const client = new HederaRestClient({
			log: false,
			switchProviderWhenOverflow: true, // enabled, but there is no other provider to switch to
			defaultProvider: "p1",
			defaultNetwork: "testnet",
			provider: {
				p1: {
					testnet: {
						url: p1.url,
						http: {
							limiter: {
								reservoir: 100,
								reservoirRefreshInterval: 60_000,
								reservoirRefreshAmount: 100,
							},
						},
					},
				},
				// no p2 configured here on purpose
			},
		});

		const N = 25;
		const counts = await runBurst(client, N);
		expect(counts["p1"]).toBe(N);
		expect(counts["p2"] ?? 0).toBe(0);
	}, 10_000);
});
