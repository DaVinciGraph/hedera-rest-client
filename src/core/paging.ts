// src/core/paging.ts
import type { NextPageFn, RequestOptions } from "../types";
import { readJsonResponse } from "./json";
import type { ProviderGetResponse, ProviderRegistry, ResolvedTarget } from "./provider";
import { resolveMirrorNodeUrl } from "./url";
import { inferPageEndpoint, resolveLimitValue } from "./limits";
import { requestOptionArgs } from "./request-options";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const API_ROOT_PATTERN = /\/api\/v1(?=\/|$)/g;

interface ResolvedNextLink {
	/** Provider-neutral Mirror Node API path used for the routed request. */
	path: string;
	/** Canonical URL on the current effective provider represented by `path`. */
	url: string;
}

/**
 * Request provenance needed to resolve a page's links. A live
 * {@link ProviderGetResponse} satisfies this shape directly. `response` is
 * optional so a cached raw page can be rebound safely to the caller's current
 * configured target without manufacturing a Fetch response.
 */
export interface PageRequestContext {
	target: ResolvedTarget;
	requestUrl: string;
	response?: Pick<Response, "url">;
}

function describeNextLink(nextHref: unknown): string {
	try {
		return JSON.stringify(nextHref) ?? String(nextHref);
	} catch {
		return String(nextHref);
	}
}

function invalidNextLink(nextHref: unknown, reason: string): Error {
	return new Error(`Invalid Mirror Node pagination link ${describeNextLink(nextHref)}: ${reason}`);
}

function parseHttpUrl(value: string, nextHref: string, label: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw invalidNextLink(nextHref, `${label} is not an absolute URL`);
	}
	if (!HTTP_PROTOCOLS.has(url.protocol)) {
		throw invalidNextLink(nextHref, `${label} must use HTTP or HTTPS`);
	}
	return url;
}

/**
 * Prefer Fetch's final response URL for RFC-relative link resolution. Synthetic
 * responses commonly have an empty `response.url`, so the exact pre-redirect
 * request URL retained by the provider registry is the deterministic fallback.
 */
function pageDocumentUrl(page: PageRequestContext, nextHref: string): URL {
	const responseUrl = page.response?.url;
	if (responseUrl) {
		try {
			const parsed = new URL(responseUrl);
			if (HTTP_PROTOCOLS.has(parsed.protocol)) return parsed;
		} catch {
			// Fall through to the registry-owned request URL.
		}
	}
	return parseHttpUrl(page.requestUrl, nextHref, "current page URL");
}

/**
 * Resolve a server-provided `links.next` into one provider-neutral request path
 * and its canonical URL on the current effective provider. A later overflow
 * selection or failure failover may execute that logical path on an alternate.
 *
 * The link's origin is deliberately non-authoritative. Even an absolute or
 * protocol-relative link is reduced to its logical `/api/v1/...` path and then
 * re-anchored to the effective configured target. This prevents credentials
 * from being sent to an arbitrary response-controlled origin and lets a page
 * fail over safely between providers with different path prefixes.
 */
function resolveNextLink(nextHref: string, page: PageRequestContext): ResolvedNextLink {
	let resolved: URL;
	try {
		resolved = new URL(nextHref, pageDocumentUrl(page, nextHref));
	} catch {
		throw invalidNextLink(nextHref, "it is not a valid URL reference");
	}
	if (!HTTP_PROTOCOLS.has(resolved.protocol)) {
		throw invalidNextLink(nextHref, "it must resolve to an HTTP or HTTPS URL");
	}

	// Use the last exact API-root segment. A provider prefix may itself contain
	// an earlier `/api/v1`, while the builder-owned endpoint is always the final
	// logical API root in the request path.
	const matches = [...resolved.pathname.matchAll(API_ROOT_PATTERN)];
	const apiRoot = matches[matches.length - 1];
	if (!apiRoot || apiRoot.index === undefined) {
		throw invalidNextLink(nextHref, "its path does not contain the /api/v1 API root");
	}

	const path = `${resolved.pathname.slice(apiRoot.index)}${resolved.search}`;
	const canonical = new URL(resolveMirrorNodeUrl(page.target.baseUrl, path));
	const linkedLimit = canonical.searchParams.get("limit");
	if (linkedLimit !== null) {
		const requested = linkedLimit === "default" || linkedLimit === "max" ? linkedLimit : Number(linkedLimit);
		canonical.searchParams.set("limit", String(resolveLimitValue(page.target, requested, inferPageEndpoint(path))));
	}
	return {
		path,
		url: canonical.toString(),
	};
}

/**
 * Wrap a raw Mirror Node list response in a strongly typed page object.
 *
 * `page` is the resolved transport result for `raw`, not merely the originally
 * requested target. Carrying that context guarantees that:
 *
 * - a first page served after overflow selection or failover remains on that
 *   provider for its next request;
 * - each later page updates the affinity again if it fails over;
 * - custom provider path prefixes are rendered exactly once;
 * - `next.url()` describes the same provider-neutral route used by `next()` on
 *   the page's current provider (before any new overflow/failover decision).
 *
 * Relative references (`?cursor=...`, `next?...`, `./...`, and `../...`) are
 * resolved against the current response document URL according to URL rules.
 * Absolute link origins are never trusted as request destinations; only their
 * logical Mirror Node API path is retained.
 *
 * @typeParam TPage Final page shape, including `next`.
 * @typeParam TRaw Raw response shape containing an optional `links.next`.
 * @param registry Provider registry used for every subsequent page.
 * @param page Resolved request context which produced `raw`.
 * @param raw Parsed Mirror Node response.
 * @param mapToBase Mapper for normalized page fields. Raw response fields,
 * including `links` and provider-specific extensions, are retained first;
 * mapped fields then take precedence before the client-owned `next` helper is
 * attached.
 */
export function wrapPaged<TPage, TRaw extends { links?: { next?: string | null } }>(
	registry: ProviderRegistry,
	page: PageRequestContext,
	raw: TRaw,
	mapToBase: (raw: TRaw) => Omit<TPage, "next" | "links">
): TPage {
	const suppliedNext = raw?.links?.next;
	if (suppliedNext !== undefined && suppliedNext !== null && typeof suppliedNext !== "string") {
		throw invalidNextLink(suppliedNext, "links.next must be a string, null, or absent");
	}
	if (typeof suppliedNext === "string" && suppliedNext !== "" && !suppliedNext.trim()) {
		throw invalidNextLink(suppliedNext, "links.next must not contain only whitespace");
	}
	const nextHref = suppliedNext || null;
	const nextLink = nextHref ? resolveNextLink(nextHref, page) : null;

	const nextFn = (async (opts?: RequestOptions) => {
		const optionArgs = requestOptionArgs(opts === undefined ? {} : opts);
		if (!nextLink) return null;

		const nextPage = await registry.getWithTarget(page.target, nextLink.path, undefined, ...optionArgs);
		const json = await readJsonResponse<TRaw>(nextPage.response);
		return wrapPaged<TPage, TRaw>(registry, nextPage, json, mapToBase);
	}) as NextPageFn<TPage>;

	nextFn.url = () => nextLink?.url ?? null;

	const base = mapToBase(raw) as Omit<TPage, "next" | "links">;
	return { ...raw, ...(base as any), next: nextFn } as TPage;
}
