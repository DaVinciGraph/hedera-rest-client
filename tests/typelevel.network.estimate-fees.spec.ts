import { describe, expect, expectTypeOf, it } from "vitest";

import { NetworkFeeEstimateRequestBuilder } from "../src/dsl/network";
import type {
	FeeEstimate,
	FeeEstimateMode,
	FeeEstimateModeInput,
	FeeEstimateResponse,
	FeeExtra,
	Int64,
	NetworkFeeEstimateRequest,
	KnownProtobufContentType,
	ProtobufContentType,
	ProtobufTransactionBytes,
} from "../src";

describe("network fee-estimation public type surface", () => {
	it("accepts Uint8Array, ArrayBuffer, and Node Buffer byte containers", () => {
		const transactionBytes: Uint8Array = new Uint8Array([1]);
		const browserBuffer: ArrayBuffer = new ArrayBuffer(1);
		const nodeBuffer: Buffer = Buffer.from([1]);

		const requests: NetworkFeeEstimateRequest[] = [
			{ transaction: transactionBytes },
			{ transaction: browserBuffer, mode: "INTRINSIC" },
			{ transaction: nodeBuffer, mode: "STATE", contentType: "application/x-protobuf" },
		];

		expectTypeOf<NetworkFeeEstimateRequest["transaction"]>().toEqualTypeOf<ProtobufTransactionBytes>();
		expect(requests).toHaveLength(3);
	});

	it("constrains mode, content type, and the required transaction body", () => {
		const mode: FeeEstimateMode = "STATE";
		const inputMode: FeeEstimateModeInput = "InTrInSiC";
		const contentType: ProtobufContentType = "Application/Protobuf";

		// @ts-expect-error `transaction` is the required protobuf request body.
		const missingTransaction: NetworkFeeEstimateRequest = { mode: "STATE" };
		// @ts-expect-error Only the two OpenAPI fee-estimation modes are valid.
		const invalidMode: FeeEstimateMode = "FAST";
		// Canonical values remain available as a strict type for callers that want compile-time narrowing.
		// @ts-expect-error JSON is not a known protobuf media type.
		const invalidContentType: KnownProtobufContentType = "application/json";
		// @ts-expect-error Multi-byte typed arrays are not protobuf byte inputs.
		const invalidBytes: ProtobufTransactionBytes = new Uint16Array([1]);

		expect([mode, inputMode, contentType, missingTransaction, invalidMode, invalidContentType, invalidBytes]).toHaveLength(7);
	});

	it("builds the request type and models every required response component", () => {
		const request = new NetworkFeeEstimateRequestBuilder()
			.transaction(new Uint8Array([1]))
			.mode("STATE")
			.highVolumeThrottle(10_000)
			.contentType("application/x-protobuf")
			.build();

		expectTypeOf(request).toEqualTypeOf<NetworkFeeEstimateRequest>();
		expectTypeOf<FeeExtra["fee_per_unit"]>().toEqualTypeOf<Int64>();
		expectTypeOf<FeeEstimate["extras"]>().toEqualTypeOf<FeeExtra[]>();
		expectTypeOf<FeeEstimateResponse["high_volume_multiplier"]>().toEqualTypeOf<Int64>();
		expectTypeOf<FeeEstimateResponse["total"]>().toEqualTypeOf<Int64>();
		expect(request.mode).toBe("STATE");
	});
});
