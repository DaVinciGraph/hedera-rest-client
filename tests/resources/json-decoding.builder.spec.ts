import { describe, expect, it, vi } from "vitest";
import { TransactionsBuilder } from "../../src/resources/transactions/builder";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

describe("resource JSON decoding", () => {
	it("preserves unsafe int64 values on initial and paged responses", async () => {
		const nextPath = "/api/v1/transactions?limit=1&cursor=next";
		const bodies = [
			`{"transactions":[{"charged_tx_fee":9223372036854775807,"nonce":1}],"links":{"next":"${nextPath}"}}`,
			'{"transactions":[{"charged_tx_fee":9007199254740993,"nonce":2}],"links":{"next":null}}',
		];
		const get = vi.fn(async () => new Response(bodies.shift(), { headers: { "content-type": "application/json" } }));
		const registry = {
			resolve: vi.fn(() => ({
				provider: "public",
				network: "testnet",
				baseUrl: "https://testnet.mirrornode.hedera.com",
				page: { defaultLimit: 25, maxLimit: 100 },
			})),
			get,
			getLogger: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })),
		};
		(registry as any).getWithTarget = vi.fn(async (...args: any[]) => {
			const [target, path, params] = args;
			const response = await (registry.get as any)(...args);
			return {
				response,
				target,
				requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
			};
		});

		const first = await new TransactionsBuilder(registry as any).list({ limit: 1 }).get();
		expect(first.transactions[0].charged_tx_fee).toBe("9223372036854775807");
		expect(first.transactions[0].nonce).toBe(1);
		expect(first.next.url()).toBe(`https://testnet.mirrornode.hedera.com${nextPath}`);

		const second = await first.next();
		expect(second?.transactions[0].charged_tx_fee).toBe("9007199254740993");
		expect(second?.transactions[0].nonce).toBe(2);
		expect(get).toHaveBeenNthCalledWith(2, expect.anything(), nextPath, undefined);
	});
});
