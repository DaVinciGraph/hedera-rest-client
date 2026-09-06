// src/core/http.ts

import { ConfigError, HttpError, HttpNetworkError } from "./errors";
import { parseJsonText } from "./json";
import { computeBackoff, sleep } from "./utils";
import type { RetryPolicy } from "../types";
import { stringify as stringifyLosslessJson } from "lossless-json";

/**
 * Options for a single HTTP request.
 *
 * @remarks
 * - `method` defaults to `"GET"`.
 * - `headers` are passed through to `fetch` unchanged.
 * - `body` is sent as‑is **unless** it is a plain object (and **not** an `ArrayBuffer`);
 *   in that case it will be JSON‑stringified for convenience.
 * - `signal` can be used to cancel the request via `AbortController`.
 * - `timeoutMs` bounds each physical fetch attempt, including body consumption.
 *
 * @example
 * ```ts
 * const ac = new AbortController();
 * setTimeout(() => ac.abort(), 10_000); // cancel after 10s
 *
 * const res = await http.request(
 *   "https://example.com/api",
 *   { method: "POST", headers: { "content-type": "application/json" }, body: { hello: "world" }, signal: ac.signal }
 * );
 * ```
 *
 * @note
 * If you need to send **non‑JSON** bodies (e.g. `FormData`, `Blob`, streams),
 * pass a value that is **not** a plain object (e.g. a `string`, `Blob`, `FormData`,
 * `Uint8Array`, or `ArrayBuffer`). Plain objects are automatically JSON‑stringified.
 */
export interface HttpRequestOptions {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	headers?: Record<string, string>;
	body?: any;
	signal?: AbortSignal;
	/** Maximum time for each physical fetch attempt, including body consumption. */
	timeoutMs?: number;
}

/**
 * Internal dispatch hook used to schedule each physical fetch attempt.
 *
 * Keeping this hook at the attempt boundary ensures a rate limiter charges
 * retries individually instead of treating an entire retry sequence as one
 * request. Direct {@link HttpTransport} consumers can omit it.
 */
export type HttpAttemptDispatcher = <T>(attempt: () => Promise<T>, attemptIndex: number) => Promise<T>;

const dispatchImmediately: HttpAttemptDispatcher = (attempt) => attempt();

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 20;
/** Largest delay supported without overflow by browser and Node.js timers. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Internal policy failure. It is exposed to callers as an HttpNetworkError. */
class RedirectPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RedirectPolicyError";
	}
}

/** Internal timeout reason retained as the cause of the final HttpNetworkError. */
class RequestTimeoutError extends Error {
	constructor(readonly timeoutMs: number, readonly url: string) {
		super(`Request timed out after ${timeoutMs} ms for ${url}`);
		this.name = "TimeoutError";
	}
}

interface AttemptSignal {
	signal?: AbortSignal;
	didTimeout: () => boolean;
	timeoutReason: () => RequestTimeoutError | undefined;
	cleanup: () => void;
}

interface AttemptSuccess {
	ok: true;
	response: Response;
}

interface AttemptFailure {
	ok: false;
	error: unknown;
	timedOut: boolean;
	/** Last physical URL whose fetch or response processing produced the failure. */
	url: string;
}

type AttemptOutcome = AttemptSuccess | AttemptFailure;

interface PhysicalResponseOutcome {
	kind: "response";
	response: Response;
}

interface PhysicalRedirectOutcome {
	kind: "redirect";
	status: number;
	location: string;
}

interface PhysicalFailureOutcome {
	kind: "failure";
	error: unknown;
	timedOut: boolean;
}

type PhysicalOutcome = PhysicalResponseOutcome | PhysicalRedirectOutcome | PhysicalFailureOutcome;

/**
 * Return whether a request body should be serialized as JSON.
 *
 * Fetch already understands binary buffers/views and platform body types such
 * as `Blob`, `FormData`, `URLSearchParams`, and streams. Only plain objects and
 * arrays are convenience-serialized here; treating every object as JSON would
 * corrupt protobuf bytes (including Node.js `Buffer`, which is a Uint8Array).
 */
