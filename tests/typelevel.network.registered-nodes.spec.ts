import { describe, expect, expectTypeOf, it } from "vitest";

import { NetworkRegisteredNodesQueryBuilder } from "../src/dsl/network";
import type {
	NetworkRegisteredNodesQuery,
	RegisteredBlockNodeApi,
	RegisteredNodeTypeFilter,
	RegisteredNodeType,
	RegisteredNodesPage,
	RegisteredServiceEndpoint,
} from "../src/types";

describe("registered-nodes public type surface", () => {
	it("builds the public query type and exposes only supported id comparators", () => {
		const builder = new NetworkRegisteredNodesQueryBuilder();

		new NetworkRegisteredNodesQueryBuilder().registeredNodeId().equalTo(1);
		new NetworkRegisteredNodesQueryBuilder().registeredNodeId().greaterThan(2);
		new NetworkRegisteredNodesQueryBuilder().registeredNodeId().greaterThanOrEqualTo("3");
		new NetworkRegisteredNodesQueryBuilder().registeredNodeId().lessThan(4);
		new NetworkRegisteredNodesQueryBuilder().registeredNodeId().lessThanOrEqualTo("5");

		if (false) {
			// @ts-expect-error The OpenAPI parameter does not support `ne`.
			new NetworkRegisteredNodesQueryBuilder().registeredNodeId().notEqualTo(6);
		}

		const query = builder.type("MIRROR_NODE").order("asc").limit("max").build();
		expectTypeOf(query).toEqualTypeOf<NetworkRegisteredNodesQuery>();
		expect(query.type).toBe("MIRROR_NODE");
	});

	it("exports exact service-type and block-node API unions", () => {
		const serviceType: RegisteredNodeType = "RPC_RELAY";
		const blockApi: RegisteredBlockNodeApi = "SUBSCRIBE_STREAM";

		// @ts-expect-error Consensus nodes are not a registered service category.
		const unsupportedServiceType: RegisteredNodeType = "CONSENSUS_NODE";
		// @ts-expect-error Unknown block APIs are rejected.
		const unsupportedBlockApi: RegisteredBlockNodeApi = "GET_BLOCK";

		expect([serviceType, blockApi, unsupportedServiceType, unsupportedBlockApi]).toHaveLength(4);
	});

	it("keeps response service types strict while accepting server query spellings", () => {
		const unknownFilter: RegisteredNodeTypeFilter = "UNKNOWN";
		const mixedCaseFilter: RegisteredNodeTypeFilter = "MiRrOr_NoDe";
		const query = new NetworkRegisteredNodesQueryBuilder().type(mixedCaseFilter).build();

		// @ts-expect-error UNKNOWN is a query filter value, not a documented response type.
		const unknownResponseType: RegisteredNodeType = "UNKNOWN";

		expect([unknownFilter, query.type, unknownResponseType]).toEqual(["UNKNOWN", "MiRrOr_NoDe", "UNKNOWN"]);
	});

	it("requires every registered endpoint metadata slot from the response schema", () => {
		const endpoint: RegisteredServiceEndpoint = {
			block_node: null,
			domain_name: "rpc.example",
			general_service: null,
			mirror_node: null,
			port: 443,
			requires_tls: true,
			rpc_relay: {},
			type: "RPC_RELAY",
		};

		// @ts-expect-error `rpc_relay` is a required response field even for other endpoint types.
		const missingMetadata: RegisteredServiceEndpoint = {
			block_node: null,
			domain_name: "mirror.example",
			general_service: null,
			mirror_node: {},
			port: 443,
			requires_tls: true,
			type: "MIRROR_NODE",
		};

		expect(endpoint.rpc_relay).toEqual({});
		expect(missingMetadata.type).toBe("MIRROR_NODE");
	});

	it("uses the OpenAPI snake-case collection name on pages", () => {
		expectTypeOf<RegisteredNodesPage["registered_nodes"]>().toBeArray();
		expectTypeOf<ReturnType<RegisteredNodesPage["next"]["url"]>>().toEqualTypeOf<string | null>();
		expect(true).toBe(true);
	});
});
