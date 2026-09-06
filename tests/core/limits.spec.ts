import { describe, it, expect } from "vitest";
import { inferPageEndpoint, prepareQueryLimit, resolvedQueryLimit, resolveLimitValue } from "../../src/core/limits";

// Minimal ResolvedTarget stub factory
function mkTarget(defaultLimit = 25, maxLimit = 100) {
	return {
		provider: "prov",
		network: "net",
		baseUrl: "https://mirror.test",
		page: { defaultLimit, maxLimit },
	} as any; // keep it lightweight for unit tests
}

describe("resolveLimitValue()", () => {
	it("returns undefined when limit is undefined", () => {
		const t = mkTarget();
		expect(resolveLimitValue(t, undefined)).toBeUndefined();
	});

	it("returns the numeric limit unchanged when within [1, maxLimit]", () => {
		const t = mkTarget(25, 100);
		expect(resolveLimitValue(t, 42)).toBe(42);
		expect(resolveLimitValue(t, 1)).toBe(1);
		expect(resolveLimitValue(t, 100)).toBe(100);
	});

	it("clamps numeric limits below 1 up to 1", () => {
		const t = mkTarget(25, 100);
		expect(resolveLimitValue(t, 0)).toBe(1);
		expect(resolveLimitValue(t, -5)).toBe(1);
	});

	it("clamps numeric limits above maxLimit down to maxLimit", () => {
		const t = mkTarget(25, 100);
		expect(resolveLimitValue(t, 101)).toBe(100);
		expect(resolveLimitValue(t, 999)).toBe(100);
	});

	it("returns defaultLimit when limit='default', then clamps to maxLimit if needed", () => {
		// within max
		const t1 = mkTarget(25, 100);
		expect(resolveLimitValue(t1, "default")).toBe(25);

		// default > max → clamp
		const t2 = mkTarget(250, 100);
		expect(resolveLimitValue(t2, "default")).toBe(100);
	});

	it("returns maxLimit when limit='max'", () => {
		const t = mkTarget(25, 100);
		expect(resolveLimitValue(t, "max")).toBe(100);
	});

	it("respects different target.page bounds", () => {
		const t = mkTarget(15, 50);
		// inside range
		expect(resolveLimitValue(t, 40)).toBe(40);
		// above new max → clamp
		expect(resolveLimitValue(t, 60)).toBe(50);
	});

	it("still clamps minimum to 1 even with very small maxLimit", () => {
		const t = mkTarget(1, 1);
		expect(resolveLimitValue(t, 0)).toBe(1);
		expect(resolveLimitValue(t, -10)).toBe(1);
		// 'max' with maxLimit=1 → 1
		expect(resolveLimitValue(t, "max")).toBe(1);
		// 'default'=1
		expect(resolveLimitValue(t, "default")).toBe(1);
	});

	it("rejects fractional, non-finite, and unsafe numeric limits", () => {
		const t = mkTarget();
		expect(() => resolveLimitValue(t, 1.5)).toThrow();
		expect(() => resolveLimitValue(t, Number.NaN)).toThrow();
		expect(() => resolveLimitValue(t, Number.POSITIVE_INFINITY)).toThrow();
		expect(() => resolveLimitValue(t, Number.MAX_SAFE_INTEGER + 1)).toThrow();
		expect(() => resolveLimitValue(t, Object.create(null) as never)).toThrowError(/limit must be/);
	});

	it("rejects an explicitly null query limit instead of treating it as omitted", () => {
		const query = { limit: null } as any;
		expect(() => prepareQueryLimit(mkTarget(), query)).toThrowError(/limit must be/);
	});

	it("validates fork-configured pagination bounds", () => {
		expect(() => resolveLimitValue(mkTarget(0, 100), "default")).toThrow();
		expect(() => resolveLimitValue(mkTarget(25, 0), "max")).toThrow();
		expect(() => resolveLimitValue(mkTarget(1.5, 100), 10)).toThrow();
		expect(() => resolveLimitValue(mkTarget(25, Number.NaN), 10)).toThrow();
	});

	it("uses endpoint-specific defaults and maxima without changing global limits", () => {
		const target = {
			...mkTarget(25, 100),
			page: {
				defaultLimit: 25,
				maxLimit: 100,
				endpoints: { "network.nodes": { defaultLimit: 10, maxLimit: 25 } },
			},
		};

		expect(resolveLimitValue(target, "default")).toBe(25);
		expect(resolveLimitValue(target, "default", "network.nodes")).toBe(10);
		expect(resolveLimitValue(target, "max", "network.nodes")).toBe(25);
		expect(resolveLimitValue(target, 100, "network.nodes")).toBe(25);
		expect(resolveLimitValue(target, "max", "unknown.endpoint")).toBe(100);
	});

	it("retains symbolic intent while re-resolving for an endpoint and failover target", () => {
		const initial = {
			...mkTarget(50, 200),
			page: { defaultLimit: 50, maxLimit: 200, endpoints: { "network.nodes": { defaultLimit: 10, maxLimit: 25 } } },
		};
		const failover = {
			...mkTarget(20, 100),
			page: { defaultLimit: 20, maxLimit: 100, endpoints: { "network.nodes": { defaultLimit: 5, maxLimit: 10 } } },
		};
		const query: Record<string, unknown> = { limit: "max" };

		prepareQueryLimit(initial, query);
		expect(query.limit).toBe(200);
		expect(resolvedQueryLimit(initial, query, "network.nodes")).toBe(25);
		expect(resolvedQueryLimit(failover, query, "network.nodes")).toBe(10);
	});
});

describe("inferPageEndpoint()", () => {
	it.each([
		["/api/v1/network/nodes", "network.nodes"],
		["/api/v1/network/nodes?limit=100", "network.nodes"],
		["https://mirror.example/custom/api/v1/network/nodes?limit=100", "network.nodes"],
		["/custom/api/v1/network/nodes/", "network.nodes"],
		["/api/v1/network/nodes/0", undefined],
		["/api/v1/network/fees", undefined],
	])("infers %s", (path, expected) => {
		expect(inferPageEndpoint(path)).toBe(expected);
	});
});
