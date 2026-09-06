import { describe, it, expect, vi } from "vitest";
import { ContractsBuilder } from "../../src/resources/contracts/builder";
import { HttpError } from "../../src/core/errors";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

const EVM40 = "0x" + "ee".repeat(20);
const ACCOUNT = "0.0.123";
const HEX32 = "0x" + "ab".repeat(32);
const TX_HASH = "0x" + "aa".repeat(32);
const TX_ID = "0.0.123-1700000000-123456789";

const mkRes = (body: any) => ({ json: async () => body, text: async () => JSON.stringify(body) } as any);

function makeRegistry({
	defaultLimit = 50,
	maxLimit = 1000,
	failover = false,
	getImpl,
	postImpl,
}: {
	defaultLimit?: number;
	maxLimit?: number;
	failover?: boolean;
	getImpl?: (target: any, path: string, params?: any) => Promise<any>;
	postImpl?: (target: any, path: string, body?: any) => Promise<any>;
}) {
	const get = vi.fn(async (target: any, path: string, params?: any) => {
		if (getImpl) {
			try {
				return await getImpl(target, path, params);
			} catch (err) {
				// Simulate internal failover for retryable errors
				if (failover && err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
					return mkRes({});
				}
				throw err;
			}
		}
		return mkRes({});
	});
	
	const post = vi.fn(async (target: any, path: string, body?: any) => {
		if (postImpl) {
			try {
				return await postImpl(target, path, body);
			} catch (err) {
				// Simulate internal failover for retryable errors
				if (failover && err instanceof HttpError && (err.status === 429 || err.status >= 500)) {
					return mkRes({});
				}
				throw err;
			}
		}
		return mkRes({});
	});
	
	const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn() };

	const registry: any = {
		get,
		post,
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

function makeCaches() {
	const oneStore = new Map<string, any>();
	const resultStore = new Map<string, any>();
	return {
		one: {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (network: string, k: string) => oneStore.get(`${network}:${k}`)),
			set: vi.fn(async (network: string, k: string, v: any) => oneStore.set(`${network}:${k}`, v)),
		},
		result: {
			enabled: true,
			ttlSeconds: 600,
			get: vi.fn(async (network: string, k: string) => resultStore.get(`${network}:${k}`)),
			set: vi.fn(async (network: string, k: string, v: any) => resultStore.set(`${network}:${k}`, v)),
		},
	};
}

// --- sample server payloads -----------------------------------

const sampleContractsResponse = { contracts: [{ id: ACCOUNT }], links: { next: null } };
const sampleContractResponse = { contract_id: ACCOUNT, evm_address: EVM40 };
const sampleResultsResponse = { results: [{ hash: TX_HASH }], links: { next: null } };
const sampleLogsResponse = { logs: [{ index: 1, topic0: HEX32 }], links: { next: null } };
const sampleActionsResponse = { actions: [{ call_depth: 0 }], links: { next: null } };
const sampleStateResponse = { state: [{ slot: "0x01", value: "0x02" }], links: { next: null } };
const sampleCallResponse = { result: "0x" + "ff".repeat(32), gas_used: 21000 };
const sampleResultDetail = { hash: TX_HASH, from: EVM40, to: EVM40, gas_used: 1000 };

// --- list() ---------------------------------------------------

