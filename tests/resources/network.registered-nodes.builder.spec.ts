import { describe, expect, it, vi } from "vitest";

import { NetworkBuilder } from "../../src/resources/network/builder";
import type { RegisteredNode, RegisteredNodesResponse } from "../../src/types";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

const registeredNode: RegisteredNode = {
	admin_key: {
		_type: "ED25519",
		key: "48caca4a3407c3563a8656d061fa1dfbb7c7be79b4cbb7d03358f6cf7c347b95",
	},
	created_timestamp: "1787154615.427479104",
	description: "Registered services",
	registered_node_id: 41,
	service_endpoints: [
		{
			block_node: { endpoint_apis: ["OTHER", "STATUS", "PUBLISH", "SUBSCRIBE_STREAM", "STATE_PROOF", "UNRECOGNIZED"] },
			domain_name: null,
			general_service: null,
			ip_address: "192.0.2.1",
			mirror_node: null,
			port: 40980,
			requires_tls: false,
			rpc_relay: null,
			type: "BLOCK_NODE",
		},
		{
			block_node: null,
			domain_name: "general.example",
			general_service: { description: "General service metadata" },
			ip_address: null,
			mirror_node: null,
			port: 443,
			requires_tls: true,
			rpc_relay: null,
			type: "GENERAL_SERVICE",
		},
		{
			block_node: null,
			domain_name: "mirror.example",
			general_service: null,
			ip_address: null,
			mirror_node: {},
			port: 443,
			requires_tls: true,
			rpc_relay: null,
			type: "MIRROR_NODE",
		},
		{
			block_node: null,
			domain_name: "rpc.example",
			general_service: null,
			ip_address: null,
			mirror_node: null,
			port: 443,
			requires_tls: true,
			rpc_relay: {},
			type: "RPC_RELAY",
		},
	],
	timestamp: { from: "1787154615.427479104", to: null },
};

describe("NetworkBuilder.registeredNodes", () => {
	it("maps filters, resolves limits, and follows links.next as a typed page", async () => {
		const first: RegisteredNodesResponse = {
			registered_nodes: [registeredNode],
			links: { next: "/api/v1/network/registered-nodes?limit=50&registerednode.id=gt%3A41" },
		};
		const second: RegisteredNodesResponse = {
			registered_nodes: [{ ...registeredNode, registered_node_id: "42" }],
			links: { next: null },
		};
		const target = {
			provider: "public",
			network: "mainnet",
			baseUrl: "https://mainnet.mirrornode.hedera.com",
			page: { defaultLimit: 25, maxLimit: 50 },
		};
		const get = vi.fn(async (_target: unknown, path: string) => ({
			json: async () => (path === "/api/v1/network/registered-nodes" ? first : second),
			text: async () => JSON.stringify(path === "/api/v1/network/registered-nodes" ? first : second),
		}));
		const registry = {
			resolve: vi.fn(() => target),
			get,
			getLogger: vi.fn(() => ({ debug: vi.fn() })),
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
		const builder = new NetworkBuilder(registry as any, "public", "mainnet");

		const page = await builder
			.registeredNodes((query) => query.registeredNodeId().greaterThanOrEqualTo(40).type("BLOCK_NODE").order("desc").limit("max"))
			.get();

		expect(get).toHaveBeenNthCalledWith(
			1,
			target,
			"/api/v1/network/registered-nodes",
			{ "registerednode.id": "gte:40", type: "BLOCK_NODE", order: "desc", limit: 50 }
		);
		expect(page.registered_nodes).toEqual([registeredNode]);
		expect(page.next.url()).toBe("https://mainnet.mirrornode.hedera.com/api/v1/network/registered-nodes?limit=50&registerednode.id=gt%3A41");

		const controller = new AbortController();
		const next = await page.next({ signal: controller.signal });
		expect(get).toHaveBeenNthCalledWith(
			2,
			target,
			"/api/v1/network/registered-nodes?limit=50&registerednode.id=gt%3A41",
			undefined,
			controller.signal
		);
		expect(next?.registered_nodes[0].registered_node_id).toBe("42");
		expect(next?.next.url()).toBeNull();
		expect(await next?.next()).toBeNull();
	});

	it("supports the object form and resolves the provider default limit", async () => {
		const raw: RegisteredNodesResponse = { registered_nodes: [], links: { next: null } };
		const target = {
			provider: "custom",
			network: "testnet",
			baseUrl: "https://mirror.example",
			page: { defaultLimit: 37, maxLimit: 100 },
		};
		const get = vi.fn(async () => ({ json: async () => raw, text: async () => JSON.stringify(raw) }));
		const registry = {
			resolve: vi.fn(() => target),
			get,
			getLogger: vi.fn(() => ({ debug: vi.fn() })),
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

		const page = await new NetworkBuilder(registry as any, "custom", "testnet")
			.registeredNodes({ registeredNodeId: "lte:99", type: "RPC_RELAY", limit: "default" })
			.get();

		expect(get).toHaveBeenCalledWith(target, "/api/v1/network/registered-nodes", {
			"registerednode.id": "lte:99",
			type: "RPC_RELAY",
			limit: 37,
		});
		expect(page.registered_nodes).toEqual([]);
		expect(page.next.url()).toBeNull();
	});
});
