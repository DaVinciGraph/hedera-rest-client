import { describe, it, expect } from "vitest";

import { ContractsMapper } from "../src/resources/contracts/mapper";
import { ContractsBuilder } from "../src/resources/contracts/builder";
import { TransactionsBuilder } from "../src/resources/transactions/builder";
import { ValidationError } from "../src/core/errors";

// Minimal Response shim
class MinimalResponse {
	constructor(private payload: any) {}
	async json() {
		return this.payload;
	}
	async text() {
		return JSON.stringify(this.payload);
	}
}

// Registry that lets us capture GET paths for encoding tests
class CaptureRegistry {
	public lastGet?: { target: any; path: string; params?: any; signal?: AbortSignal };

	resolve(provider?: string, network?: string) {
		return {
			provider: provider ?? "prov",
			network: network ?? "testnet",
			baseUrl: "https://example.mirror.node",
			page: { defaultLimit: 25, maxLimit: 100 },
		};
	}

	isFailoverEnabled() {
		return false;
	}

	getLogger() {
		return { debug: () => {}, warn: () => {}, error: () => {} };
	}

	async get(target: any, path: string, params?: any, signal?: AbortSignal) {
		this.lastGet = { target, path, params, signal };
		return new MinimalResponse({ ok: true });
	}

	async getWithFailover(): Promise<any> {
		throw new Error("Unexpected getWithFailover in this test");
	}
	async post(): Promise<any> {
		return new MinimalResponse({ ok: true });
	}
	async postWithFailover(): Promise<any> {
		return new MinimalResponse({ ok: true });
	}
}

describe("Immutability — ContractsMapper.callQuery()", () => {
	it("does not mutate the input object while coercing numeric fields in the cleaned body", () => {
		// Use `any`-typed input so we can supply string numerics without TS errors;
		// we still verify runtime coercion + immutability of the *input* object.
		const input: any = {
			to: "0x" + "11".repeat(20),
			from: "0x" + "22".repeat(20),
			data: "0xdeadbeef",
			block: "latest",
			estimate: true,
			gas: "100000", // string form
			gasPrice: "2", // string form
			value: "3", // string form
		};

		const snapshot = JSON.parse(JSON.stringify(input));
		const cleaned = ContractsMapper.callQuery(input);

		// Input object is not mutated
		expect(input).toEqual(snapshot);
		expect(typeof input.gas).toBe("string");
		expect(typeof input.gasPrice).toBe("string");
		expect(typeof input.value).toBe("string");

		// Cleaned body has coerced numerics
		expect(cleaned).toEqual({
			to: input.to,
			from: input.from,
			data: input.data,
			block: input.block,
			estimate: true,
			gas: 100000,
			gasPrice: 2,
			value: 3,
		});
	});
});

describe("Immutability — ContractsMapper.one()", () => {
	it("normalizes cacheKey by sorting timestamps but does not mutate the original timestamps array", () => {
		const ts = ["lt:1800.2", "gt:1700.1", "eq:1750.3"];
		const q = { idOrAddress: "0.0.1005", timestamp: ts.slice() };

		const { params, cacheKey } = ContractsMapper.one(q as any);

		// input array remains unchanged (order preserved)
		expect(q.timestamp).toEqual(ts);

		// params.timestamp preserves input order and stringifies
		expect(params.timestamp).toEqual(ts.map(String));

		// cacheKey uses a sorted, order-agnostic fragment
		const expectedTsKey = ts.slice().map(String).sort().join("&");
		expect(cacheKey).toBe(`contract:0.0.1005:ts=${expectedTsKey}`);
	});
});

describe("Immutability — ContractsMapper.logsList()", () => {
	it("rejects repeated transaction hashes without mutating the input array", () => {
		const h1 = "0x" + "ab".repeat(32);
		const h2 = "0x" + "cd".repeat(32);
		const hashes = [`eq:${h1}`, h2];
		const q = { transactionHash: hashes } as any;

		expect(() => ContractsMapper.logsList(q)).toThrow(ValidationError);

		expect(q.transactionHash).toEqual(hashes);
	});
});

describe("Encoding — URL path segments are properly formed in builders", () => {
	// NOTE: Validators require hyphenated TransactionId form: 0.0.x-<seconds>-<nanos>.
	// We still verify the exact path produced by encodeURIComponent (hyphens don't change).
	it("ContractsBuilder.resultByTransaction uses a valid hyphenated TransactionId in the path", async () => {
		const reg = new CaptureRegistry();
		const builder = new ContractsBuilder(reg as any, "provX", "testnet");

		const txId = "0.0.5005-1700-1"; // valid TransactionIdStr
		await builder.resultByTransaction({ transactionIdOrHash: txId }).get();

		expect(reg.lastGet).toBeDefined();
		expect(reg.lastGet!.path).toBe("/api/v1/contracts/results/0.0.5005-1700-1");
	});

	it("TransactionsBuilder.byId uses a valid hyphenated TransactionId in the path", async () => {
		const reg = new CaptureRegistry();
		const txBuilder = new TransactionsBuilder(reg as any, "provY", "testnet");

		const txId = "0.0.7-1700-1";
		await txBuilder.byId({ transactionId: txId }).get();

		expect(reg.lastGet).toBeDefined();
		expect(reg.lastGet!.path).toBe("/api/v1/transactions/0.0.7-1700-1");
	});

	it("ContractsBuilder.resultByTimestamp encodes path segments (id + exact timestamp)", async () => {
		const reg = new CaptureRegistry();
		const builder = new ContractsBuilder(reg as any, "provZ", "testnet");

		await builder.resultByTimestamp({ idOrAddress: "0.0.4004", timestamp: "1700.000001" }).get();

		expect(reg.lastGet).toBeDefined();
		expect(reg.lastGet!.path).toBe("/api/v1/contracts/0.0.4004/results/1700.000001");
	});
});