function isJsonBody(body: unknown): boolean {
	if (Array.isArray(body)) return true;
	if (body === null || typeof body !== "object") return false;
	const prototype = Object.getPrototypeOf(body);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Default retry settings used by {@link HttpTransport} for omitted fields.
 *
 * @description
 * - Retries are disabled by default, so an unconfigured request makes one attempt.
 * - When enabled, the defaults allow up to **3 attempts** total and use
 *   **full-jitter exponential backoff** from 250 ms to 4000 ms.
 * - Enabled retries cover:
 *   - HTTP **429** (Too Many Requests),
 *   - HTTP **5xx** responses,
 *   - **Network errors** (e.g., DNS, connection reset).
 * - **Honors** `Retry-After` delay-seconds and HTTP-date values when present on 429/5xx.
 *
 * Adjust these values by passing a custom {@link RetryPolicy} to `request()`.
 */
const DEFAULT_RETRY: Required<RetryPolicy> = {
	enabled: false,
	maxAttempts: 3,
	initialDelayMs: 250,
	maxDelayMs: 4000,
	backoff: "full-jitter",
	on404: false,
	on429: true,
	on5xx: true,
	onNetworkError: true,
	honorRetryAfter: true,
};

function normalizeRetry(user?: RetryPolicy): Required<RetryPolicy> {
	const base = { ...DEFAULT_RETRY, ...(user || {}) } as Required<RetryPolicy>;
	if (!base.enabled) {
		// force single attempt when disabled
		return {
			...base,
			maxAttempts: 1,
			on404: false,
			on429: false,
			on5xx: false,
			onNetworkError: false,
			honorRetryAfter: false,
		};
	}
	if (!Number.isSafeInteger(base.maxAttempts) || base.maxAttempts < 1) {
		throw new ConfigError("retry.maxAttempts must be a finite integer greater than or equal to 1");
	}
	for (const [name, delay] of [
		["initialDelayMs", base.initialDelayMs],
		["maxDelayMs", base.maxDelayMs],
	] as const) {
		if (!Number.isSafeInteger(delay) || delay < 0 || delay > MAX_TIMER_DELAY_MS) {
			throw new ConfigError(`retry.${name} must be a safe integer between 0 and ${MAX_TIMER_DELAY_MS}`);
		}
	}
	return base;
}

const IMF_FIXDATE_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i;
const RFC850_DATE_RE = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/i;
const ASCTIME_DATE_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/i;

/** Parse an RFC delay-seconds or HTTP-date value within the host timer range. */
function retryAfterDelayMs(value: string | null): number | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		const milliseconds = Number(trimmed) * 1_000;
		return Math.min(Number.isFinite(milliseconds) ? milliseconds : MAX_TIMER_DELAY_MS, MAX_TIMER_DELAY_MS);
	}
	// Date.parse is deliberately preceded by an HTTP-date shape check because
	// JavaScript also accepts non-HTTP inputs such as "1.5" as calendar dates.
	const isAsctimeDate = ASCTIME_DATE_RE.test(trimmed);
	if (!IMF_FIXDATE_RE.test(trimmed) && !RFC850_DATE_RE.test(trimmed) && !isAsctimeDate) return undefined;
	// HTTP defines the zone-less obsolete asctime form as GMT; Date.parse uses
	// the host's local zone unless it is supplied explicitly.
	const retryAt = Date.parse(isAsctimeDate ? `${trimmed} GMT` : trimmed);
	if (!Number.isFinite(retryAt)) return undefined;
	return Math.min(Math.max(0, retryAt - Date.now()), MAX_TIMER_DELAY_MS);
}

/**
 * Read a terminal HTTP error body exactly once.
 *
 * Fetch response bodies are one-shot streams. Reading as text first lets us
 * attempt JSON decoding locally without needing to clone or consume the
 * response a second time. Error bodies are intentionally parsed with native
 * JSON semantics to match `Response.json()`.
 */
async function readHttpErrorBody(response: Pick<Response, "text">): Promise<unknown> {
	let text: string;
	try {
		text = await response.text();
	} catch {
		return undefined;
	}

	if (typeof text !== "string" || text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Release an intermediate retry response body without masking its status. */
async function discardResponseBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Best-effort cleanup only. Retry classification is based on HTTP status.
	}
}

