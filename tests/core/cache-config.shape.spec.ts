import { describe, expect, it } from "vitest";

import { snapshotCacheConfig } from "../../src/core/cache-config";
import { ConfigError } from "../../src/core/errors";

describe("cache configuration shape validation", () => {
	it.each([new Date(), new Map(), Object.create({ isEnabled: true })])("rejects a non-record cache object", (cache) => {
		expect(() => snapshotCacheConfig(cache as never)).toThrow(ConfigError);
	});

	it("accepts null-prototype configuration dictionaries", () => {
		const cache = Object.assign(Object.create(null), {
			isEnabled: true,
			resources: Object.assign(Object.create(null), {
				tokens: Object.assign(Object.create(null), { duration: 30 }),
			}),
		});
		expect(snapshotCacheConfig(cache)).toMatchObject({ isEnabled: true, resources: { tokens: { duration: 30 } } });
	});

	it("rejects symbol keys at every fixed-shape cache level", () => {
		expect(() => snapshotCacheConfig({ [Symbol("enabled")]: true } as never)).toThrow(/Symbol\(enabled\)/);
		expect(() => snapshotCacheConfig({ resources: { [Symbol("tokens")]: {} } } as never)).toThrow(/Symbol\(tokens\)/);
		expect(() => snapshotCacheConfig({ resources: { tokens: { [Symbol("ttl")]: 30 } } } as never)).toThrow(/Symbol\(ttl\)/);
	});
});
