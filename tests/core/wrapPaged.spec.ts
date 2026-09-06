import { describe, expect, it, vi } from "vitest";
import { wrapPaged } from "../../src/core/paging";

type RawPage = {
	items: string[];
	links?: { next?: string | null };
	provider_extension?: { cursor: string };
	next?: unknown;
};

type TestPage = {
	items: string[];
	links?: { next?: string | null };
	provider_extension?: { cursor: string };
	next: ((opts?: { signal?: AbortSignal }) => Promise<TestPage | null>) & {
		url(): string | null;
	};
};

type TestTarget = {
	provider: string;
	network: string;
	baseUrl: string;
};

type RoutedResult = {
	response: Response;
	target: TestTarget;
	requestUrl: string;
};

type RegistryStub = {
	getWithTarget: ReturnType<typeof vi.fn>;
};

function target(provider = "primary", baseUrl = "https://mirror.test"): TestTarget {
	return { provider, network: "testnet", baseUrl };
}

function response(payload: RawPage, url = ""): Response {
	return { url, text: async () => JSON.stringify(payload) } as Response;
}

function routed(activeTarget: TestTarget, requestUrl: string, payload: RawPage, responseUrl = ""): RoutedResult {
	return { response: response(payload, responseUrl), target: activeTarget, requestUrl };
}

function registry(): RegistryStub {
	return { getWithTarget: vi.fn() };
}

function wrap(reg: RegistryStub, result: RoutedResult, raw: RawPage): TestPage {
	return wrapPaged<TestPage, RawPage>(reg as any, result as any, raw, (page) => ({ items: page.items }));
}

