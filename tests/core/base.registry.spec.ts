import { describe, it, expect, vi } from "vitest";
import { TopicsBuilder } from "../../src/resources/topics/builder";

// --- Minimal ProviderRegistry + target stubs for these glue tests ---

type Call =
	| { fn: "resolve"; provider?: string; network?: string }
	| { fn: "get"; path: string; params?: any; target: any; signal?: AbortSignal }
	| { fn: "getWithFailover"; provider?: string; network?: string; path: string; params?: any; signal?: AbortSignal };

class FakeRegistry {
	calls: Call[] = [];
	failover = false;

	constructor(private defaults = { provider: "defProv", network: "defNet", defaultLimit: 25, maxLimit: 100 }) {}

	resolve(provider?: string, network?: string) {
		this.calls.push({ fn: "resolve", provider, network });
		const p = provider ?? this.defaults.provider;
		const n = network ?? this.defaults.network;
		return {
			provider: p,
			network: n,
			baseUrl: `https://${p}.${n}.mirror`,
			page: { defaultLimit: this.defaults.defaultLimit, maxLimit: this.defaults.maxLimit },
		};
	}

	isFailoverEnabled() {
		return this.failover;
	}

	// GET is what resource builders use for all GET endpoints
	get(target: any, path: string, _params?: any, signal?: AbortSignal) {
		this.calls.push({ fn: "get", path, params: _params, target, signal });
		// Enough to satisfy .json() calls in builders
		const payload = path.includes("/messages") ? ({ messages: [], links: { next: null } } as any) : ({ some: "topic", topic_id: "0.0.x" } as any);
		return {
			json: async () => payload,
			text: async () => JSON.stringify(payload),
		} as any;
	}

	async getWithTarget(target: any, path: string, params?: any, signal?: AbortSignal) {
		const response = await this.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: new URL(path, `${target.baseUrl}/`).toString(),
		};
	}

	// Not exercised in these glue tests but needed by types / builders
	getWithFailover(provider?: string, network?: string, path?: string, params?: any, signal?: AbortSignal) {
		this.calls.push({ fn: "getWithFailover", provider, network, path: path!, params, signal });
		return {
			json: async () => (path?.includes("/messages") ? { messages: [], links: { next: null } } : { some: "topic" }),
			text: async () => JSON.stringify(path?.includes("/messages") ? { messages: [], links: { next: null } } : { some: "topic" }),
		} as any;
	}

	getLogger() {
		return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	}
}

describe("Base/registry glue", () => {
	it("uses ctor-supplied provider/network in resolve() and passes that target into registry.get()", async () => {
		const reg = new FakeRegistry();
		const b = new TopicsBuilder(reg as any, "ctorProv", "ctorNet");

		await b.one({ topicId: "0.0.123" }).get();

		// First call is resolve with ctor values
		expect(reg.calls[0]).toEqual({ fn: "resolve", provider: "ctorProv", network: "ctorNet" });

		// Next call is get() with the resolved target and the expected path
		const getCall = reg.calls.find((c) => c.fn === "get") as any;
		expect(getCall.path).toBe("/api/v1/topics/0.0.123");
		expect(getCall.target.provider).toBe("ctorProv");
		expect(getCall.target.network).toBe("ctorNet");
		expect(getCall.target.baseUrl).toBe("https://ctorProv.ctorNet.mirror");
	});

	it("provider()/network() are chainable and persist across calls (override ctor values)", async () => {
		const reg = new FakeRegistry();
		const b = new TopicsBuilder(reg as any, "pA", "nA");

		// Chainability & identity
		const afterProvider = b.provider("pB");
		//@ts-ignore
		const afterNetwork = b.network("nB");
		expect(afterProvider).toBe(b);
		expect(afterNetwork).toBe(b);

		// First call after overrides
		await b.one({ topicId: "0.0.1" }).get();
		let resCall = reg.calls.find((c) => c.fn === "resolve") as any;
		expect(resCall.provider).toBe("pB");
		expect(resCall.network).toBe("nB");

		let getCall = reg.calls.find((c) => c.fn === "get") as any;
		expect(getCall.target.provider).toBe("pB");
		expect(getCall.target.network).toBe("nB");

		// Change only network; provider should keep previous override
		//@ts-ignore
		b.network("nC");
		await b.one({ topicId: "0.0.2" }).get();

		const lastResolve = reg.calls.filter((c) => c.fn === "resolve").pop() as any;
		expect(lastResolve.provider).toBe("pB"); // unchanged
		expect(lastResolve.network).toBe("nC"); // updated

		const lastGet = reg.calls.filter((c) => c.fn === "get").pop() as any;
		expect(lastGet.target.provider).toBe("pB");
		expect(lastGet.target.network).toBe("nC");
	});

	it("rejects invalid resource-builder scope names immediately", () => {
		const reg = new FakeRegistry();
		const builder = new TopicsBuilder(reg as any);

		expect(() => builder.provider(null as any)).toThrow(/provider.*non-empty string/);
		expect(() => builder.network(undefined as any)).toThrow(/network.*non-empty string/);
		expect(() => new TopicsBuilder(reg as any, "", "testnet")).toThrow(/provider.*non-empty string/);
	});

	it("partial overrides: if only provider() is set, network falls back to registry.resolve's default", async () => {
		const reg = new FakeRegistry({ provider: "defProv", network: "defNet", defaultLimit: 25, maxLimit: 100 });
		const b = new TopicsBuilder(reg as any); // no ctor provider/network

		b.provider("onlyProv");
		await b.one({ topicId: "0.0.9" }).get();

		const resCall = reg.calls.find((c) => c.fn === "resolve") as any;
		expect(resCall.provider).toBe("onlyProv");
		expect(resCall.network).toBeUndefined(); // we passed undefined into resolve

		const getCall = reg.calls.find((c) => c.fn === "get") as any;
		// Target returned by resolve should have default network filled in
		expect(getCall.target.provider).toBe("onlyProv");
		expect(getCall.target.network).toBe("defNet");
	});

	it("works equally for list endpoints (uses same resolve + target wiring)", async () => {
		const reg = new FakeRegistry();
		const b = new TopicsBuilder(reg as any, "provX", "netY");

		await b.messages({ topicId: "0.0.777", limit: 5, order: "desc" }).get();

		const resCall = reg.calls.find((c) => c.fn === "resolve") as any;
		expect(resCall.provider).toBe("provX");
		expect(resCall.network).toBe("netY");

		const getCall = reg.calls.find((c) => c.fn === "get") as any;
		expect(getCall.path).toBe("/api/v1/topics/0.0.777/messages");
		expect(getCall.target.provider).toBe("provX");
		expect(getCall.target.network).toBe("netY");
		// params are assembled by the mapper; we just verify presence of order/limit wiring here
		expect(getCall.params.order).toBe("desc");
		// numeric limit passes straight through; resolveLimitValue clamping is covered elsewhere
		// if page.maxLimit < 5 these tests would clamp—our FakeRegistry maxLimit is 100.
		expect(getCall.params.limit).toBe(5);
	});
});