/** Combine the caller's signal with an independently observable attempt timeout. */
function createAttemptSignal(callerSignal: AbortSignal | undefined, timeoutMs: number | undefined, url: string): AttemptSignal {
	if (timeoutMs === undefined) {
		return {
			signal: callerSignal,
			didTimeout: () => false,
			timeoutReason: () => undefined,
			cleanup: () => {},
		};
	}

	const controller = new AbortController();
	let timedOut = false;
	let reason: RequestTimeoutError | undefined;
	const onCallerAbort = () => controller.abort(abortReason(callerSignal!));

	if (callerSignal?.aborted) onCallerAbort();
	else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

	const timer = setTimeout(() => {
		// Preserve the first cancellation cause. A later timeout must not turn an
		// explicit caller abort into a retryable provider failure.
		if (controller.signal.aborted) return;
		timedOut = true;
		reason = new RequestTimeoutError(timeoutMs, url);
		controller.abort(reason);
	}, timeoutMs);

	return {
		signal: controller.signal,
		didTimeout: () => timedOut,
		timeoutReason: () => reason,
		cleanup: () => {
			clearTimeout(timer);
			callerSignal?.removeEventListener("abort", onCallerAbort);
		},
	};
}

/**
 * Restore fetch-populated observations after a manually followed redirect.
 *
 * Native Response objects are normally extensible, but an implementation or
 * test double may forbid instance properties. Metadata decoration must never
 * turn an otherwise successful request into a failure; ProviderRegistry also
 * retains its independently resolved request URL as a fallback.
 */
function decorateResponse(response: Response, effectiveUrl: string, redirected: boolean): Response {
	try {
		Object.defineProperty(response, "url", { configurable: true, value: effectiveUrl });
	} catch {
		// Best effort only. A native manual-fetch response already exposes its URL.
	}
	try {
		Object.defineProperty(response, "redirected", { configurable: true, value: redirected });
	} catch {
		// Best effort only; identity compatibility takes precedence over metadata.
	}
	return response;
}

/** Validate a successful Mirror Node payload without converting its values. */
function validateSuccessfulJson(bytes: ArrayBuffer): void {
	// The actual result is intentionally discarded. Resource builders perform
	// their lossless parse later from the original response.
	parseJsonText(new TextDecoder().decode(bytes));
}

function redirectMethod(status: number, method: NonNullable<HttpRequestOptions["method"]>): NonNullable<HttpRequestOptions["method"]> {
	if (status === 303 || ((status === 301 || status === 302) && method === "POST")) return "GET";
	return method;
}

function headersWithoutBodyHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!headers) return undefined;
	const next = Object.create(null) as Record<string, string>;
	for (const [key, value] of Object.entries(headers)) {
		const normalized = key.toLowerCase();
		if (
			normalized === "content-encoding" ||
			normalized === "content-language" ||
			normalized === "content-length" ||
			normalized === "content-location" ||
			normalized === "content-type" ||
			normalized === "transfer-encoding"
		)
			continue;
		next[key] = value;
	}
	return next;
}

/** Aborted requests must never be retried as ordinary network failures. */
function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
	return signal?.aborted === true || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
	if (signal.reason !== undefined) return signal.reason;
	const error = new Error("The operation was aborted");
	error.name = "AbortError";
	return error;
}

/** Wait between attempts while allowing cancellation to stop the retry promptly. */
async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (!signal) {
		await sleep(delayMs);
		return;
	}
	if (signal.aborted) throw abortReason(signal);

	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(abortReason(signal));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);

		signal.addEventListener("abort", onAbort, { once: true });
		// Close the race between the initial check and listener registration.
		if (signal.aborted) onAbort();
	});
}