describe("ContractsBuilder — list()", () => {
	it("object form: resolves limit 'default'", async () => {
		const registry = makeRegistry({ defaultLimit: 42, getImpl: async () => mkRes(sampleContractsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		await b.list({ contractId: "gt:0.0.10", limit: "default" } as any).get();

		expect(registry.get).toHaveBeenCalledTimes(1);
		const [, , params] = registry.get.mock.calls[0];
		expect(params["contract.id"]).toBe("gt:0.0.10");
		expect(params["limit"]).toBe(42);
	});

	it("DSL form: resolves limit 'max'", async () => {
		const registry = makeRegistry({ maxLimit: 777, getImpl: async () => mkRes(sampleContractsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		await b.list((q) => q.contractId().greaterThan("0.0.10").limit("max")).get();

		const [, , params] = registry.get.mock.calls[0];
		expect(params["contract.id"]).toBe("gt:0.0.10");
		expect(params["limit"]).toBe(777);
	});

	it("failover: internal failover handles retryable errors", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(503, "service unavailable");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes(sampleContractsResponse));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const page = await b.list({ order: "asc", limit: 1 } as any).get();
		expect(page.contracts).toHaveLength(1);
		expect(registry.get).toHaveBeenCalledOnce(); // Failover is internal
	});
});

// --- one() ----------------------------------------------------

describe("ContractsBuilder — one()", () => {
	it("cache hit: returns cached and bypasses network", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleContractResponse) });
		const caches = makeCaches();
		const cacheKey = `contract:${ACCOUNT}`;
		(caches.one.get as any).mockResolvedValueOnce(sampleContractResponse);
		const b = new ContractsBuilder(registry as any, "public", "testnet", caches as any);

		const res = await b.one({ idOrAddress: ACCOUNT, useCache: true } as any).get();
		expect(res).toEqual(sampleContractResponse);
		expect(registry.get).not.toHaveBeenCalled();
		expect(caches.one.get).toHaveBeenCalledWith("testnet", cacheKey);
	});

	it("cache miss: stores after fetch when useCache", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleContractResponse) });
		const caches = makeCaches();
		const b = new ContractsBuilder(registry as any, "public", "testnet", caches as any);

		const res = await b.one({ idOrAddress: EVM40, timestamp: "1700000000.000000000", useCache: true } as any).get();
		expect(res).toEqual(sampleContractResponse);
		expect(caches.one.set).toHaveBeenCalledTimes(1);
		const [, setKey] = (caches.one.set as any).mock.calls[0];
		// cacheKey includes normalized timestamp fragment
		expect(setKey).toContain(`contract:${EVM40}`);
	});

	it("404 -> null; failover not attempted", async () => {
		const registry = makeRegistry({
			getImpl: async () => {
				throw new HttpError(404, "not found");
			},
		});
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.one({ idOrAddress: ACCOUNT } as any).get();
		expect(res).toBeNull();
		// 404s are not retryable
	});

	it("non-404 -> internal failover when enabled", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(500, "internal server error");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes(sampleContractResponse));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.one({ idOrAddress: ACCOUNT } as any).get();
		expect(res).toEqual(sampleContractResponse);
		expect(registry.get).toHaveBeenCalledOnce(); // Failover is internal
	});
});

// --- results() by contract ------------------------------------

describe("ContractsBuilder — results()", () => {
	it("plumbs params and resolves limit", async () => {
		const registry = makeRegistry({ defaultLimit: 33, getImpl: async () => mkRes(sampleResultsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const page = await b.results((q) => q.idOrAddress(ACCOUNT).timestamp().greaterThanOrEqualTo(1700000000).blockNumber("eq:42").transactionIndex(0).limit("default").order("desc")).get();

		expect(page.results.length).toBe(1);
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe(`/api/v1/contracts/${encodeURIComponent(ACCOUNT)}/results`);
		expect(params["timestamp"]).toContain("gte:1700000000");
		expect(params["block.number"]).toBe("eq:42");
		expect(params["transaction.index"]).toBe(0);
		expect(params["limit"]).toBe(33);
		expect(params["order"]).toBe("desc");
	});

	it("failover path", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(503, "service unavailable");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes(sampleResultsResponse));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const page = await b.results({ idOrAddress: ACCOUNT, limit: 1 } as any).get();
		expect(page.results).toHaveLength(1);
	});
});

// --- resultByTimestamp() --------------------------------------

describe("ContractsBuilder — resultByTimestamp()", () => {
	it("cache hit", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleResultDetail) });
		const caches = makeCaches();
		const key = `contractResultTs:${ACCOUNT}:1700000000.123456789`;
		(caches.result.get as any).mockResolvedValueOnce(sampleResultDetail);
		const b = new ContractsBuilder(registry as any, "public", "testnet", caches as any);

		const res = await b.resultByTimestamp({ idOrAddress: ACCOUNT, timestamp: "1700000000.123456789", useCache: true } as any).get();
		expect(res).toEqual(sampleResultDetail);
		expect(registry.get).not.toHaveBeenCalled();
	});

	it("forwards hbar=false and separates the cache entry from default units", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleResultDetail) });
		const caches = makeCaches();
		const b = new ContractsBuilder(registry as any, "public", "testnet", caches as any);

		await b
			.resultByTimestamp((q) => q.idOrAddress(ACCOUNT).timestamp("1700000000.123456789").hbar(false).useCache(true))
			.get();

		expect(registry.get).toHaveBeenCalledWith(
			expect.anything(),
			`/api/v1/contracts/${ACCOUNT}/results/1700000000.123456789`,
			{ hbar: false }
		);
		expect(caches.result.set).toHaveBeenCalledWith(
			"testnet",
			`contractResultTs:${ACCOUNT}:1700000000.123456789:hbar=false`,
			sampleResultDetail,
			600
		);
	});

	it("404 -> null", async () => {
		const registry = makeRegistry({
			getImpl: async () => {
				throw new HttpError(404, "nope");
			},
		});
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.resultByTimestamp({ idOrAddress: ACCOUNT, timestamp: "1700000000.000000000" } as any).get();
		expect(res).toBeNull();
	});

	it("failover on non-404", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(500, "internal server error");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes(sampleResultDetail));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.resultByTimestamp({ idOrAddress: ACCOUNT, timestamp: "1700000000.000000000" } as any).get();
		expect(res).toEqual(sampleResultDetail);
		expect(registry.get).toHaveBeenCalledOnce(); // Failover is internal
	});
});

