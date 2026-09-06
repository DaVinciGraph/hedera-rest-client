import { describe, expect, it, vi } from "vitest";

import { AccountsBuilder } from "../../src/resources/accounts/builder";
import { BlocksBuilder } from "../../src/resources/blocks/builder";
import { NetworkBuilder } from "../../src/resources/network/builder";
import { TokensBuilder } from "../../src/resources/tokens/builder";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

const target = {
	provider: "public",
	network: "testnet",
	baseUrl: "https://testnet.mirrornode.hedera.com",
	headers: {},
	http: {},
	page: { defaultLimit: 25, maxLimit: 100 },
};

function registryWithBodies(...bodies: string[]) {
	let index = 0;
	const registry = {
		resolve: vi.fn(() => target),
		getLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
		get: vi.fn(async () => new Response(bodies[index++] ?? "{}")),
	};
	(registry as any).getWithTarget = vi.fn(async (...args: any[]) => {
		const [routedTarget, path, params] = args;
		const response = await (registry.get as any)(...args);
		return {
			response,
			target: routedTarget,
			requestUrl: resolveMirrorNodeUrl(routedTarget.baseUrl, path, buildQuery(params ?? {})),
		};
	});
	return registry;
}

describe("corrected response contracts", () => {
	it("returns the full account-with-transactions payload from accounts.one", async () => {
		const registry = registryWithBodies(
			'{"account":"0.0.98","delegation_address":null,"transactions":[{"charged_tx_fee":9223372036854775807}],"links":{"next":null}}'
		);
		const result = await new AccountsBuilder(registry as any).one({ idOrAliasOrEvmAddress: "0.0.98" }).get();

		expect(result?.account).toBe("0.0.98");
		expect(result?.delegation_address).toBeNull();
		expect(result?.transactions[0]?.charged_tx_fee).toBe("9223372036854775807");
		expect(result?.links.next).toBeNull();
	});

	it("retains token-balance timestamp metadata and uses distribution item rows", async () => {
		const registry = registryWithBodies(
			'{"timestamp":"1700000000.000000001","balances":[{"account":null,"balance":9007199254740993,"decimals":null}],"links":{"next":null}}'
		);
		const page = await new TokensBuilder(registry as any).balances({ tokenId: "0.0.1" }).get();

		expect(page.timestamp).toBe("1700000000.000000001");
		expect(page.balances).toEqual([{ account: null, balance: "9007199254740993", decimals: null }]);
	});

	it("normalizes an omitted optional raw collection to an empty page array", async () => {
		const registry = registryWithBodies('{"links":{"next":null}}');
		const page = await new BlocksBuilder(registry as any).list().get();

		expect(page.blocks).toEqual([]);
		expect(await page.next()).toBeNull();
	});

	it("exposes working pagination for network nodes", async () => {
		const nextPath = "/api/v1/network/nodes?node.id=gt%3A1";
		const registry = registryWithBodies(
			`{"nodes":[{"node_id":1,"associated_registered_nodes":[],"grpc_proxy_endpoint":null}],"links":{"next":"${nextPath}"}}`,
			'{"nodes":[{"node_id":2,"associated_registered_nodes":[],"grpc_proxy_endpoint":null}],"links":{"next":null}}'
		);
		const first = await new NetworkBuilder(registry as any).nodes({ limit: 1 }).get();
		const second = await first.next();

		expect(first.nodes[0]?.grpc_proxy_endpoint).toBeNull();
		expect(first.next.url()).toBe(`${target.baseUrl}${nextPath}`);
		expect(second?.nodes[0]?.node_id).toBe(2);
		expect(second?.next.url()).toBeNull();
		expect(registry.get).toHaveBeenNthCalledWith(2, target, nextPath, undefined);
	});
});
