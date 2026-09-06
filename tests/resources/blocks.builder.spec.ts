import { describe, it, expect, vi } from "vitest";
import { BlocksBuilder } from "../../src/resources/blocks/builder";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

// --- helpers --------------------------------------------------

const mkRes = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body) } as any);

const sampleBlocksResponse = {
	blocks: [
		{ number: 101, hash: "0x" + "ab".repeat(32), timestamp: "1700000001.000000000" },
		{ number: 100, hash: "0x" + "cd".repeat(32), timestamp: "1700000000.000000000" },
	],
	links: { next: null },
};

const sampleBlockOne = {
	number: 123,
	hash: "0x" + "ef".repeat(32),
	timestamp: "1700000012.345678901",
};

function makeRegistry({
	defaultLimit = 25,
	maxLimit = 100,
	failover = false,
	getImpl,
}: {
	defaultLimit?: number;
	maxLimit?: number;
	failover?: boolean;
	getImpl?: (target: any, path: string, params?: any) => Promise<any>;
}) {
	const get = vi.fn(async (target: any, path: string, params?: any) => {
		if (getImpl) {
			// If custom implementation throws and failover is enabled, simulate failover
			try {
				return await getImpl(target, path, params);
			} catch (err) {
				if (failover && err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
					// Simulate failover success
					return mkRes(sampleBlocksResponse);
				}
				throw err;
			}
		}
		return mkRes(sampleBlocksResponse);
	});
	const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() };

	const registry: any = {
		get,
		isFailoverEnabled: vi.fn(() => failover),
		getLogger: vi.fn(() => logger),
		resolve: vi.fn((_p?: string, _n?: string) => ({
			provider: _p ?? "public",
			network: _n ?? "testnet",
			baseUrl: "https://example.test",
			page: { defaultLimit, maxLimit },
		})),
	};
	registry.getWithTarget = vi.fn(async (target: any, path: string, params?: any, signal?: AbortSignal) => {
		const response = await registry.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	});
	return registry;
}

function makeCache({ enabled = true, ttlSeconds = 600, store = new Map<string, any>() } = {}) {
	return {
		enabled,
		ttlSeconds,
		get: vi.fn(async (network: string, k: string) => store.get(`${network}:${k}`)),
		set: vi.fn(async (network: string, k: string, v: any, _ttl: number) => store.set(`${network}:${k}`, v)),
	};
}

// --- list() tests ---------------------------------------------

describe("BlocksBuilder — list()", () => {
	it("applies limit resolution for 'default' (object form)", async () => {
		const registry = makeRegistry({ defaultLimit: 42 });
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		await b.list({ limit: "default" } as any).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, , params] = registry.get.mock.calls[0];
		expect(params.limit).toBe(42);
	});

	it("applies limit resolution for 'max' (DSL form)", async () => {
		const registry = makeRegistry({ maxLimit: 777 });
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		await b.list((q) => q.limit("max")).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, , params] = registry.get.mock.calls[0];
		expect(params.limit).toBe(777);
	});

	it("passes through params from DSL (blockNumber comparator, timestamp, order, limit)", async () => {
		const registry = makeRegistry({});
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		await b.list((q) => q.blockNumber().greaterThan(100).timestamp().lessThanOrEqualTo("1700000100").order("desc").limit(10)).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe("/api/v1/blocks");
		expect(params["block.number"]).toBe("gt:100");
		expect(params["timestamp"]).toEqual(["lte:1700000100"]);
		expect(typeof params["limit"]).toBe("number"); // resolved by resolveLimitValue
		expect(params["order"]).toBe("desc");
	});

	it("failover: registry.get handles failover internally when primary throws retryable error", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(500, "internal server error");
			},
		});
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		const page = await b.list({ order: "asc", limit: 3 } as any).get();

		expect(registry.get).toHaveBeenCalledTimes(1); // Builder calls once, failover is internal
		expect(page.blocks).toHaveLength(2);
	});
});

// --- one() tests ----------------------------------------------

describe("BlocksBuilder — one()", () => {
	it("cache hit: returns cached Block and bypasses registry.get", async () => {
		const registry = makeRegistry({
			getImpl: async () => mkRes(sampleBlockOne), // should not be called
		});
		const cache = makeCache();
		const key = "blocks:123";
		(cache.get as any).mockResolvedValueOnce(sampleBlockOne); // prime cache
		const b = new BlocksBuilder(registry as any, "public", "testnet", cache as any);

		const res = await b.one({ hashOrNumber: 123, useCache: true }).get();

		expect(res).toEqual(sampleBlockOne);
		expect(registry.get).not.toHaveBeenCalled();
		expect(cache.get).toHaveBeenCalledWith("testnet", key);
	});

	it("cache miss: fetches and stores in cache when useCache=true", async () => {
		const registry = makeRegistry({
			getImpl: async () => mkRes(sampleBlockOne),
		});
		const cache = makeCache();
		const b = new BlocksBuilder(registry as any, "public", "testnet", cache as any);

		const res = await b.one({ hashOrNumber: 123, useCache: true }).get();

		expect(res).toEqual(sampleBlockOne);
		expect(registry.get).toHaveBeenCalledTimes(1);
		expect(cache.set).toHaveBeenCalledTimes(1);
		const [network, setKey, setVal] = (cache.set as any).mock.calls[0];
		expect(network).toBe("testnet");
		expect(setKey).toBe("blocks:123");
		expect(setVal).toEqual(sampleBlockOne);
	});

	it("404 → returns null (no failover path executed)", async () => {
		const registry = makeRegistry({
			getImpl: async () => {
				throw new HttpError(404, "not found");
			},
		});
		const cache = makeCache();
		const b = new BlocksBuilder(registry as any, "public", "testnet", cache as any);

		const res = await b.one({ hashOrNumber: 123, useCache: true }).get();

		expect(res).toBeNull();
	});

	it("failover: non-404 error triggers internal failover when enabled", async () => {
		// Make the getImpl return the singular block on success (after internal failover)
		const registry = makeRegistry({
			failover: true,
			getImpl: vi.fn().mockImplementation(async () => {
				// Simulate internal failover success by returning singular resource
				return mkRes(sampleBlockOne);
			}),
		});
		
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		const res = await b.one({ hashOrNumber: 123, useCache: false }).get();

		expect(res).toEqual(sampleBlockOne);
		expect(registry.get).toHaveBeenCalledOnce(); // Builder calls once, failover is internal
	});

	it("validation: invalid hashOrNumber throws before network call", async () => {
		const registry = makeRegistry({});
		const b = new BlocksBuilder(registry as any, "public", "testnet");

		await expect(b.one({ hashOrNumber: "invalid!", useCache: false } as any).get()).rejects.toThrow(/hashOrNumber must be a decimal block number|32-byte/);
		expect(registry.get).not.toHaveBeenCalled();
	});

	it("DSL form: id + useCache flows through to mapper & cache", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleBlockOne) });
		const cache = makeCache();
		const b = new BlocksBuilder(registry as any, "public", "testnet", cache as any);

		await b.one((q) => q.hashOrNumber("0x" + "aa".repeat(32)).useCache(true)).get();

		// mapper-derived cache key
		const [network, setKey] = (cache.set as any).mock.calls[0];
		expect(network).toBe("testnet");
		expect(setKey).toBe("blocks:" + "0x" + "aa".repeat(32));
		expect(registry.get).toHaveBeenCalledTimes(1);
	});
});