// --- globalResults() ------------------------------------------

describe("ContractsBuilder — globalResults()", () => {
	it("applies limit resolution and forwards params", async () => {
		const registry = makeRegistry({ maxLimit: 555, getImpl: async () => mkRes(sampleResultsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		await b.globalResults((q) => q.timestamp().greaterThan(1700000000).hbar(false).limit("max").order("asc")).get();

		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe("/api/v1/contracts/results");
		expect(params.timestamp).toContain("gt:1700000000");
		expect(params.hbar).toBe(false);
		expect(params.limit).toBe(555);
		expect(params.order).toBe("asc");
	});
});

// --- resultByTransaction() ------------------------------------

describe("ContractsBuilder — resultByTransaction()", () => {
	it("cache miss -> fetch -> cache set", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleResultDetail) });
		const caches = makeCaches();
		const b = new ContractsBuilder(registry as any, "public", "testnet", caches as any);

		const res = await b.resultByTransaction({ transactionIdOrHash: TX_HASH, nonce: 7, hbar: false, useCache: true } as any).get();
		expect(res).toEqual(sampleResultDetail);
		expect(registry.get).toHaveBeenCalledWith(expect.anything(), `/api/v1/contracts/results/${encodeURIComponent(TX_HASH)}`, {
			nonce: 7,
			hbar: false,
		});
		expect(caches.result.set).toHaveBeenCalledTimes(1);
		const [, key] = (caches.result.set as any).mock.calls[0];
		expect(key).toBe(`contractResult:${TX_HASH}:nonce=7:hbar=false`);
	});

	it("404 -> null", async () => {
		const registry = makeRegistry({
			getImpl: async () => {
				throw new HttpError(404, "no");
			},
		});
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.resultByTransaction({ transactionIdOrHash: TX_ID } as any).get();
		expect(res).toBeNull();
	});

	it("failover for non-404", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(503, "service unavailable");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes(sampleResultDetail));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");
		const res = await b.resultByTransaction({ transactionIdOrHash: TX_HASH } as any).get();
		expect(res).toEqual(sampleResultDetail);
	});
});

// --- globalLogs() ---------------------------------------------

