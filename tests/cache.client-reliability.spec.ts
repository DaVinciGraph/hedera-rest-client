import { afterEach, describe, expect, it, vi } from "vitest";

import { HederaRestClient } from "../src/HederaRestClient";
import { ConfigError } from "../src/core/errors";
import { ProviderRegistry } from "../src/core/provider";
import type { CacheAdapter, HederaRestClientConfig } from "../src/types";

afterEach(() => vi.restoreAllMocks());

describe("client cache reliability", () => {
	it("does not let callers mutate the default in-memory cache through fresh responses or cache hits", async () => {
		const get = vi.spyOn(ProviderRegistry.prototype, "get").mockResolvedValue(
			new Response(JSON.stringify({ token_id: "0.0.123", name: "Original", custom_fees: { fixed_fees: [] } }), { status: 200 })
		);
		const client = new HederaRestClient({ cache: { isEnabled: true } });

		const fresh: any = await client.tokens().one({ tokenId: "0.0.123" }).get();
		fresh.name = "mutated fresh response";
		fresh.custom_fees.fixed_fees.push({ amount: 1 });

		const firstHit: any = await client.tokens().one({ tokenId: "0.0.123", useCache: true }).get();
		expect(firstHit).toMatchObject({ name: "Original", custom_fees: { fixed_fees: [] } });
		firstHit.name = "mutated cache hit";
		firstHit.custom_fees.fixed_fees.push({ amount: 2 });

		const secondHit: any = await client.tokens().one({ tokenId: "0.0.123", useCache: true }).get();
		expect(secondHit).toMatchObject({ name: "Original", custom_fees: { fixed_fees: [] } });
		expect(secondHit).not.toBe(firstHit);
		expect(get).toHaveBeenCalledOnce();
	});

	it("validates request options before returning a warm cache hit", async () => {
		const get = vi.spyOn(ProviderRegistry.prototype, "get").mockResolvedValue(
			new Response(JSON.stringify({ token_id: "0.0.124" }), { status: 200 })
		);
		const client = new HederaRestClient({ cache: { isEnabled: true } });

		await client.tokens().one({ tokenId: "0.0.124" }).get();
		await expect(client.tokens().one({ tokenId: "0.0.124", useCache: true }).get({ timeotMs: 10 } as any)).rejects.toThrow(
			/Unknown request option/
		);
		expect(get).toHaveBeenCalledOnce();
	});

	it("returns fresh Mirror Node data when both custom-cache operations fail", async () => {
		const adapter: CacheAdapter = {
			get: vi.fn().mockRejectedValue(new Error("cache read unavailable")),
			set: vi.fn().mockRejectedValue(new Error("cache write unavailable")),
		};
		vi.spyOn(ProviderRegistry.prototype, "get").mockResolvedValue(
			new Response(JSON.stringify({ token_id: "0.0.123" }), { status: 200 })
		);
		const client = new HederaRestClient({ cache: { isEnabled: true, adapter } });

		await expect(client.tokens().one({ tokenId: "0.0.123", useCache: true }).get()).resolves.toEqual({ token_id: "0.0.123" });
		expect(adapter.get).toHaveBeenCalledOnce();
		expect(adapter.set).toHaveBeenCalledOnce();
	});

	it("uses a detached cache-policy snapshot while retaining the adapter instance", async () => {
		const adapter: CacheAdapter = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn().mockResolvedValue(undefined),
		};
		const config: HederaRestClientConfig = {
			cache: {
				isEnabled: true,
				duration: 120,
				resources: { tokens: { isEnabled: true, duration: 30 } },
				adapter,
			},
		};
		vi.spyOn(ProviderRegistry.prototype, "get").mockResolvedValue(
			new Response(JSON.stringify({ token_id: "0.0.456" }), { status: 200 })
		);
		const client = new HederaRestClient(config);

		config.cache!.isEnabled = false;
		config.cache!.duration = 999;
		config.cache!.resources!.tokens!.duration = 999;
		await client.tokens().one({ tokenId: "0.0.456" }).get();

		expect(adapter.set).toHaveBeenCalledWith(expect.stringContaining(':"testnet":token:0.0.456:'), expect.anything(), 30);
	});

	it.each([
		undefined,
		null,
		[] as unknown,
	])("rejects a non-object top-level configuration (%s)", (config) => {
		expect(() => new HederaRestClient(config as HederaRestClientConfig)).toThrow(ConfigError);
	});

	it("rejects non-boolean switches instead of coercing them", () => {
		expect(() => new HederaRestClient({ switchProviderOnFailure: "yes" } as any)).toThrow(ConfigError);
		expect(() => new HederaRestClient({ log: 1 } as any)).toThrow(ConfigError);
	});
});