describe("wrapPaged()", () => {
	it("retains raw fields while normalized mapper fields and the paging helper take precedence", async () => {
		const reg = registry();
		const active = target();
		const links = { next: null };
		const providerExtension = { cursor: "fork-specific" };
		const raw: RawPage = {
			items: ["raw"],
			links,
			provider_extension: providerExtension,
			next: "untrusted-server-field",
		};

		const page = wrapPaged<TestPage, RawPage>(
			reg as any,
			routed(active, "https://mirror.test/api/v1/items", raw) as any,
			raw,
			(response) => ({ items: response.items.map((item) => item.toUpperCase()) })
		);

		expect(page.items).toEqual(["RAW"]);
		expect(page.links).toBe(links);
		expect(page.provider_extension).toBe(providerExtension);
		expect(page.next).toBeTypeOf("function");
		await expect(page.next()).resolves.toBeNull();
	});

	it.each([
		{ links: { next: null } },
		{ links: { next: undefined } },
		{ links: { next: "" } },
		{},
	])("treats a missing or empty links.next as the end of the collection", async (links) => {
		const reg = registry();
		const raw: RawPage = { items: ["one"], ...links };
		const active = target();
		const page = wrap(reg, routed(active, "https://mirror.test/api/v1/items", raw), raw);

		expect(page.items).toEqual(["one"]);
		expect(page.next.url()).toBeNull();
		await expect(page.next()).resolves.toBeNull();
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});

	it.each([42, true, { href: "/api/v1/items?cursor=2" }, "   "])("rejects a malformed links.next instead of silently truncating the collection: %j", (next) => {
		const reg = registry();
		const active = target();
		const raw = { items: ["one"], links: { next } } as unknown as RawPage;

		expect(() => wrap(reg, routed(active, "https://mirror.test/api/v1/items", raw), raw)).toThrow(/Invalid Mirror Node pagination link/);
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "an origin-only base",
			baseUrl: "https://fork.test",
			requestUrl: "https://fork.test/api/v1/items?limit=1",
			next: "/api/v1/items?cursor=2",
			expectedUrl: "https://fork.test/api/v1/items?cursor=2",
		},
		{
			name: "a custom gateway prefix",
			baseUrl: "https://fork.test/mirror",
			requestUrl: "https://fork.test/mirror/api/v1/items?limit=1",
			next: "/api/v1/items?cursor=2",
			expectedUrl: "https://fork.test/mirror/api/v1/items?cursor=2",
		},
		{
			name: "a base ending at /api/v1",
			baseUrl: "https://fork.test/mirror/api/v1",
			requestUrl: "https://fork.test/mirror/api/v1/items?limit=1",
			next: "/api/v1/items?cursor=2",
			expectedUrl: "https://fork.test/mirror/api/v1/items?cursor=2",
		},
		{
			name: "a prefix-inclusive root-relative link",
			baseUrl: "https://fork.test/mirror/api/v1",
			requestUrl: "https://fork.test/mirror/api/v1/items?limit=1",
			next: "/mirror/api/v1/items?cursor=2",
			expectedUrl: "https://fork.test/mirror/api/v1/items?cursor=2",
		},
		{
			name: "a prefix-inclusive absolute link",
			baseUrl: "https://fork.test/mirror/api/v1",
			requestUrl: "https://fork.test/mirror/api/v1/items?limit=1",
			next: "https://fork.test/mirror/api/v1/items?cursor=2",
			expectedUrl: "https://fork.test/mirror/api/v1/items?cursor=2",
		},
	])("canonicalizes $name without duplicating its path", async ({ baseUrl, requestUrl, next, expectedUrl }) => {
		const reg = registry();
		const active = target("fork", baseUrl);
		const raw1: RawPage = { items: ["one"], links: { next } };
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		reg.getWithTarget.mockResolvedValueOnce(routed(active, expectedUrl, raw2));

		const page = wrap(reg, routed(active, requestUrl, raw1), raw1);
		expect(page.next.url()).toBe(expectedUrl);
		await expect(page.next()).resolves.toMatchObject({ items: ["two"] });
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, "/api/v1/items?cursor=2", undefined);
	});

	it("resolves query-only links against the current request URL and preserves repeated encoded parameters", async () => {
		const reg = registry();
		const active = target("fork", "https://fork.test/mirror");
		const next = "?topic=0x1&topic=0x2&cursor=a%2Fb+z";
		const expectedPath = `/api/v1/items${next}`;
		const expectedUrl = `https://fork.test/mirror${expectedPath}`;
		const raw1: RawPage = { items: ["one"], links: { next } };
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		reg.getWithTarget.mockResolvedValueOnce(routed(active, expectedUrl, raw2));

		const page = wrap(reg, routed(active, "https://fork.test/mirror/api/v1/items?limit=1&order=asc", raw1), raw1);
		expect(page.next.url()).toBe(expectedUrl);
		await page.next();
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, expectedPath, undefined);
	});

	it("uses Fetch's final response URL as the base for a relative link while retaining the configured origin", async () => {
		const reg = registry();
		const active = target("fork", "https://fork.test/mirror");
		const raw1: RawPage = { items: ["one"], links: { next: "?cursor=2" } };
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		const expectedPath = "/api/v1/redirected-items?cursor=2";
		const expectedUrl = `https://fork.test/mirror${expectedPath}`;
		reg.getWithTarget.mockResolvedValueOnce(routed(active, expectedUrl, raw2));

		const page = wrap(
			reg,
			routed(
				active,
				"https://fork.test/mirror/api/v1/original-items?cursor=1",
				raw1,
				"https://redirect.invalid/edge/api/v1/redirected-items?cursor=1"
			),
			raw1
		);
		expect(page.next.url()).toBe(expectedUrl);
		await page.next();
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, expectedPath, undefined);
	});

	it.each([
		{
			name: "bare path-relative",
			requestUrl: "https://fork.test/mirror/api/v1/items?cursor=1",
			next: "items?cursor=2",
			expectedPath: "/api/v1/items?cursor=2",
		},
		{
			name: "dot-relative",
			requestUrl: "https://fork.test/mirror/api/v1/items?cursor=1",
			next: "./items?cursor=2",
			expectedPath: "/api/v1/items?cursor=2",
		},
		{
			name: "parent-relative",
			requestUrl: "https://fork.test/mirror/api/v1/accounts/items?cursor=1",
			next: "../tokens?cursor=2",
			expectedPath: "/api/v1/tokens?cursor=2",
		},
	])("resolves $name links against the page URL", async ({ requestUrl, next, expectedPath }) => {
		const reg = registry();
		const active = target("fork", "https://fork.test/mirror");
		const raw1: RawPage = { items: ["one"], links: { next } };
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		const expectedUrl = `https://fork.test/mirror${expectedPath}`;
		reg.getWithTarget.mockResolvedValueOnce(routed(active, expectedUrl, raw2));

		const page = wrap(reg, routed(active, requestUrl, raw1), raw1);
		expect(page.next.url()).toBe(expectedUrl);
		await page.next();
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, expectedPath, undefined);
	});

	it.each([
		"https://attacker.invalid/another/prefix/api/v1/items?cursor=2#ignored",
		"//attacker.invalid/another/prefix/api/v1/items?cursor=2#ignored",
	])("treats an absolute link origin as non-authoritative and never routes credentials to it: %s", async (next) => {
		const reg = registry();
		const active = target("arkhia", "https://pool.arkhia.test/hedera/testnet/api/v1");
		const raw1: RawPage = {
			items: ["one"],
			links: { next },
		};
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		const expectedPath = "/api/v1/items?cursor=2";
		const expectedUrl = "https://pool.arkhia.test/hedera/testnet/api/v1/items?cursor=2";
		reg.getWithTarget.mockResolvedValueOnce(routed(active, expectedUrl, raw2));

		const page = wrap(reg, routed(active, "https://pool.arkhia.test/hedera/testnet/api/v1/items?cursor=1", raw1), raw1);
		expect(page.next.url()).toBe(expectedUrl);
		expect(page.next.url()).not.toContain("attacker.invalid");
		await page.next();
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, expectedPath, undefined);
	});

	it.each([
		"javascript:alert('/api/v1/items')",
		"data:text/plain,/api/v1/items",
		"https://other.test/not-the-mirror-api?cursor=2",
		"../../admin?cursor=2",
	])("rejects an unsafe or non-API next link: %s", (next) => {
		const reg = registry();
		const active = target("fork", "https://fork.test/mirror");
		const raw: RawPage = { items: ["one"], links: { next } };

		expect(() => wrap(reg, routed(active, "https://fork.test/mirror/api/v1/items", raw), raw)).toThrow();
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});

	it("keeps the effective provider across pages and adopts the target selected by later failover", async () => {
		const reg = registry();
		const providerB = target("provider-b", "https://b.test/b/api/v1");
		const providerC = target("provider-c", "https://c.test/c/api/v1");
		const raw1: RawPage = {
			items: ["from-b-1"],
			links: { next: "https://b.test/b/api/v1/items?cursor=2" },
		};
		const raw2: RawPage = {
			items: ["from-c-2"],
			links: { next: "/api/v1/items?cursor=3" },
		};
		const raw3: RawPage = { items: ["from-c-3"], links: { next: null } };
		reg.getWithTarget
			.mockResolvedValueOnce(routed(providerC, "https://c.test/c/api/v1/items?cursor=2", raw2))
			.mockResolvedValueOnce(routed(providerC, "https://c.test/c/api/v1/items?cursor=3", raw3));

		// The initial logical request selected provider B after overflow/failover.
		const page1 = wrap(reg, routed(providerB, "https://b.test/b/api/v1/items?limit=1", raw1), raw1);
		expect(page1.links).toBe(raw1.links);
		expect(page1.next.url()).toBe("https://b.test/b/api/v1/items?cursor=2");

		// The next logical request starts on B but succeeds on C. Its provider-neutral
		// path lets the registry resolve C's distinct prefix without `/c/b/api/v1`.
		const page2 = await page1.next();
		expect(reg.getWithTarget).toHaveBeenNthCalledWith(1, providerB, "/api/v1/items?cursor=2", undefined);
		expect(page2?.items).toEqual(["from-c-2"]);
		expect(page2?.links).toEqual(raw2.links);
		expect(page2?.next.url()).toBe("https://c.test/c/api/v1/items?cursor=3");

		const page3 = await page2?.next();
		expect(reg.getWithTarget).toHaveBeenNthCalledWith(2, providerC, "/api/v1/items?cursor=3", undefined);
		expect(page3?.items).toEqual(["from-c-3"]);
		expect(page3?.next.url()).toBeNull();
	});

	it("forwards AbortSignal through the routed paging request", async () => {
		const reg = registry();
		const active = target();
		const raw1: RawPage = { items: ["one"], links: { next: "/api/v1/items?cursor=2" } };
		const raw2: RawPage = { items: ["two"], links: { next: null } };
		reg.getWithTarget.mockResolvedValueOnce(routed(active, "https://mirror.test/api/v1/items?cursor=2", raw2));
		const page = wrap(reg, routed(active, "https://mirror.test/api/v1/items?cursor=1", raw1), raw1);
		const controller = new AbortController();

		await page.next({ signal: controller.signal });
		expect(reg.getWithTarget).toHaveBeenCalledWith(active, "/api/v1/items?cursor=2", undefined, controller.signal);
	});

	it("validates next-page request options before routing", async () => {
		const reg = registry();
		const active = target();
		const raw: RawPage = { items: ["one"], links: { next: "/api/v1/items?cursor=2" } };
		const page = wrap(reg, routed(active, "https://mirror.test/api/v1/items?cursor=1", raw), raw);

		await expect(page.next({ timeotMs: 10 } as any)).rejects.toThrow(/Unknown request option/);
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});

	it("validates request options even when the collection has no next page", async () => {
		const reg = registry();
		const active = target();
		const raw: RawPage = { items: ["one"], links: { next: null } };
		const page = wrap(reg, routed(active, "https://mirror.test/api/v1/items", raw), raw);

		await expect(page.next({ timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});

	it("rejects null request options instead of treating them as an empty object", async () => {
		const reg = registry();
		const active = target();
		const raw: RawPage = { items: ["one"], links: { next: "/api/v1/items?cursor=2" } };
		const page = wrap(reg, routed(active, "https://mirror.test/api/v1/items?cursor=1", raw), raw);

		await expect(page.next(null as any)).rejects.toThrow(/request options must be a plain object/);
		expect(reg.getWithTarget).not.toHaveBeenCalled();
	});
});