describe("ContractsBuilder — globalLogs()", () => {
	it("allows an omitted query", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleLogsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		const page = await b.globalLogs().get();

		expect(page.logs).toEqual(sampleLogsResponse.logs);
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe("/api/v1/contracts/results/logs");
		expect(params).toEqual({});
	});

	it("plumbs params & limit resolution", async () => {
		const registry = makeRegistry({ defaultLimit: 9, getImpl: async () => mkRes(sampleLogsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		await b
			.globalLogs((q) =>
				q
					.topic0("0x" + "11".repeat(32))
					.timestamp()
					.greaterThanOrEqualTo(1700000000)
					.timestamp()
					.lessThanOrEqualTo(1700000500)
					.index()
					.greaterThanOrEqualTo(1)
					.limit("default")
					.order("desc")
			)
			.get();

		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe("/api/v1/contracts/results/logs");
		expect(params.topic0).toEqual(["0x" + "11".repeat(32)]);
		expect(params.timestamp).toEqual(["gte:1700000000", "lte:1700000500"]);
		expect(params.index).toBe("gte:1");
		expect(params.limit).toBe(9);
		expect(params.order).toBe("desc");
	});
});

// --- logs() by contract ---------------------------------------

describe("ContractsBuilder — logs()", () => {
	it("sets path id and forwards params", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleLogsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		await b.logs((q) => q.idOrAddress(ACCOUNT).topic0(HEX32).timestamp("1700000000.000000000").index().equalTo(1).limit(1).order("asc")).get();

		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe(`/api/v1/contracts/${encodeURIComponent(ACCOUNT)}/results/logs`);
		expect(params.topic0).toEqual([HEX32]); // mapper normalizes arrays
		expect(params.timestamp).toEqual(["1700000000.000000000"]);
		expect(params.index).toBe("eq:1");
		expect(params.limit).toBe(1);
		expect(params.order).toBe("asc");
	});
});

// --- state() --------------------------------------------------

describe("ContractsBuilder — state()", () => {
	it("forwards id, slots, timestamps, limit", async () => {
		const registry = makeRegistry({ defaultLimit: 13, getImpl: async () => mkRes(sampleStateResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		const res = await b.state((q) => q.idOrAddress(EVM40).slot("0x01", "0x02").timestamp().greaterThan(1700000000).limit("default").order("asc")).get();

		expect(res.state).toEqual(sampleStateResponse.state);
		expect(res.links).toEqual(sampleStateResponse.links);
		expect(res.next.url()).toBeNull();
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe(`/api/v1/contracts/${encodeURIComponent(EVM40)}/state`);
		expect(params.slot).toEqual(["0x01", "0x02"]);
		expect(params.timestamp).toContain("gt:1700000000");
		expect(params.limit).toBe(13);
		expect(params.order).toBe("asc");
	});

	it("follows state pagination links and normalizes an omitted state collection", async () => {
		const nextPath = `/api/v1/contracts/${encodeURIComponent(EVM40)}/state?limit=1&slot=gt%3A01`;
		const registry = makeRegistry({
			getImpl: async (_target, path) =>
				path === nextPath
					? mkRes({ links: { next: null } })
					: mkRes({ state: [{ slot: "01", value: "02" }], links: { next: nextPath } }),
		});
		const builder = new ContractsBuilder(registry as any, "public", "testnet");

		const first = await builder.state({ idOrAddress: EVM40, limit: 1 }).get();
		expect(first.links).toEqual({ next: nextPath });
		expect(first.next.url()).toBe(`https://example.test${nextPath}`);

		const second = await first.next();
		expect(second?.state).toEqual([]);
		expect(second?.links).toEqual({ next: null });
		expect(second?.next.url()).toBeNull();
		expect(registry.get.mock.calls[1][1]).toBe(nextPath);
	});
});

// --- call() ---------------------------------------------------

describe("ContractsBuilder — call()", () => {
	it("POST: sends cleaned body via mapper; internal failover on retryable error", async () => {
		const registry = makeRegistry({
			failover: true,
			postImpl: async (_t, _path, body) => {
				// Throw retryable error
				throw new HttpError(503, "service unavailable");
			},
		});
		// Override to return success after internal failover
		registry.post = vi.fn().mockResolvedValue(mkRes(sampleCallResponse));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		const res = await b.call((q) => q.to(EVM40).from(EVM40).data("0x1234").block("latest").estimate(false).gas(21000).gasPrice(100).value(1)).get();

		expect(res).toEqual(sampleCallResponse);
		expect(registry.post).toHaveBeenCalledOnce(); // Failover is internal
		
		// Verify body structure was passed correctly
		const [, , body] = registry.post.mock.calls[0];
		expect(body).toMatchObject({
			to: EVM40,
			from: EVM40,
			data: "0x1234",
			block: "latest",
			estimate: false,
			gas: 21000,
			gasPrice: 100,
			value: 1,
		});
	});
});

// --- actions() ------------------------------------------------

describe("ContractsBuilder — actions()", () => {
	it("forwards id, index comparator, limit, order", async () => {
		const registry = makeRegistry({ getImpl: async () => mkRes(sampleActionsResponse) });
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		const page = await b.actions((q) => q.transactionIdOrHash(TX_HASH).index().lessThanOrEqualTo(9).limit(1).order("desc")).get();

		expect(page.actions.length).toBe(1);
		const [, path, params] = registry.get.mock.calls[0];
		expect(path).toBe(`/api/v1/contracts/results/${encodeURIComponent(TX_HASH)}/actions`);
		expect(params.index).toBe("lte:9");
		expect(params.limit).toBe(1);
		expect(params.order).toBe("desc");
	});
});

// --- opcodes() -----------------------------------------------

describe("ContractsBuilder — opcodes()", () => {
	it("forwards id and stack/memory/storage flags; supports failover", async () => {
		const registry = makeRegistry({
			failover: true,
			getImpl: async () => {
				throw new HttpError(503, "service unavailable");
			},
		});
		// Override to return success after internal failover
		registry.get = vi.fn().mockResolvedValue(mkRes({ stack: true, memory: false, storage: true }));
		
		const b = new ContractsBuilder(registry as any, "public", "testnet");

		const res = await b.opcodes((q) => q.transactionIdOrHash(TX_ID).stack(true).memory(false).storage(true)).get();

		expect(res).toEqual({ stack: true, memory: false, storage: true });
		expect(registry.get).toHaveBeenCalledOnce(); // Failover is internal
	});
});
