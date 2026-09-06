import { ConfigError } from "./errors";

const MIRROR_NODE_API_ROOT = "/api/v1";
const RELATIVE_URL_ORIGIN = "https://hedera-rest-client.invalid";

function withoutTrailingSlashes(pathname: string): string {
	return pathname.replace(/\/+$/, "");
}

function isPathOrChild(pathname: string, parent: string): boolean {
	return pathname === parent || pathname.startsWith(`${parent}/`);
}

/**
 * Validate and canonicalize a configured Mirror Node URL.
 *
 * The URL may identify an origin, a path prefix, or the complete `/api/v1`
 * API root. Query strings and fragments are deliberately rejected because
 * they would be ambiguous when endpoint paths and queries are appended.
 */
export function normalizeMirrorNodeBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ConfigError(`Mirror Node URL must be an absolute HTTP(S) URL: ${value}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new ConfigError(`Mirror Node URL must use HTTP or HTTPS: ${value}`);
	}
	if (url.username || url.password) {
		throw new ConfigError(`Mirror Node URL must not contain embedded credentials: ${value}`);
	}
	if (url.search || url.hash) {
		throw new ConfigError(`Mirror Node URL must not include a query string or fragment: ${value}`);
	}

	url.pathname = withoutTrailingSlashes(url.pathname) || "/";
	return url.toString().replace(/\/$/, "");
}

/**
 * Resolve a Mirror Node endpoint path against a normalized provider URL.
 *
 * Endpoint builders use paths beginning with `/api/v1`. If the provider URL
 * already ends at that API root, this function adds the prefix only once. Any
 * provider-specific path before the API root is preserved. Paths returned by
 * pagination which already contain the configured prefix are also kept as-is.
 * Absolute endpoint URLs are treated as path references; their origin is never
 * allowed to replace the configured provider origin.
 */
export function resolveMirrorNodeUrl(baseUrl: string, endpointPath: string, query = ""): string {
	const normalizedBase = normalizeMirrorNodeBaseUrl(baseUrl);
	const target = new URL(normalizedBase);
	const basePath = withoutTrailingSlashes(target.pathname);
	const endpoint = new URL(endpointPath || "/", RELATIVE_URL_ORIGIN);
	let endpointPathname = endpoint.pathname;

	if (basePath && isPathOrChild(endpointPathname, basePath)) {
		// Pagination URLs from prefixed providers may already contain the prefix.
		target.pathname = endpointPathname;
	} else {
		if (basePath.endsWith(MIRROR_NODE_API_ROOT) && isPathOrChild(endpointPathname, MIRROR_NODE_API_ROOT)) {
			endpointPathname = endpointPathname.slice(MIRROR_NODE_API_ROOT.length);
		}

		const suffix = endpointPathname.replace(/^\/+/, "");
		target.pathname = suffix ? `${basePath}/${suffix}` : basePath || "/";
	}

	const endpointQuery = endpoint.search.replace(/^\?/, "");
	const suppliedQuery = query.replace(/^\?/, "");
	const combinedQuery = [endpointQuery, suppliedQuery].filter(Boolean).join("&");
	target.search = combinedQuery ? `?${combinedQuery}` : "";
	target.hash = "";

	return target.toString();
}
