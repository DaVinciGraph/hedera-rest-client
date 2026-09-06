import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/core/provider";
import { prepareQueryLimit } from "../../src/core/limits";
import { wrapPaged } from "../../src/core/paging";
import { AccountsBuilder } from "../../src/resources/accounts/builder";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function registry(options: { overflow?: boolean; failure?: boolean } = {}): ProviderRegistry {
	return new ProviderRegistry({
		defaultProvider: "p1",
		defaultNetwork: "testnet",
		switchProviderWhenOverflow: options.overflow,
		switchProviderOnFailure: options.failure,
		provider: {
			p1: {
				testnet: {
					url: "https://p1.local/one",
					page: { defaultLimit: 50, maxLimit: 200, endpoints: { "network.nodes": { defaultLimit: 10, maxLimit: 25 } } },
				},
			},
			p2: {
				testnet: {
					url: "https://p2.local/two",
					page: { defaultLimit: 25, maxLimit: 100, endpoints: { "network.nodes": { defaultLimit: 5, maxLimit: 10 } } },
					http: options.overflow ? { limiter: { reservoir: 0 } } : undefined,
				},
			},
			p3: { testnet: { url: "https://p3.local/three", page: { defaultLimit: 10, maxLimit: 75 } } },
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("provider-aware limits", () => {
	it("retains symbolic intent and resolves it again for the provider that actually serves the request", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ accounts: [], links: { next: null } });
			})
		);
		const subject = registry({ failure: true });
		const query: Record<string, unknown> = { limit: "default" };
		prepareQueryLimit(subject.resolve("p1", "testnet"), query);

		await subject.get(subject.resolve("p1", "testnet"), "/api/v1/accounts", query);

		expect(query.limit).toBe(50);
		expect(urls).toEqual([
			"https://p1.local/one/api/v1/accounts?limit=50",
			"https://p2.local/two/api/v1/accounts?limit=25",
		]);
	});

	it("clamps a pagination link separately on every failover target", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ items: ["p2"], links: { next: null } });
			})
		);
		const subject = registry({ failure: true });
		const target = subject.resolve("p1", "testnet");
		const page = wrapPaged<{ items: string[]; next: any }, { items: string[]; links: { next: string | null } }>(
			subject,
			{ target, requestUrl: "https://p1.local/one/api/v1/items?limit=200" },
			{ items: ["p1"], links: { next: "/api/v1/items?limit=200&cursor=2" } },
			(raw) => ({ items: raw.items })
		);

		expect(page.next.url()).toBe("https://p1.local/one/api/v1/items?limit=200&cursor=2");
		await page.next();
		expect(urls).toEqual([
			"https://p1.local/one/api/v1/items?limit=200&cursor=2",
			"https://p2.local/two/api/v1/items?limit=100&cursor=2",
		]);
	});

	it("applies endpoint-specific limits to the initial request and each failover target", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ nodes: [], links: { next: null } });
			})
		);
		const subject = registry({ failure: true });
		const query: Record<string, unknown> = { limit: "max" };
		prepareQueryLimit(subject.resolve("p1", "testnet"), query);

		await subject.get(subject.resolve("p1", "testnet"), "/api/v1/network/nodes", query);

		expect(urls).toEqual([
			"https://p1.local/one/api/v1/network/nodes?limit=25",
			"https://p2.local/two/api/v1/network/nodes?limit=10",
		]);
	});

	it("keeps next.url() aligned with endpoint clamping before pagination failover", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ nodes: [], links: { next: null } });
			})
		);
		const subject = registry({ failure: true });
		const target = subject.resolve("p1", "testnet");
		const page = wrapPaged<{ nodes: unknown[]; next: any }, { nodes: unknown[]; links: { next: string | null } }>(
			subject,
			{ target, requestUrl: "https://p1.local/one/api/v1/network/nodes?limit=25" },
			{ nodes: [], links: { next: "/api/v1/network/nodes?limit=200&node.id=gt%3A1" } },
			(raw) => ({ nodes: raw.nodes })
		);

		expect(page.next.url()).toBe("https://p1.local/one/api/v1/network/nodes?limit=25&node.id=gt%3A1");
		await page.next();
		expect(urls).toEqual([
			"https://p1.local/one/api/v1/network/nodes?limit=25&node.id=gt%3A1",
			"https://p2.local/two/api/v1/network/nodes?limit=10&node.id=gt%3A1",
		]);
	});
});

