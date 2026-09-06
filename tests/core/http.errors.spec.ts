import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/core/errors";
import { HttpTransport } from "../../src/core/http";
import type { RetryPolicy } from "../../src/types";

const REQUEST_URL = "https://mirror.example/api/v1/accounts/0.0.123";

const retryImmediately: RetryPolicy = {
	enabled: true,
	maxAttempts: 3,
	initialDelayMs: 0,
	maxDelayMs: 0,
	backoff: "fixed",
	honorRetryAfter: false,
};

function createTransport(): HttpTransport {
	return new HttpTransport({ debug: () => {}, warn: () => {} });
}

async function captureHttpError(request: Promise<unknown>): Promise<HttpError> {
	try {
		await request;
	} catch (error) {
		expect(error).toBeInstanceOf(HttpError);
		return error as HttpError;
	}
	throw new Error("Expected the request to reject with HttpError");
}

function responseWithoutContentType(body: string, status = 400): Response {
	return new Response(new TextEncoder().encode(body), { status });
}

describe("HttpTransport HTTP error responses", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	describe("body decoding", () => {
		it("parses a valid JSON error body after reading the response body once", async () => {
			const response = new Response('{"status":"INVALID_ACCOUNT_ID","code":17}', {
				status: 400,
				headers: { "content-type": "application/json" },
			});
			const text = vi.spyOn(response, "text");
			const json = vi.spyOn(response, "json");
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error).toMatchObject({
				status: 400,
				url: REQUEST_URL,
				body: { status: "INVALID_ACCOUNT_ID", code: 17 },
			});
			expect(text).toHaveBeenCalledOnce();
			expect(json).not.toHaveBeenCalled();
		});

		it("preserves a text/plain error body verbatim", async () => {
			const response = new Response("invalid account identifier", {
				status: 400,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error.body).toBe("invalid account identifier");
			expect(error.status).toBe(400);
		});

		it("preserves an HTML error body when Content-Type is absent", async () => {
			const html = "<!doctype html><title>Bad gateway</title>";
			const response = responseWithoutContentType(html, 502);
			expect(response.headers.has("content-type")).toBe(false);
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error.body).toBe(html);
			expect(error.status).toBe(502);
		});

		it("preserves malformed application/json as raw text", async () => {
			const malformed = '{"status":"BROKEN"';
			const response = new Response(malformed, {
				status: 400,
				headers: { "content-type": "application/json" },
			});
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error.body).toBe(malformed);
		});

		it("preserves a whitespace-only response verbatim", async () => {
			const whitespace = " \t\r\n";
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWithoutContentType(whitespace)));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error.body).toBe(whitespace);
		});

		it("uses undefined for an empty streamed response", async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			});
			const response = new Response(stream, { status: 400 });
			expect(response.body).not.toBeNull();
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

			const error = await captureHttpError(createTransport().request(REQUEST_URL, { method: "GET" }));

			expect(error.body).toBeUndefined();
		});

		it("keeps the HttpError when reading the response body rejects", async () => {
			const response = new Response("unreadable", { status: 400 });
			const text = vi.spyOn(response, "text").mockRejectedValue(new Error("stream read failed"));
			const fetchMock = vi.fn().mockResolvedValue(response);
			vi.stubGlobal("fetch", fetchMock);

			const error = await captureHttpError(
				createTransport().request(REQUEST_URL, { method: "GET" }, { ...retryImmediately, onNetworkError: true })
			);

			expect(error).toMatchObject({ status: 400, url: REQUEST_URL, body: undefined });
			expect(text).toHaveBeenCalledOnce();
			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});

	describe("retry classification", () => {
		it.each([
			[400, {}],
			[404, { on404: false }],
			[503, { on5xx: false }],
		] as const)("does not turn a text HTTP %i response into a network retry", async (status, override) => {
			const fetchMock = vi.fn().mockResolvedValue(new Response(`HTTP ${status}`, { status }));
			vi.stubGlobal("fetch", fetchMock);

			const error = await captureHttpError(
				createTransport().request(REQUEST_URL, { method: "GET" }, { ...retryImmediately, ...override, onNetworkError: true })
			);

			expect(error).toMatchObject({ status, url: REQUEST_URL, body: `HTTP ${status}` });
			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it("returns the final text HttpError after retryable 503 responses are exhausted", async () => {
			let attempt = 0;
			const fetchMock = vi.fn().mockImplementation(async () => {
				attempt++;
				return new Response(`service unavailable ${attempt}`, { status: 503 });
			});
			vi.stubGlobal("fetch", fetchMock);

			const error = await captureHttpError(
				createTransport().request(REQUEST_URL, { method: "GET" }, { ...retryImmediately, on5xx: true })
			);

			expect(error).toMatchObject({
				status: 503,
				url: REQUEST_URL,
				body: "service unavailable 3",
			});
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});

		it("returns the final text HttpError after on404 retries are exhausted", async () => {
			let attempt = 0;
			const fetchMock = vi.fn().mockImplementation(async () => {
				attempt++;
				return new Response(`not found ${attempt}`, { status: 404 });
			});
			vi.stubGlobal("fetch", fetchMock);

			const error = await captureHttpError(
				createTransport().request(REQUEST_URL, { method: "GET" }, { ...retryImmediately, on404: true })
			);

			expect(error).toMatchObject({ status: 404, url: REQUEST_URL, body: "not found 3" });
			expect(fetchMock).toHaveBeenCalledTimes(3);
		});

		it("does not retry an AbortError as a network failure", async () => {
			const controller = new AbortController();
			controller.abort();
			const abortError = new DOMException("The operation was aborted", "AbortError");
			const fetchMock = vi.fn().mockRejectedValue(abortError);
			vi.stubGlobal("fetch", fetchMock);

			let thrown: unknown;
			try {
				await createTransport().request(
					REQUEST_URL,
					{ method: "GET", signal: controller.signal },
					{ ...retryImmediately, onNetworkError: true }
				);
			} catch (error) {
				thrown = error;
			}

			expect(thrown).toBe(abortError);
			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it("stops an HTTP-status retry while waiting in backoff", async () => {
			const controller = new AbortController();
			const abortReason = new DOMException("The operation was aborted", "AbortError");
			const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
			vi.stubGlobal("fetch", fetchMock);

			const request = createTransport().request(
				REQUEST_URL,
				{ method: "GET", signal: controller.signal },
				{
					enabled: true,
					maxAttempts: 3,
					initialDelayMs: 60_000,
					maxDelayMs: 60_000,
					backoff: "fixed",
					honorRetryAfter: false,
					on5xx: true,
				}
			);
			const rejection = expect(request).rejects.toBe(abortReason);

			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			expect(fetchMock).toHaveBeenCalledOnce();
			controller.abort(abortReason);

			await rejection;
			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it("stops a network-error retry while waiting in backoff", async () => {
			const controller = new AbortController();
			const abortReason = new DOMException("The operation was aborted", "AbortError");
			const fetchMock = vi.fn().mockRejectedValue(new TypeError("connection reset"));
			vi.stubGlobal("fetch", fetchMock);

			const request = createTransport().request(
				REQUEST_URL,
				{ method: "GET", signal: controller.signal },
				{
					enabled: true,
					maxAttempts: 3,
					initialDelayMs: 60_000,
					maxDelayMs: 60_000,
					backoff: "fixed",
					honorRetryAfter: false,
					onNetworkError: true,
				}
			);
			const rejection = expect(request).rejects.toBe(abortReason);

			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			expect(fetchMock).toHaveBeenCalledOnce();
			controller.abort(abortReason);

			await rejection;
			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});
});