/**
 * Minimal HTTP client wrapper around `fetch` with robust retry semantics.
 *
 * @remarks
 * The transport integrates:
 * - Safe, limiter-aware same-origin redirects; cross-origin redirects are refused.
 * - Complete response buffering and JSON validation inside each scheduled attempt.
 * - Automatic retries for transient errors (configurable via {@link RetryPolicy}).
 * - Full‑jitter or fixed backoff between retries.
 * - Respect for `Retry-After` (delay-seconds or HTTP-date) when enabled.
 * - Throwing a typed {@link HttpError} for non‑OK HTTP responses after retries.
 *
 * This class is intentionally small and opinionated; it focuses on reliability
 * and debuggability rather than feature breadth.
 *
 * @example
 * ```ts
 * const http = new HttpTransport(console);
 *
 * const res = await http.request("https://api.example.com/items", {
 *   method: "GET",
 *   headers: { accept: "application/json" }
 * }, {
 *   enabled: true,
 *   maxAttempts: 5,
 *   backoff: "full-jitter",
 *   on429: true,
 *   on5xx: true,
 *   onNetworkError: true,
 *   honorRetryAfter: true,
 *   initialDelayMs: 500,
 *   maxDelayMs: 3000
 * });
 *
 * const data = await res.json();
 * ```
 */
export class HttpTransport {
	/**
	 * @param logger - A minimal logger with `debug` and `warn` methods.
	 *                 Any object implementing those methods is acceptable.
	 */
	constructor(private logger: { debug: (...a: any[]) => void; warn: (...a: any[]) => void }) {}

	/**
	 * Compute the wait time before the next retry attempt.
	 *
	 * @param attempt - Zero‑based attempt index (0 = first retry).
	 * @param policy  - The effective retry policy for this call.
	 * @returns Milliseconds to wait before the next attempt.
	 *
	 * @remarks
	 * - `"fixed"` returns a constant `initialDelayMs`.
	 * - `"full-jitter"` returns a random delay between `0` and
	 *   `min(maxDelayMs, initialDelayMs * 2^attempt)`.
	 */
	private computeDelay(policy: Required<RetryPolicy>, attempt: number): number {
		if (policy.backoff === "fixed") {
			// Fixed delay: always return initialDelayMs (capped by maxDelayMs)
			return Math.min(policy.initialDelayMs, policy.maxDelayMs);
		}
		// Default: full-jitter exponential backoff
		return computeBackoff(attempt, policy.initialDelayMs, policy.maxDelayMs);
	}

