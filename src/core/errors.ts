// src/core/errors.ts

/**
 * Strongly-typed error representing an HTTP response that was not successful.
 *
 * @remarks
 * This error is thrown by the transport layer when a request completes with a
 * non-OK status (e.g., 400–499, 500–599) **after** any configured retries
 * have been attempted. It carries the HTTP `status`, the request `url`, and
 *—when available—an already-parsed `body` so callers can surface detailed
 * server messages.
 *
 * The `body` may be:
 * - an object (when the response was valid JSON),
 * - a string (when the response was plain text),
 * - or `undefined` (if the response could not be read).
 *
 * Use `instanceof HttpError` in `catch` blocks to branch error handling by type.
 *
 * @example
 * ```ts
 * try {
 *   const res = await http.request("https://api.example.com/items/42", { method: "GET" });
 *   const data = await res.json();
 *   // ...
 * } catch (e) {
 *   if (e instanceof HttpError) {
 *     // Inspect status, url, and body for more context
 *     console.error("HTTP failed", e.status, "for", e.url);
 *     if (typeof e.body === "string") {
 *       console.error("Server said:", e.body);
 *     } else if (e.body && typeof e.body === "object") {
 *       console.error("Server JSON:", JSON.stringify(e.body));
 *     }
 *   } else {
 *     // Network/other errors
 *     console.error("Request failed:", e);
 *   }
 * }
 * ```
 *
 * @public
 */
export class HttpError extends Error {
	/**
	 * Numeric HTTP status code (e.g., `404`, `500`).
	 */
	status: number;

	/**
	 * The URL that was requested when the error occurred.
	 */
	url: string;

	/**
	 * Parsed response body when available.
	 *
	 * @remarks
	 * - May be an `object` (JSON), a `string` (text), or `undefined`.
	 * - Treat as opaque; shape is server-dependent.
	 */
	body?: unknown;

	/**
	 * Create a new {@link HttpError}.
	 *
	 * @param status - HTTP status code.
	 * @param url - Request URL.
	 * @param message - Optional custom message (defaults to `"HTTP <status> for <url>"`).
	 * @param body - Optional parsed response body (JSON or text) for diagnostics.
	 */
	constructor(status: number, url: string, message?: string, body?: unknown) {
		super(message || `HTTP ${status} for ${url}`);
		this.name = "HttpError";
		this.status = status;
		this.url = url;
		this.body = body;
	}
}

/**
 * A network-level failure raised after all configured attempts for one
 * provider have been exhausted.
 *
 * Unlike {@link HttpError}, this represents a request that did not receive an
 * HTTP response (for example DNS resolution, connection, or TLS failure). The
 * original fetch rejection is retained as {@link Error.cause}.
 *
 * @public
 */
export class HttpNetworkError extends Error {
	/** URL whose fetch attempts failed. */
	readonly url: string;

	/** Number of physical fetch attempts made for this provider. */
	readonly attempts: number;

	declare readonly cause: unknown;

	constructor(url: string, attempts: number, cause: unknown) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`Network request failed after ${attempts} attempt${attempts === 1 ? "" : "s"} for ${url}: ${detail}`, { cause });
		this.name = "HttpNetworkError";
		this.url = url;
		this.attempts = attempts;
	}
}

/**
 * Configuration error emitted when the client or provider registry
 * encounters an invalid or unsupported setup.
 *
 * @remarks
 * Typical causes include:
 * - Missing or unknown provider/network identifiers.
 * - Unsupported combinations of options in a configuration object.
 *
 * These errors are meant to be caught early during initialization or
 * when applying scoping (e.g., switching provider/network).
 *
 * @example
 * ```ts
 * try {
 *   const client = new HederaRestClient({ defaultProvider: "unknown" as any });
 * } catch (e) {
 *   if (e instanceof ConfigError) {
 *     console.error("Bad configuration:", e.message);
 *   } else {
 *     throw e;
 *   }
 * }
 * ```
 *
 * @public
 */
export class ConfigError extends Error {
	constructor(message?: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "ConfigError";
		if (options && Object.prototype.hasOwnProperty.call(options, "cause")) {
			Object.defineProperty(this, "cause", { configurable: true, writable: true, value: options.cause });
		}
	}
}

/**
 * Input validation error used across mappers and DSL builders.
 *
 * @remarks
 * This error indicates that a value supplied by the caller failed a
 * semantic or format check (e.g., malformed entity ID, out-of-range
 * comparator, invalid timestamp, hex string with wrong length).
 *
 * It is **not** an HTTP error. Validation happens locally, before
 * issuing a request, to provide immediate and actionable feedback.
 *
 * @example
 * ```ts
 * import { HederaRestClient, ValidationError } from "@davincigraph/hedera-rest-client";
 *
 * const client = new HederaRestClient({});
 *
 * try {
 *   await client.accounts().one({ idOrAliasOrEvmAddress: "not.an.id" }).get();
 * } catch (e) {
 *   if (e instanceof ValidationError) {
 *     console.error("Please provide a valid account ID, alias, or EVM address:", e.message);
 *   }
 * }
 * ```
 *
 * @public
 */
export class ValidationError extends Error {
	constructor(message?: string, options?: { cause?: unknown }) {
		super(message);
		this.name = "ValidationError";
		if (options && Object.prototype.hasOwnProperty.call(options, "cause")) {
			Object.defineProperty(this, "cause", { configurable: true, writable: true, value: options.cause });
		}
	}
}
