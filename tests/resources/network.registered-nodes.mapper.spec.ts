import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { NetworkRegisteredNodesQueryBuilder } from "../../src/dsl/network";
import { NetworkMapper } from "../../src/resources/network/mapper";

describe("NetworkMapper.registeredNodes", () => {
	it("keeps object and DSL queries in parity", () => {
		const objectMapped = NetworkMapper.registeredNodes({
			registeredNodeId: "gte:40",
			type: "BLOCK_NODE",
			order: "desc",
			limit: 10,
		});
		const dslMapped = NetworkMapper.registeredNodes(
			new NetworkRegisteredNodesQueryBuilder().registeredNodeId().greaterThanOrEqualTo(40).type("BLOCK_NODE").order("desc").limit(10).build()
		);

		expect(dslMapped).toEqual(objectMapped);
		expect(objectMapped).toEqual({
			"registerednode.id": "gte:40",
			type: "BLOCK_NODE",
			order: "desc",
			limit: 10,
		});
	});

	it("accepts zero and preserves 64-bit ids supplied as decimal strings", () => {
		expect(NetworkMapper.registeredNodes({ registeredNodeId: 0 })).toEqual({ "registerednode.id": "0" });
		expect(NetworkMapper.registeredNodes({ registeredNodeId: "9223372036854775807" })).toEqual({
			"registerednode.id": "9223372036854775807",
		});
	});

	it.each(["eq", "gt", "gte", "lt", "lte"] as const)("accepts the %s comparator", (operator) => {
		expect(NetworkMapper.registeredNodes({ registeredNodeId: `${operator}:41` })).toEqual({
			"registerednode.id": `${operator}:41`,
		});
	});

	it.each(["ne:1", "gt:-1", "eq:1.5", "lt:abc", "1:2", "12345678901234567890"])("rejects invalid registered-node id %s", (registeredNodeId) => {
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId })).toThrow(ValidationError);
	});

	it("rejects unsafe numeric ids and unsupported service types", () => {
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId: Number.MAX_SAFE_INTEGER + 1 })).toThrow(ValidationError);
		expect(() => NetworkMapper.registeredNodes({ type: "CONSENSUS_NODE" as any })).toThrow(ValidationError);
	});

	it("accepts UNKNOWN and case-insensitive registered-node type filters", () => {
		expect(NetworkMapper.registeredNodes({ type: "UNKNOWN" })).toEqual({ type: "UNKNOWN" });
		expect(NetworkMapper.registeredNodes({ type: "mirror_node" })).toEqual({ type: "mirror_node" });
		expect(NetworkMapper.registeredNodes({ type: "Rpc_Relay" as any })).toEqual({ type: "Rpc_Relay" });
	});

	it("accepts order case-insensitively and preserves its spelling", () => {
		expect(NetworkMapper.registeredNodes({ order: "ASC" })).toEqual({ order: "ASC" });
		const mixed = new NetworkRegisteredNodesQueryBuilder().order("DeSc" as any).build();
		expect(NetworkMapper.registeredNodes(mixed)).toEqual({ order: "DeSc" });
		expect(() => NetworkMapper.registeredNodes({ order: "sideways" as any })).toThrow(ValidationError);
	});

	it("validates direct comparator strings in the DSL", () => {
		expect(new NetworkRegisteredNodesQueryBuilder().registeredNodeId("lte:99").build().registeredNodeId).toBe("lte:99");
		expect(() => new NetworkRegisteredNodesQueryBuilder().registeredNodeId("ne:99")).toThrow(ValidationError);
	});

	it("matches Java long-range lexical and endpoint boundary rules", () => {
		expect(NetworkMapper.registeredNodes({ registeredNodeId: "eq:+2" as any })).toEqual({ "registerednode.id": "eq:+2" });
		expect(new NetworkRegisteredNodesQueryBuilder().registeredNodeId("0000000000000000002" as any).build().registeredNodeId).toBe(
			"0000000000000000002"
		);
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId: "lt:-0" as any })).toThrow(ValidationError);
		expect(() => new NetworkRegisteredNodesQueryBuilder().registeredNodeId("gt:9223372036854775807")).toThrow(ValidationError);
	});

	it("preserves two range bounds but requires equality to stand alone", () => {
		const mapped = NetworkMapper.registeredNodes({ registeredNodeId: ["GTE:+1", "lte:0005"] });
		const built = new NetworkRegisteredNodesQueryBuilder().registeredNodeId("GTE:+1").registeredNodeId().lessThanOrEqualTo("0005").build();
		expect(mapped).toEqual({ "registerednode.id": ["GTE:+1", "lte:0005"] });
		expect(NetworkMapper.registeredNodes(built)).toEqual(mapped);
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId: ["eq:1", "gte:1"] })).toThrow(ValidationError);
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId: ["gte:1", "gte:2", "lte:3"] })).toThrow(ValidationError);
		expect(() => NetworkMapper.registeredNodes({ registeredNodeId: ["gte:5", "lte:4"] })).toThrow(ValidationError);
	});
});
