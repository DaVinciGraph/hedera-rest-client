import { afterEach, describe, it, expect, vi } from "vitest";
import { ContractsBuilder } from "../../src/resources/contracts/builder";
import { HttpError } from "../../src/core/errors";
import { HederaRestClient } from "../../src/HederaRestClient";

// Minimal Response shim used by our fake registry
class MinimalResponse {
	constructor(private payload: any) {}
	async json() {
		return this.payload;
	}
	async text() {
		return JSON.stringify(this.payload);
	}
}

// A lightweight fake ProviderRegistry implementing just what the builder needs.
class FakeRegistry {
	private failoverEnabled: boolean;

	public lastPost?: {
		target: any;
		path: string;
		body: any;
		signal?: AbortSignal;
	};
	public lastPostWithFailover?: {
		provider: string;
		network: string;
		path: string;
		body: any;
		signal?: AbortSignal;
	};

	// knobs for test control
	public postShouldThrow = false;
	public postError: any = new Error("primary post failed");
	public postReturnPayload: any = { ok: true, where: "primary" };

	public postWithFailoverReturnPayload: any = { ok: true, where: "failover" };

	constructor(opts?: { enableFailover?: boolean }) {
		this.failoverEnabled = !!opts?.enableFailover;
	}

	resolve(provider?: string, network?: string) {
		return {
			provider: provider ?? "prov",
			network: network ?? "testnet",
			baseUrl: "https://example.mirror.node",
			page: { defaultLimit: 25, maxLimit: 100 },
		};
	}

	isFailoverEnabled() {
		return this.failoverEnabled;
	}

