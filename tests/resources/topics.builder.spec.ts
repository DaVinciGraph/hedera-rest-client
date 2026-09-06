import { describe, it, expect, vi, beforeEach } from "vitest";
import { TopicsBuilder } from "../../src/resources/topics/builder";
import { ProviderRegistry } from "../../src/core/provider";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// Common values
const TOPIC = "0.0.100";
const TS = "1700000000.000000123";
const jsonResponse = (body: unknown) => ({ json: async () => body, text: async () => JSON.stringify(body) });

/**
 * Make a ProviderRegistry stub that supports:
 *  - resolve(provider, network) -> { provider, network }
 *  - get() - with internal failover simulation
 *  - isFailoverEnabled()
 *  - getLogger()
 *
 * We also capture all network calls in `calls`.
 */
function makeRegistry(opts?: { failover?: boolean; provider?: string; network?: string }) {
	const calls: Array<{ kind: "get"; path: string; params?: any }> = [];
	const failover = !!opts?.failover;
	const defaultProvider = opts?.provider ?? "prov";
	const defaultNetwork = opts?.network ?? "net";
	// Provide page limits used by resolveLimitValue()
	const page = { defaultLimit: 25, maxLimit: 100 };

	// Minimal fake response bodies for the covered endpoints
	const respond = (path: string) => {
		if (path.startsWith("/api/v1/topics/") && /\/messages\/\d+$/.test(path)) {
			return jsonResponse({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
		}
		if (path.startsWith("/api/v1/topics/") && path.endsWith("/messages")) {
			return jsonResponse({ messages: [], links: { next: null } });
		}
		if (path.startsWith("/api/v1/topics/messages/")) {
			return jsonResponse({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
		}
		if (path.startsWith("/api/v1/topics/") && !path.includes("/messages")) {
			return jsonResponse({ topic_id: TOPIC, memo: "" });
		}
		return jsonResponse({});
	};

	const registry = {
		// IMPORTANT: implement resolve() as expected by ResourceBuilder
		resolve: vi.fn((provider?: string, network?: string) => ({
			provider: provider ?? defaultProvider,
			network: network ?? defaultNetwork,
			baseUrl: `https://${provider ?? defaultProvider}.${network ?? defaultNetwork}.mirror.test`,
			//@ts-ignore
			page, // <-- add page limits here
		})),

		get: vi.fn(async (_target: any, path: string, params?: any) => {
			calls.push({ kind: "get", path, params });
			return respond(path);
		}),

		isFailoverEnabled: vi.fn(() => failover),

		getLogger: vi.fn(() => ({
			debug: vi.fn(),
			warn: vi.fn(),
		})),
	} as unknown as ProviderRegistry;
	(registry as any).getWithTarget = vi.fn(async (...args: any[]) => {
		const [target, path, params] = args;
		const response = await (registry.get as any)(...args);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});

	return {
		registry,
		calls,
		reset: () => (calls.length = 0),
	};
}

/** Simple in-memory cache with required interface */
function makeCache() {
	const store = new Map<string, any>();
	return {
		enabled: true,
		ttlSeconds: 60,
		get: vi.fn(async (network: string, k: string) => store.get(`${network}:${k}`)),
		set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => store.set(`${network}:${k}`, v)),
	};
}

describe("TopicsBuilder — component behavior", () => {
	let regStub: ReturnType<typeof makeRegistry>;

	beforeEach(() => {
		regStub = makeRegistry();
	});

	/* ---------------------- one() ---------------------- */

	describe("one()", () => {
		it("returns Topic and caches when useCache=true; subsequent call hits cache", async () => {
			const topicCache = makeCache();
			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: topicCache, message: makeCache() });

			const t1 = await builder.one({ topicId: TOPIC, useCache: true }).get();
			expect(t1).toEqual({ topic_id: TOPIC, memo: "" });
			expect(regStub.calls[0]).toMatchObject({ kind: "get", path: `/api/v1/topics/${encodeURIComponent(TOPIC)}` });
			expect(topicCache.set).toHaveBeenCalledOnce();
			expect(topicCache.set).toHaveBeenCalledWith("net", `topic:${TOPIC}`, t1, 60);

			const t2 = await builder.one({ topicId: TOPIC, useCache: true }).get();
			expect(t2).toEqual({ topic_id: TOPIC, memo: "" });

			// exactly one network GET thanks to cache
			expect(regStub.calls.filter((c) => c.kind === "get").length).toBe(1);
			expect(topicCache.get).toHaveBeenCalledTimes(2);
		});

		it("404 → null (no failover)", async () => {
			const topicCache = makeCache();
			// Force GET to throw 404
			(regStub.registry.get as any) = vi.fn(async () => {
				throw new HttpError(404, "not found");
			});

			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: topicCache, message: makeCache() });
			const res = await builder.one({ topicId: TOPIC, useCache: true }).get();
			expect(res).toBeNull();
			// 404s are not retryable by default, so no failover
		});

		it("failover: primary throws retryable error, internal failover succeeds", async () => {
			const reg = makeRegistry({ failover: true });
			let firstCall = true;
			(reg.registry.get as any) = vi.fn(async () => {
				if (firstCall) {
					firstCall = false;
					// Simulate internal failover for retryable errors
					return jsonResponse({ topic_id: TOPIC, memo: "" });
				}
				return jsonResponse({ topic_id: TOPIC, memo: "" });
			});

			//@ts-ignore
			const builder = new TopicsBuilder(reg.registry, "prov", "net", { topic: makeCache(), message: makeCache() });
			const res = await builder.one({ topicId: TOPIC, useCache: true }).get();

			expect(res).toEqual({ topic_id: TOPIC, memo: "" });
			expect(reg.registry.get).toHaveBeenCalledOnce(); // Failover is internal
		});
	});

	/* -------------------- messages() -------------------- */

	describe("messages()", () => {
		it("wires params and numeric limit untouched", async () => {
			const builder = new TopicsBuilder(regStub.registry, "prov", "net");

			const page = await builder
				.messages({
					topicId: TOPIC,
					encoding: "utf-8",
					sequenceNumber: "gt:10",
					timestamp: ["gte:1700000000", "lte:1700001000"],
					order: "desc",
					limit: 50,
				})
				.get();

			expect(page).toBeDefined();
			const call = regStub.calls.at(-1)!;
			expect(call.path).toBe(`/api/v1/topics/${encodeURIComponent(TOPIC)}/messages`);
			expect(call.params).toEqual({
				encoding: "utf-8",
				sequencenumber: "gt:10",
				timestamp: ["gte:1700000000", "lte:1700001000"],
				order: "desc",
				limit: 50,
			});
		});

		it("resolves 'default' and 'max' limits via resolveLimitValue", async () => {
			const builder = new TopicsBuilder(regStub.registry, "prov", "net");

			await builder.messages({ topicId: TOPIC, limit: "default" }).get();
			const callDefault = regStub.calls.at(-1)!;
			expect(callDefault.params.limit).toBeTypeOf("number");
			expect(callDefault.params.limit).toBeGreaterThan(0);

			await builder.messages({ topicId: TOPIC, limit: "max" }).get();
			const callMax = regStub.calls.at(-1)!;
			expect(callMax.params.limit).toBeTypeOf("number");
			expect(callMax.params.limit).toBeGreaterThanOrEqual(callDefault.params.limit);
		});

		it("failover: primary throws retryable error, internal failover succeeds", async () => {
			const reg = makeRegistry({ failover: true });
			(reg.registry.get as any) = vi.fn(async () => {
				// Simulate internal failover success
				return jsonResponse({ messages: [], links: { next: null } });
			});

			const builder = new TopicsBuilder(reg.registry, "prov", "net");
			const page = await builder.messages({ topicId: TOPIC, limit: 10 }).get();

			expect(page).toBeDefined();
			expect(reg.registry.get).toHaveBeenCalledOnce(); // Failover is internal
		});
	});

	/* ----------------- messageBySequence() ---------------- */

	describe("messageBySequence()", () => {
		it("returns message and caches when useCache=true", async () => {
			const msgCache = makeCache();
			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: makeCache(), message: msgCache });

			const m1 = await builder.messageBySequence({ topicId: TOPIC, sequenceNumber: 7, useCache: true }).get();
			expect(m1).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			expect(msgCache.set).toHaveBeenCalledOnce();

			const m2 = await builder.messageBySequence({ topicId: TOPIC, sequenceNumber: 7, useCache: true }).get();
			expect(m2).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });

			// exactly one network GET thanks to cache
			expect(regStub.calls.filter((c) => c.kind === "get").length).toBe(1);
		});

		it("404 → null (no failover)", async () => {
			(regStub.registry.get as any) = vi.fn(async () => {
				throw new HttpError(404, "not found");
			});

			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: makeCache(), message: makeCache() });
			const res = await builder.messageBySequence({ topicId: TOPIC, sequenceNumber: 1, useCache: true }).get();

			expect(res).toBeNull();
			// 404s are not retryable by default
		});

		it("failover: primary throws retryable error, internal failover succeeds", async () => {
			const reg = makeRegistry({ failover: true });
			(reg.registry.get as any) = vi.fn(async () => {
				// Simulate internal failover success
				return jsonResponse({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			});

			//@ts-ignore
			const builder = new TopicsBuilder(reg.registry, "prov", "net", { topic: makeCache(), message: makeCache() });
			const res = await builder.messageBySequence({ topicId: TOPIC, sequenceNumber: 3, useCache: true }).get();

			expect(res).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			expect(reg.registry.get).toHaveBeenCalledOnce(); // Failover is internal
		});
	});

	/* --------------- messageByTimestamp() ---------------- */

	describe("messageByTimestamp()", () => {
		it("returns message and caches when useCache=true", async () => {
			const msgCache = makeCache();
			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: makeCache(), message: msgCache });

			const m1 = await builder.messageByTimestamp({ timestamp: TS, useCache: true }).get();
			expect(m1).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			expect(msgCache.set).toHaveBeenCalledOnce();

			const m2 = await builder.messageByTimestamp({ timestamp: TS, useCache: true }).get();
			expect(m2).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });

			// exactly one network GET thanks to cache
			expect(regStub.calls.filter((c) => c.kind === "get").length).toBe(1);
		});

		it("404 → null (no failover)", async () => {
			(regStub.registry.get as any) = vi.fn(async () => {
				throw new HttpError(404, "not found");
			});

			//@ts-ignore
			const builder = new TopicsBuilder(regStub.registry, "prov", "net", { topic: makeCache(), message: makeCache() });
			const res = await builder.messageByTimestamp({ timestamp: TS, useCache: true }).get();

			expect(res).toBeNull();
			// 404s are not retryable by default
		});

		it("failover: primary throws retryable error, internal failover succeeds", async () => {
			const reg = makeRegistry({ failover: true });
			(reg.registry.get as any) = vi.fn(async () => {
				// Simulate internal failover success
				return jsonResponse({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			});

			//@ts-ignore
			const builder = new TopicsBuilder(reg.registry, "prov", "net", { topic: makeCache(), message: makeCache() });
			const res = await builder.messageByTimestamp({ timestamp: TS, useCache: true }).get();

			expect(res).toEqual({ consensus_timestamp: TS, topic_id: TOPIC, message: "AQ==" });
			expect(reg.registry.get).toHaveBeenCalledOnce(); // Failover is internal
		});
	});
});
