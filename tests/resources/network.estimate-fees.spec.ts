import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { ValidationError } from "../../src/core/errors";
import { NetworkFeeEstimateRequestBuilder } from "../../src/dsl/network";
import { NetworkBuilder } from "../../src/resources/network/builder";
import { NetworkMapper } from "../../src/resources/network/mapper";
import type { FeeEstimateResponse, NetworkFeeEstimateRequest } from "../../src/types";

const feeEstimate: FeeEstimateResponse = {
	high_volume_multiplier: 1,
	network: { multiplier: 2, subtotal: 20 },
	node: { base: 10, extras: [] },
	service: {
		base: 30,
		extras: [{ charged: 1, count: 2, fee_per_unit: 5, included: 1, name: "Signatures", subtotal: 5 }],
	},
	total: 60,
};

// One deterministic, unsigned protobuf proto.Transaction (not a TransactionList).
const validTransactionBytes = () =>
	Buffer.from(
		"KlAKTAoVCggI0oXYzAQQARIHCAAQABjpBxgAEgYIABAAGAMYgMLXLyICCHgyAHIgCh4KDQoHCAAQABjpBxABGAAKDQoHCAAQABjqBxACGAASAA==",
		"base64"
	);

function makeRegistry() {
	const target = {
		provider: "public",
		network: "testnet",
		baseUrl: "https://testnet.mirrornode.hedera.com",
		headers: {},
		http: {},
		page: { defaultLimit: 25, maxLimit: 100 },
	};
	const post = vi.fn().mockResolvedValue({ json: async () => feeEstimate, text: async () => JSON.stringify(feeEstimate) });
	return {
		registry: {
			resolve: vi.fn().mockReturnValue(target),
			post,
			getLogger: vi.fn().mockReturnValue({ debug: vi.fn() }),
		} as any,
		target,
		post,
	};
}