	/**
	 * Perform an HTTP request with robust retry behavior.
	 *
	 * @param url   - Fully qualified URL.
	 * @param opts  - Request options (method, headers, body, abort signal, timeout).
	 * @param retry - Optional retry policy. Omitted values fall back to
	 *                {@link DEFAULT_RETRY}. See {@link RetryPolicy}.
	 * @param dispatchAttempt - Optional internal scheduler invoked once for
	 *                          every physical fetch attempt.
	 *
	 * @returns A `Response` whose `ok` status is guaranteed to be `true` and
	 *          whose body is fully buffered but unread (otherwise an error is thrown).
	 *
	 * @throws {@link HttpError} When the server responds with a non‑OK status
	 *         after retries have been exhausted (the error includes `status`,
	 *         `url`, and a parsed `body` when possible).
	 * @throws {@link HttpNetworkError} For network failures after all retry
	 *         attempts are exhausted, including body-stream failures, timeouts,
	 *         malformed success JSON, and refused redirects. The underlying
	 *         failure is available as `cause`.
	 *
	 * @example
	 * ```ts
	 * // Simple GET with defaults
	 * const res = await http.request("https://example.com/health", { method: "GET" });
	 * console.log("healthy?", res.ok);
	 *
	 * // POST JSON body (auto‑stringified)
	 * await http.request("https://example.com/items", {
	 *   method: "POST",
	 *   headers: { "content-type": "application/json" },
	 *   body: { name: "demo" }
	 * });
	 *
	 * // Custom retry policy with fixed backoff
	 * await http.request("https://example.com/flaky", { method: "GET" }, {
	 *   enabled: true,
	 *   maxAttempts: 5,
	 *   backoff: "fixed",
	 *   initialDelayMs: 1000,
	 *   maxDelayMs: 1000,
	 *   on429: true,
	 *   on5xx: true,
	 *   onNetworkError: true,
	 *   honorRetryAfter: true
	 * });
	 * ```
	 *
	 * @note
	 * - `maxAttempts` counts the **total** tries (initial + retries).
	 * - When `honorRetryAfter` is enabled and the response contains a valid
	 *   `Retry-After` delay-seconds or HTTP-date value, the server-requested
	 *   delay is used before the next attempt.
	 * - If the response body is JSON, the thrown {@link HttpError} will contain
	 *   the parsed object; otherwise it will contain the raw `text`.
	 */
	async request(
		url: string,
		opts: HttpRequestOptions,
		retry?: RetryPolicy,
		dispatchAttempt: HttpAttemptDispatcher = dispatchImmediately
	): Promise<Response> {
		const policy = normalizeRetry(retry);
		if (
			opts.timeoutMs !== undefined &&
			(!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 1 || opts.timeoutMs > MAX_TIMER_DELAY_MS)
		) {
			throw new ConfigError(`timeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`);
		}

		// Serialize once so exact JSON numbers (represented by lossless-json's
		// LosslessNumber) are emitted as numeric tokens and every retry replays the
		// byte-identical request body. Ordinary strings retain normal JSON quoting.
		const requestBody = isJsonBody(opts.body) ? stringifyLosslessJson(opts.body) : opts.body;
		const initialMethod = opts.method || "GET";
		const initialOrigin = new URL(url).origin;
		let attempt = 0;
		let physicalAttempt = 0;
		let lastNetworkError: unknown;
		let lastNetworkUrl = url;

		const performAttempt = async (): Promise<AttemptOutcome> => {
			let currentUrl = url;
			let currentMethod = initialMethod;
			let currentBody = requestBody;
			let currentHeaders = opts.headers;
			let redirectCount = 0;
			const visited = new Set([currentUrl]);

			while (true) {
				const attemptUrl = currentUrl;
				const attemptMethod = currentMethod;
				const attemptBody = currentBody;
				const attemptHeaders = currentHeaders;
				const dispatchIndex = physicalAttempt++;

				// Dispatcher errors (notably overflow-capacity decisions) intentionally
				// escape this function. Only work performed inside the dispatched fetch is
				// classified as a network/stream/protocol failure.
				const outcome = await dispatchAttempt(async (): Promise<PhysicalOutcome> => {
					const attemptSignal = createAttemptSignal(opts.signal, opts.timeoutMs, attemptUrl);
					try {
						const response = await fetch(attemptUrl, {
							method: attemptMethod,
							headers: attemptHeaders,
							body: attemptMethod === "GET" ? undefined : attemptBody,
							signal: attemptSignal.signal,
							redirect: "manual",
						});
						if (response.type === "opaqueredirect") {
							await discardResponseBody(response);
							if (opts.signal?.aborted) throw abortReason(opts.signal);
							if (attemptSignal.didTimeout()) throw attemptSignal.timeoutReason();
							throw new RedirectPolicyError(`Refused an opaque redirect while requesting ${attemptUrl}`);
						}

						const location = response.headers.get("location");
						if (REDIRECT_STATUSES.has(response.status) && location !== null) {
							// A redirect response is complete once its unused body has been cancelled.
							// The destination is deliberately fetched as a separate dispatched job.
							await discardResponseBody(response);
							if (opts.signal?.aborted) throw abortReason(opts.signal);
							if (attemptSignal.didTimeout()) throw attemptSignal.timeoutReason();
							return { kind: "redirect", status: response.status, location };
						}

						let bytes: ArrayBuffer;
						try {
							// Drain and validate a tee branch while the limiter slot is held. The
							// exact native Response returned by fetch remains unread for callers.
							bytes = await response.clone().arrayBuffer();
						} catch (error) {
							await discardResponseBody(response);
							if (opts.signal?.aborted) throw abortReason(opts.signal);
							if (attemptSignal.didTimeout()) throw attemptSignal.timeoutReason();
							// Once an HTTP status is known, preserve it even if its diagnostic error
							// body cannot be read. Successful-body failures are network failures.
							if (!response.ok) {
								return {
									kind: "response",
									response: decorateResponse(response, attemptUrl, redirectCount > 0),
								};
							}
							throw error;
						}

						if (opts.signal?.aborted) {
							await discardResponseBody(response);
							throw abortReason(opts.signal);
						}
						if (attemptSignal.didTimeout()) {
							await discardResponseBody(response);
							throw attemptSignal.timeoutReason();
						}
						if (response.ok) {
							try {
								validateSuccessfulJson(bytes);
							} catch (error) {
								await discardResponseBody(response);
								throw error;
							}
						}
						if (attemptSignal.didTimeout()) {
							await discardResponseBody(response);
							throw attemptSignal.timeoutReason();
						}
						return {
							kind: "response",
							response: decorateResponse(response, attemptUrl, redirectCount > 0),
						};
					} catch (error) {
						const timedOut = attemptSignal.didTimeout();
						return {
							kind: "failure",
							error: timedOut ? attemptSignal.timeoutReason() || error : error,
							timedOut,
						};
					} finally {
						attemptSignal.cleanup();
					}
				}, dispatchIndex);

				if (outcome.kind === "failure") {
					return { ok: false, error: outcome.error, timedOut: outcome.timedOut, url: attemptUrl };
				}
				if (outcome.kind === "response") return { ok: true, response: outcome.response };

				let destination: URL;
				try {
					destination = new URL(outcome.location, currentUrl);
				} catch (error) {
					return {
						ok: false,
						timedOut: false,
						url: currentUrl,
						error: new RedirectPolicyError(
							`Refused invalid redirect location '${outcome.location}' from ${currentUrl}: ${error instanceof Error ? error.message : String(error)}`
						),
					};
				}

				if ((destination.protocol !== "http:" && destination.protocol !== "https:") || destination.origin !== initialOrigin) {
					return {
						ok: false,
						timedOut: false,
						url: currentUrl,
						error: new RedirectPolicyError(`Refused cross-origin redirect from ${currentUrl} to ${destination.href}`),
					};
				}
				if (visited.has(destination.href)) {
					return {
						ok: false,
						timedOut: false,
						url: currentUrl,
						error: new RedirectPolicyError(`Redirect loop detected while requesting ${url}`),
					};
				}
				if (redirectCount >= MAX_REDIRECT_HOPS) {
					return {
						ok: false,
						timedOut: false,
						url: currentUrl,
						error: new RedirectPolicyError(`Too many redirects while requesting ${url} (maximum ${MAX_REDIRECT_HOPS})`),
					};
				}

				visited.add(destination.href);
				redirectCount++;
				const nextMethod = redirectMethod(outcome.status, currentMethod);
				if (nextMethod === "GET" && currentMethod !== "GET") {
					currentBody = undefined;
					currentHeaders = headersWithoutBodyHeaders(currentHeaders);
				}
				currentMethod = nextMethod;
				currentUrl = destination.href;
			}
		};

		while (attempt < policy.maxAttempts) {
			this.logger.debug("HTTP", { url, attempt: attempt + 1 });
			const outcome = await performAttempt();

			if (!outcome.ok) {
				const error = outcome.error;
				lastNetworkError = error;
				lastNetworkUrl = outcome.url;
				if (!outcome.timedOut && isAbortFailure(error, opts.signal)) throw error;

				// Fetch, successful-body stream, timeout, malformed JSON, and redirect
				// policy failures are provider-level network/protocol failures.
				if (!policy.enabled || !policy.onNetworkError || attempt >= policy.maxAttempts - 1) {
					break;
				}
				const delay = this.computeDelay(policy, attempt);
				this.logger.warn("Network error, retrying", error instanceof Error ? error.message : error, "delay", delay);
				await waitForRetry(delay, opts.signal);
				attempt++;
				continue;
			}

			const res = outcome.response;

			if (res.ok) return res;

			const retryable = policy.enabled && ((res.status === 404 && policy.on404) || (res.status === 429 && policy.on429) || (res.status >= 500 && policy.on5xx));

			if (retryable && attempt < policy.maxAttempts - 1) {
				const retryAfterDelay = policy.honorRetryAfter ? retryAfterDelayMs(res.headers.get("retry-after")) : undefined;
				const delay = retryAfterDelay ?? this.computeDelay(policy, attempt);
				await discardResponseBody(res);
				this.logger.warn("HTTP retryable", { status: res.status, delay });
				await waitForRetry(delay, opts.signal);
				attempt++;
				continue;
			}

			const body = await readHttpErrorBody(res);
			throw new HttpError(res.status, res.url || url, undefined, body);
		}

		throw new HttpNetworkError(lastNetworkUrl, physicalAttempt, lastNetworkError);
	}
}