describe("combined overflow and failure routing", () => {
	it("skips a saturated failover provider and reaches the next available provider for GET", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ source: "p3" });
			})
		);
		const subject = registry({ overflow: true, failure: true });

		const response = await subject.get(subject.resolve("p1", "testnet"), "/api/v1/accounts");

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(urls).toEqual([
			"https://p1.local/one/api/v1/accounts",
			"https://p3.local/three/api/v1/accounts",
		]);
	});

	it("skips a saturated failover provider and reaches the next available provider for POST", async () => {
		const urls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) => {
				const url = String(input);
				urls.push(url);
				return url.startsWith("https://p1.local/") ? json({ unavailable: true }, 503) : json({ source: "p3" });
			})
		);
		const subject = registry({ overflow: true, failure: true });

		const response = await subject.post(subject.resolve("p1", "testnet"), "/api/v1/contracts/call", { data: "00" });

		await expect(response.json()).resolves.toEqual({ source: "p3" });
		expect(urls).toEqual([
			"https://p1.local/one/api/v1/contracts/call",
			"https://p3.local/three/api/v1/contracts/call",
		]);
	});

	it.each(["GET", "POST"] as const)(
		"queues on a capacity-blocked final provider after immediately available providers fail (%s)",
		async (method) => {
			const urls: string[] = [];
			vi.stubGlobal(
				"fetch",
				vi.fn<typeof fetch>(async (input) => {
					const url = String(input);
					urls.push(url);
					return url.startsWith("https://p3.local/") ? json({ source: "p3" }) : json({ unavailable: true }, 503);
				})
			);
			const subject = new ProviderRegistry({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				switchProviderWhenOverflow: true,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" } },
					p2: { testnet: { url: "https://p2.local" } },
					p3: {
						testnet: {
							url: "https://p3.local",
							http: {
								limiter: { reservoir: 0, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 },
							},
						},
					},
				},
			});
			const target = subject.resolve();
			const response =
				method === "GET"
					? await subject.get(target, "/api/v1/test")
					: await subject.post(target, "/api/v1/test", { hello: "world" });

			await expect(response.json()).resolves.toEqual({ source: "p3" });
			expect(urls).toEqual([
				"https://p1.local/api/v1/test",
				"https://p2.local/api/v1/test",
				"https://p3.local/api/v1/test",
			]);
			const p3 = subject.resolve("p3", "testnet");
			await subject.getLimiterReg().get(p3.limiterBucket!, p3.http.limiter)?.stop();
		}
	);

	it.each(["GET", "POST"] as const)(
		"continues through every queued capacity-blocked failover provider (%s)",
		async (method) => {
			const urls: string[] = [];
			vi.stubGlobal(
				"fetch",
				vi.fn<typeof fetch>(async (input) => {
					const url = String(input);
					urls.push(url);
					return url.startsWith("https://p3.local/") ? json({ source: "p3" }) : json({ unavailable: true }, 503);
				})
			);
			const limiter = { reservoir: 0, reservoirRefreshInterval: 250, reservoirRefreshAmount: 1 };
			const subject = new ProviderRegistry({
				defaultProvider: "p1",
				defaultNetwork: "testnet",
				switchProviderWhenOverflow: true,
				switchProviderOnFailure: true,
				provider: {
					p1: { testnet: { url: "https://p1.local" } },
					p2: { testnet: { url: "https://p2.local", http: { limiter } } },
					p3: { testnet: { url: "https://p3.local", http: { limiter } } },
				},
			});

			try {
				const target = subject.resolve();
				const response =
					method === "GET"
						? await subject.get(target, "/api/v1/test")
						: await subject.post(target, "/api/v1/test", { hello: "world" });

				await expect(response.json()).resolves.toEqual({ source: "p3" });
				expect(urls).toEqual([
					"https://p1.local/api/v1/test",
					"https://p2.local/api/v1/test",
					"https://p3.local/api/v1/test",
				]);
			} finally {
				for (const provider of ["p2", "p3"]) {
					const target = subject.resolve(provider, "testnet");
					await subject.getLimiterReg().get(target.limiterBucket!, target.http.limiter)?.stop({ dropWaitingJobs: true });
				}
			}
		}
	);
});

it("threads signal and timeout through an initial resource get", async () => {
	const controller = new AbortController();
	const target = {
		provider: "p1",
		network: "testnet",
		baseUrl: "https://p1.local",
		headers: {},
		http: {},
		page: { defaultLimit: 25, maxLimit: 100 },
	};
	const getWithTarget = vi.fn(async () => ({
		target,
		requestUrl: "https://p1.local/api/v1/accounts",
		response: json({ accounts: [], links: { next: null } }),
	}));
	const fakeRegistry = { resolve: () => target, getWithTarget } as any;

	await new AccountsBuilder(fakeRegistry).list().get({ signal: controller.signal, timeoutMs: 321 });

	expect(getWithTarget).toHaveBeenCalledWith(target, "/api/v1/accounts", {}, controller.signal, 321);
});