	getLogger() {
		return { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
	}

	// Not used here, but included to satisfy the interface surface if something changes.
	async get(): Promise<any> {
		throw new Error("Unexpected GET in these tests");
	}
	async getWithFailover(): Promise<any> {
		throw new Error("Unexpected GET failover in these tests");
	}

	async post(target: any, path: string, body: any, signal?: AbortSignal) {
		this.lastPost = { target, path, body, signal };
		if (this.postShouldThrow) {
			// Simulate internal failover for retryable errors
			if (this.failoverEnabled && this.postError instanceof HttpError && (this.postError.status === 429 || this.postError.status >= 500)) {
				return new MinimalResponse(this.postReturnPayload);
			}
			throw this.postError;
		}
		return new MinimalResponse(this.postReturnPayload);
	}
}

describe("ContractsBuilder — POST /contracts/call", () => {
	it("wires the POST body (unwrapped) and returns JSON", async () => {
		const reg = new FakeRegistry({ enableFailover: false });

		const builder = new ContractsBuilder(reg as any, "provX", "testnet");

		// Valid call body per mapper requirements
		const rawBody = {
			to: "0x1111111111111111111111111111111111111111",
			from: "0x2222222222222222222222222222222222222222",
			data: "0xdeadbeef", // even-length hex
			block: "latest", // valid with estimate=true
			estimate: true,
			gas: 100000,
			gasPrice: 2,
			value: 3,
		} as const;

		reg.postReturnPayload = { status: "OK", out: "0xabc" };

		const res = await builder.call(rawBody).get();

		// Primary POST path and body are correct
		expect(reg.lastPost).toBeDefined();
		expect(reg.lastPost!.path).toBe("/api/v1/contracts/call");
		// Primary body is the sanitized payload (no extra wrapper)
		expect(reg.lastPost!.body).toEqual({
			to: rawBody.to,
			from: rawBody.from,
			data: rawBody.data,
			block: rawBody.block,
			estimate: rawBody.estimate,
			gas: rawBody.gas,
			gasPrice: rawBody.gasPrice,
			value: rawBody.value,
		});

		// Returns registry JSON
		expect(res).toEqual({ status: "OK", out: "0xabc" });
	});

	it("failover: primary post throws retryable error, internal failover succeeds", async () => {
		const reg = new FakeRegistry({ enableFailover: true });

		const builder = new ContractsBuilder(reg as any, "provA", "testnet");

		const rawBody = {
			to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			data: "0x00", // minimal valid even-length hex
			block: "latest",
			estimate: true,
			gas: 750000,
			gasPrice: 5,
			value: 42,
		} as const;

		reg.postShouldThrow = true; // make primary fail with retryable error
		reg.postError = new HttpError(503, "service unavailable");
		reg.postReturnPayload = { status: "OK", out: "0xbeef" };

		const res = await builder.call(rawBody).get();

		// Primary attempted with direct body
		expect(reg.lastPost).toBeDefined();
		expect(reg.lastPost!.path).toBe("/api/v1/contracts/call");
		expect(reg.lastPost!.body).toEqual({
			to: rawBody.to,
			from: rawBody.from,
			data: rawBody.data,
			block: rawBody.block,
			estimate: rawBody.estimate,
			gas: rawBody.gas,
			gasPrice: rawBody.gasPrice,
			value: rawBody.value,
		});

		// Failover is internal to registry.post(), so we get the success result
		expect(res).toEqual({ status: "OK", out: "0xbeef" });
	});

	it("no failover: primary post throws and error is propagated", async () => {
		const reg = new FakeRegistry({ enableFailover: false });

		const builder = new ContractsBuilder(reg as any, "provB", "testnet");

		const rawBody = {
			to: "0xcccccccccccccccccccccccccccccccccccccccc",
			from: "0xdddddddddddddddddddddddddddddddddddddddd",
			data: "0x1234",
			block: "latest",
			estimate: true,
			gas: 123,
			gasPrice: 7,
			value: 0,
		} as const;

		reg.postShouldThrow = true;
		reg.postError = new Error("boom");

		await expect(builder.call(rawBody).get()).rejects.toThrow("boom");

		// Primary attempted, error propagated
		expect(reg.lastPost).toBeDefined();
	});

	it.each([
		[{ timeOutMs: 10 }, /Unknown request option: timeOutMs/],
		[{ timeoutMs: 0 }, /timeoutMs must be a positive safe integer/],
		[{ signal: {} }, /signal must be an AbortSignal/],
	] as const)("strictly validates POST request options %#", async (options, message) => {
		const reg = new FakeRegistry();
		const operation = new ContractsBuilder(reg as any).call({
			to: "0x1111111111111111111111111111111111111111",
			data: "0x00",
		});

		await expect(operation.get(options as any)).rejects.toThrow(message);
		expect(reg.lastPost).toBeUndefined();
	});
});

describe("ContractsBuilder contract-call wire body", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends unsafe int64 inputs as exact numeric tokens and preserves the body across provider failover", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('{"_status":{"messages":[]}}', { status: 503, headers: { "content-type": "application/json" } }))
			.mockResolvedValueOnce(new Response('{"result":"0x00"}', { status: 200, headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new HederaRestClient({
			defaultProvider: "first",
			defaultNetwork: "testnet",
			switchProviderOnFailure: true,
			provider: {
				first: { testnet: { url: "https://first.example" } },
				second: { testnet: { url: "https://second.example" } },
			},
		});
		const maxInt64 = "9223372036854775807";

		await client
			.contracts()
			.call({
				to: "0x1111111111111111111111111111111111111111",
				data: "0x1234",
				gas: maxInt64,
				gasPrice: maxInt64,
				value: maxInt64,
			})
			.get();

		const expected =
			'{"to":"0x1111111111111111111111111111111111111111","data":"0x1234","gas":9223372036854775807,"gasPrice":9223372036854775807,"value":9223372036854775807}';
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][0]).toBe("https://first.example/api/v1/contracts/call");
		expect(fetchMock.mock.calls[1][0]).toBe("https://second.example/api/v1/contracts/call");
		expect(fetchMock.mock.calls[0][1].body).toBe(expected);
		expect(fetchMock.mock.calls[1][1].body).toBe(expected);
	});
});