describe("POST /api/v1/network/fees", () => {
	it("maps an object request to protobuf body, query parameters, and the default media type", async () => {
		const { registry, target, post } = makeRegistry();
		const transaction = validTransactionBytes();
		const request: NetworkFeeEstimateRequest = {
			transaction,
			mode: "STATE",
			highVolumeThrottle: 10_000,
		};

		const result = await new NetworkBuilder(registry, "public", "testnet").estimateFees(request).get();

		expect(result).toEqual(feeEstimate);
		expect(post).toHaveBeenCalledWith(target, "/api/v1/network/fees", expect.any(Uint8Array), {
			query: { mode: "STATE", high_volume_throttle: 10_000 },
			headers: { "content-type": "application/protobuf" },
		});
		const sent = post.mock.calls[0][2] as Uint8Array;
		expect(sent).not.toBe(transaction);
		expect(sent).toEqual(new Uint8Array(transaction.buffer, transaction.byteOffset, transaction.byteLength));
	});

	it("supports the DSL and application/x-protobuf with an owned byte snapshot", async () => {
		const { registry, post } = makeRegistry();
		const transaction = new Uint8Array([9, 8, 7]).buffer;

		await new NetworkBuilder(registry)
			.estimateFees((q) => q.transaction(transaction).mode("INTRINSIC").highVolumeThrottle(0).contentType("application/x-protobuf"))
			.get();

		expect(post.mock.calls[0][2]).not.toBe(transaction);
		expect(post.mock.calls[0][2]).toEqual(new Uint8Array([9, 8, 7]));
		expect(post.mock.calls[0][3]).toEqual({
			query: { mode: "INTRINSIC", high_volume_throttle: 0 },
			headers: { "content-type": "application/x-protobuf" },
		});
	});

	it.each([
		["object", (transaction: Uint8Array) => ({ transaction })],
		["DSL", (transaction: Uint8Array) => (q: NetworkFeeEstimateRequestBuilder) => q.transaction(transaction)],
	] as const)("snapshots the exact %s request byte range before dispatch", async (_style, makeQuery) => {
		const { registry, post } = makeRegistry();
		const backing = new Uint8Array([99, 1, 2, 3, 88]);
		const transaction = backing.subarray(1, 4);

		const pending = new NetworkBuilder(registry).estimateFees(makeQuery(transaction) as any).get();
		backing.fill(7);
		await pending;

		const sent = post.mock.calls[0][2] as Uint8Array;
		expect(sent).toEqual(new Uint8Array([1, 2, 3]));
		expect(sent).not.toBe(transaction);
		expect(sent.buffer).not.toBe(backing.buffer);
	});

	it("keeps omitted optional parameters absent and accepts an empty protobuf buffer", () => {
		const transaction = new Uint8Array(0);

		expect(NetworkMapper.estimateFees({ transaction })).toEqual({
			body: transaction,
			params: {},
			contentType: "application/protobuf",
		});
	});

	it("accepts genuine protobuf byte containers created in another realm", () => {
		const foreign = runInNewContext("({ bytes: new Uint8Array([1]), buffer: new Uint8Array([2]).buffer })");
		expect(() => NetworkMapper.estimateFees({ transaction: foreign.bytes })).not.toThrow();
		expect(() => NetworkMapper.estimateFees({ transaction: foreign.buffer })).not.toThrow();
	});

	it("has object/DSL mapping parity", () => {
		const transaction = new Uint8Array([1, 2, 3]);
		const objectResult = NetworkMapper.estimateFees({
			transaction,
			mode: "STATE",
			highVolumeThrottle: 500,
			contentType: "application/x-protobuf",
		});
		const dslRequest = new NetworkFeeEstimateRequestBuilder()
			.transaction(transaction)
			.mode("STATE")
			.highVolumeThrottle(500)
			.contentType("application/x-protobuf")
			.build();

		expect(NetworkMapper.estimateFees(dslRequest)).toEqual(objectResult);
	});

	it.each([0, 10_000])("accepts highVolumeThrottle boundary %s", (highVolumeThrottle) => {
		expect(NetworkMapper.estimateFees({ transaction: new Uint8Array([1]), highVolumeThrottle }).params).toEqual({
			high_volume_throttle: highVolumeThrottle,
		});
	});

	it.each([-1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid highVolumeThrottle %s", (highVolumeThrottle) => {
		expect(() => NetworkMapper.estimateFees({ transaction: new Uint8Array([1]), highVolumeThrottle })).toThrow(ValidationError);
		expect(() => new NetworkFeeEstimateRequestBuilder().transaction(new Uint8Array([1])).highVolumeThrottle(highVolumeThrottle)).toThrow(ValidationError);
	});

	it("rejects missing or non-byte transaction bodies", () => {
		expect(() => NetworkMapper.estimateFees(undefined as any)).toThrow(/transaction protobuf bytes are required/);
		expect(() => NetworkMapper.estimateFees({ transaction: "not protobuf" } as any)).toThrow(ValidationError);
		expect(() => new NetworkFeeEstimateRequestBuilder().build()).toThrow(/transaction protobuf bytes are required/);
		expect(() => new NetworkFeeEstimateRequestBuilder().transaction(new Uint16Array([1]) as any)).toThrow(ValidationError);
		const spoofedBytes = { [Symbol.toStringTag]: "Uint8Array" };
		expect(() => NetworkMapper.estimateFees({ transaction: spoofedBytes } as any)).toThrow(ValidationError);
	});

	it("rejects invalid mode and content type at runtime for untyped JavaScript callers", () => {
		const transaction = new Uint8Array([1]);
		expect(() => NetworkMapper.estimateFees({ transaction, mode: "FAST" } as any)).toThrow(ValidationError);
		expect(() => NetworkMapper.estimateFees({ transaction, contentType: "application/json" } as any)).toThrow(ValidationError);
		expect(() => new NetworkFeeEstimateRequestBuilder().mode("FAST" as any)).toThrow(ValidationError);
		expect(() => new NetworkFeeEstimateRequestBuilder().contentType("application/json" as any)).toThrow(ValidationError);
	});

	it.each([
		[{ timeOutMs: 10 }, /Unknown request option: timeOutMs/],
		[{ timeoutMs: 0 }, /timeoutMs must be a positive safe integer/],
		[{ signal: {} }, /signal must be an AbortSignal/],
	] as const)("strictly validates POST request options %#", async (options, message) => {
		const { registry, post } = makeRegistry();
		const operation = new NetworkBuilder(registry).estimateFees({ transaction: validTransactionBytes() });

		await expect(operation.get(options as any)).rejects.toThrow(message);
		expect(post).not.toHaveBeenCalled();
	});
});
