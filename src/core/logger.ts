// src/core/logger.ts

/**
 * Human‑readable severity levels understood by this client’s logger.
 *
 * These map 1‑to‑1 to the platform’s native console methods:
 * - `"debug"` → `console.debug`
 * - `"info"`  → `console.info`
 * - `"warn"`  → `console.warn`
 * - `"error"` → `console.error`
 *
 * @remarks
 * The `Logger` class below does not currently filter by level; it only
 * toggles all logging on/off via the {@link LoggerOptions.enabled} flag.
 * This string union exists to document the recognized levels and to make it
 * easier to introduce per‑level filtering in the future without changing
 * call sites.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Configuration for {@link Logger}.
 */
export interface LoggerOptions {
	/**
	 * When `true`, log messages are forwarded to the host environment’s console.
	 * When `false`, all logging is disabled (no console calls are made).
	 *
	 * @defaultValue `false`
	 *
	 * @example
	 * // Enable logs in development, disable in production
	 * new Logger({ enabled: process.env.NODE_ENV !== "production" });
	 */
	enabled: boolean;
}

/**
 * Minimal logger used throughout the client.
 *
 * @summary
 * - **Purpose:** Provide consistent, opt‑in console output with a stable prefix.
 * - **Behavior:** If disabled, methods are no‑ops—no runtime cost beyond the `if` check.
 * - **Environment:** Safe to use in Node.js, browsers, serverless, and SSR.
 *
 * @remarks
 * This is intentionally small: it does not format timestamps, does not
 * persist logs, and does not support transports or per‑level filtering.
 * If you need richer logging, adapt this class or wrap it with your own
 * implementation while keeping the same method surface.
 *
 * Each method adds the fixed prefix `"[hedera-rest-client]"` so messages
 * can be grouped/filtered easily in browser devtools or terminal output.
 *
 * @example
 * const log = new Logger({ enabled: true });
 * log.info("Initialized", { provider: "public", network: "testnet" });
 * // [hedera-rest-client] Initialized { provider: 'public', network: 'testnet' }
 *
 * @example
 * // Disabled logger: no console output is produced.
 * const quiet = new Logger({ enabled: false });
 * quiet.warn("Something went wrong"); // no-op
 */
export class Logger {
	private enabled: boolean;

	/**
	 * Create a new logger instance.
	 *
	 * @param opts - See {@link LoggerOptions}. Only the `enabled` flag is used.
	 */
	constructor(opts: LoggerOptions) {
		this.enabled = !!opts.enabled;
	}

	/**
	 * Log low‑level diagnostic information helpful during development.
	 *
	 * @param args - Any values to print. Objects are encouraged for structured logs.
	 *
	 * @example
	 * logger.debug("fetch start", { url, params });
	 */
	debug(...args: any[]) {
		if (this.enabled) console.debug("[hedera-rest-client]", ...args);
	}

	/**
	 * Log noteworthy, expected events (initialization, configuration, summaries).
	 *
	 * @param args - Any values to print. Objects are encouraged for structured logs.
	 *
	 * @example
	 * logger.info("Using provider", providerName, "on", networkName);
	 */
	info(...args: any[]) {
		if (this.enabled) console.info("[hedera-rest-client]", ...args);
	}

	/**
	 * Log recoverable issues or unexpected states that did not stop execution.
	 *
	 * @param args - Any values to print. Include context to aid triage.
	 *
	 * @example
	 * logger.warn("Retrying due to 429", { attempt, retryAfterMs });
	 */
	warn(...args: any[]) {
		if (this.enabled) console.warn("[hedera-rest-client]", ...args);
	}

	/**
	 * Log errors that represent failed operations or terminal conditions.
	 *
	 * @param args - Any values to print. Prefer passing `Error` objects to
	 *               preserve stack traces in capable environments.
	 *
	 * @example
	 * try {
	 *   await doRequest();
	 * } catch (e) {
	 *   logger.error("Request failed", e);
	 * }
	 */
	error(...args: any[]) {
		if (this.enabled) console.error("[hedera-rest-client]", ...args);
	}
}
