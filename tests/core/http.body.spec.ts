import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../../src/core/http";
import { HttpError } from "../../src/core/errors";
import { Logger } from "../../src/core/logger";
import { LosslessNumber } from "lossless-json";

describe("HttpTransport request bodies", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		["Uint8Array", new Uint8Array([0x0a, 0x02, 0x08, 0x01])],
		["ArrayBuffer", new Uint8Array([1, 2, 3]).buffer],
		["Node.js Buffer", Buffer.from([4, 5, 6])],
	])("passes a %s body to fetch byte-identically", async (_label, body) => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const transport = new HttpTransport(new Logger({ enabled: false }));

		await transport.request("https://mirror.example/api/v1/network/fees", {
			method: "POST",
			headers: { "content-type": "application/protobuf" },
			body,
		});

		expect(fetchMock.mock.calls[0][1].body).toBe(body);
	});

	it("continues to serialize plain objects and arrays as JSON", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const transport = new HttpTransport(new Logger({ enabled: false }));

		await transport.request("https://mirror.example/object", { method: "POST", body: { answer: 42 } });
		await transport.request("https://mirror.example/array", { method: "POST", body: [1, 2, 3] });

		expect(fetchMock.mock.calls[0][1].body).toBe('{"answer":42}');
		expect(fetchMock.mock.calls[1][1].body).toBe("[1,2,3]");
	});

	it("emits lossless integers as numeric JSON tokens and replays the exact body on retry", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503, headers: { "content-type": "application/json" } }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const transport = new HttpTransport(new Logger({ enabled: false }));
		const maxInt64 = "9223372036854775807";

		await transport.request(
			"https://mirror.example/api/v1/contracts/call",
			{
				method: "POST",
				body: {
					to: "0x1111111111111111111111111111111111111111",
					data: "0x1234",
					gas: new LosslessNumber(maxInt64),
					memo: maxInt64,
				},
			},
			{
				enabled: true,
				maxAttempts: 2,
				initialDelayMs: 0,
				maxDelayMs: 0,
				backoff: "fixed",
				on5xx: true,
			}
		);

		const expected =
			'{"to":"0x1111111111111111111111111111111111111111","data":"0x1234","gas":9223372036854775807,"memo":"9223372036854775807"}';
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1].body).toBe(expected);
		expect(fetchMock.mock.calls[1][1].body).toBe(expected);
	});

	it("leaves native Fetch body types untouched", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const transport = new HttpTransport(new Logger({ enabled: false }));
		const form = new FormData();
		form.set("field", "value");
		const params = new URLSearchParams({ field: "value" });

		await transport.request("https://mirror.example/form", { method: "POST", body: form });
		await transport.request("https://mirror.example/params", { method: "POST", body: params });

		expect(fetchMock.mock.calls[0][1].body).toBe(form);
		expect(fetchMock.mock.calls[1][1].body).toBe(params);
	});

	it("reuses the same protobuf bytes across HTTP retries", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503, headers: { "content-type": "application/json" } }))
			.mockResolvedValueOnce(new Response("{}", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const transport = new HttpTransport(new Logger({ enabled: false }));
		const transaction = new Uint8Array([7, 8, 9]);

		await transport.request(
			"https://mirror.example/api/v1/network/fees",
			{ method: "POST", headers: { "content-type": "application/protobuf" }, body: transaction },
			{
				enabled: true,
				maxAttempts: 2,
				initialDelayMs: 0,
				maxDelayMs: 0,
				backoff: "fixed",
				on5xx: true,
			}
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1].body).toBe(transaction);
		expect(fetchMock.mock.calls[1][1].body).toBe(transaction);
	});

	it("reads HTTP error bodies once and preserves native JSON parsing semantics", async () => {
		const response = new Response('{"unsafe":9223372036854775807}', {
			status: 400,
			headers: { "content-type": "application/json" },
		});
		const json = vi.spyOn(response, "json");
		const text = vi.spyOn(response, "text");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		const transport = new HttpTransport(new Logger({ enabled: false }));

		let thrown: unknown;
		try {
			await transport.request("https://mirror.example/error", { method: "GET" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(HttpError);
		expect((thrown as HttpError).body).toEqual({ unsafe: 9223372036854776000 });
		expect(json).not.toHaveBeenCalled();
		expect(text).toHaveBeenCalledOnce();
	});
});
