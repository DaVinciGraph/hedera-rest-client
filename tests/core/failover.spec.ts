import { describe, it, expect } from "vitest";
import { TopicsBuilder } from "../../src/resources/topics/builder";
import { TransactionsBuilder } from "../../src/resources/transactions/builder";
import { HttpError } from "../../src/core/errors";

/** Minimal ProviderRegistry test double that records calls and can simulate failures */
class FakeRegistry {
	calls: any[] = [];
	failoverEnabled = false;
	firstCall = true;

	// knobs per test
	throwOnFirstGet: Error | null = null;
	fixedJson: any = {};
	failoverJson: any = {};
	defaults = { provider: "defProv", network: "defNet", defaultLimit: 25, maxLimit: 100 };

	constructor(opts?: Partial<FakeRegistry>) {
		Object.assign(this, opts);
	}

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
		return this.failoverEnabled;
	}

	get(target: any, path: string, params?: any, signal?: AbortSignal) {
		this.calls.push({ fn: "get", target, path, params, signal });
		
		// Simulate failover behavior: first call fails, if failover is enabled and error is retryable, succeed on internal retry
		if (this.firstCall && this.throwOnFirstGet) {
			this.firstCall = false;
			// If failover is enabled and error is retryable (HttpError with 429 or 5xx), simulate internal failover success
			if (this.failoverEnabled && this.throwOnFirstGet instanceof HttpError && (this.throwOnFirstGet.status === 429 || this.throwOnFirstGet.status >= 500)) {
				return { json: async () => this.failoverJson, text: async () => JSON.stringify(this.failoverJson) } as any;
			}
			throw this.throwOnFirstGet;
		}
		
		// Normal success path
		const json = this.fixedJson;
		return { json: async () => json, text: async () => JSON.stringify(json) } as any;
	}

	async getWithTarget(target: any, path: string, params?: any, signal?: AbortSignal) {
		const response = await this.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: new URL(path, `${target.baseUrl}/`).toString(),
		};
	}

	getLogger() {
		return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
	}
}

describe("Generic failover behavior", () => {
	it("failover is now handled internally by registry.get() - retries with HttpError trigger failover", async () => {
		const reg = new FakeRegistry({
			failoverEnabled: true,
			throwOnFirstGet: new HttpError(500, "internal server error"),
			failoverJson: { ok: true, via: "failover" },
		});

		const b = new TransactionsBuilder(reg as any, "provA", "netA");
		const txId = "0.0.1111-1700000000-000000001";

		const out = await b.byId({ transactionId: txId, nonce: 7, scheduled: false, useCache: false }).get();

		// Returned data is from the failover attempt (internal to registry.get)
		expect(out).toEqual({ ok: true, via: "failover" });

		// Call sequence: resolve -> get (internally handles failover)
		expect(reg.calls[0]).toMatchObject({ fn: "resolve", provider: "provA", network: "netA" });
		expect(reg.calls[1]).toMatchObject({ fn: "get", path: `/api/v1/transactions/${encodeURIComponent(txId)}` });

		// Only one call to get from builder perspective (failover is internal)
		expect(reg.calls.filter((c) => c.fn === "get")).toHaveLength(1);
		
		// Params passed through
		expect(reg.calls[1].params).toEqual({ nonce: 7, scheduled: false });
	});

	it("bubbles the original error when failover is disabled", async () => {
		const reg = new FakeRegistry({
			failoverEnabled: false,
			throwOnFirstGet: new Error("primary broken"),
		});

		const b = new TopicsBuilder(reg as any, "pX", "nY");

		await expect(b.messages({ topicId: "0.0.777", order: "asc", limit: 7 }).get()).rejects.toThrow("primary broken");

		// Only initial attempt was made
		expect(reg.calls.filter((c) => c.fn === "get")).toHaveLength(1);
	});

	it("for single endpoints: 404 turns into null and does NOT trigger failover even if enabled", async () => {
		const reg = new FakeRegistry({
			failoverEnabled: true,
			throwOnFirstGet: new HttpError(404, "not found"),
			fixedJson: { shouldNotBeUsed: true },
		});

		const b = new TopicsBuilder(reg as any, "provZ", "netZ");
		const out = await b.one({ topicId: "0.0.999", useCache: false }).get();

		expect(out).toBeNull();

		// Sequence: resolve -> get; 404s are NOT retryable by default, so no failover
		expect(reg.calls[0]).toMatchObject({ fn: "resolve" });
		expect(reg.calls[1]).toMatchObject({ fn: "get", path: "/api/v1/topics/0.0.999" });
		
		// No second get call (failover not triggered for 404)
		expect(reg.calls.filter((c) => c.fn === "get")).toHaveLength(1);
	});

	it("for list endpoints: primary error with retryable status triggers failover", async () => {
		const reg = new FakeRegistry({
			failoverEnabled: true,
			throwOnFirstGet: new HttpError(503, "service unavailable"),
			failoverJson: { messages: [{ seq: 1 }], links: { next: null } },
		});

		const b = new TopicsBuilder(reg as any, "provL", "netL");
		const page = await b.messages({ topicId: "0.0.42", order: "desc", limit: 5 }).get();

		// page is the mapped wrapper (we only assert base content is from failover JSON)
		expect(page).toMatchObject({ messages: [{ seq: 1 }] });

		// One get call from builder (failover is internal)
		const getCalls = reg.calls.filter((c) => c.fn === "get");
		expect(getCalls).toHaveLength(1);
		expect(getCalls[0]).toMatchObject({
			path: "/api/v1/topics/0.0.42/messages",
		});
		expect(getCalls[0].params).toEqual({ order: "desc", limit: 5 });
	});
});
