// tests/resources/network.mapper-parity.spec.ts
import { describe, it, expect } from "vitest";
import { NetworkMapper } from "../../src/resources/network/mapper";
import { NetworkSupplyQueryBuilder, NetworkFeesQueryBuilder, NetworkExchangeRateQueryBuilder, NetworkNodesQueryBuilder } from "../../src/dsl/network";
import { ValidationError } from "../../src/core/errors";

describe("NetworkMapper — parity (object vs DSL)", () => {
	it.each([
		{
			endpoint: "supply",
			map: (timestamp: string) => NetworkMapper.supply({ timestamp }),
			direct: (timestamp: string) => new NetworkSupplyQueryBuilder().timestamp(timestamp).build(),
			fluent: (timestamp: string) => new NetworkSupplyQueryBuilder().timestamp().equalTo(timestamp).build(),
		},
		{
			endpoint: "fees",
			map: (timestamp: string) => NetworkMapper.fees({ timestamp }),
			direct: (timestamp: string) => new NetworkFeesQueryBuilder().timestamp(timestamp).build(),
			fluent: (timestamp: string) => new NetworkFeesQueryBuilder().timestamp().equalTo(timestamp).build(),
		},
		{
			endpoint: "exchange rate",
			map: (timestamp: string) => NetworkMapper.exchangeRate({ timestamp }),
			direct: (timestamp: string) => new NetworkExchangeRateQueryBuilder().timestamp(timestamp).build(),
			fluent: (timestamp: string) => new NetworkExchangeRateQueryBuilder().timestamp().equalTo(timestamp).build(),
		},
	])("$endpoint: applies rest-java raw-nanosecond boundaries in object and DSL forms", ({ map, direct, fluent }) => {
		for (const timestamp of ["9223372036.9", "9223372036.85477581"]) {
			expect(() => map(timestamp)).not.toThrow();
			expect(() => direct(timestamp)).not.toThrow();
			expect(() => fluent(timestamp)).not.toThrow();
		}

		const overflow = "9223372036.854775808";
		expect(() => map(overflow)).toThrow(ValidationError);
		expect(() => direct(overflow)).toThrow(ValidationError);
		expect(() => fluent(overflow)).toThrow(ValidationError);
	});

	/* ---------------------
     /network/supply
     --------------------- */
	it("supply: no timestamp, cacheKey is empty suffix", () => {
		const obj = undefined;
		const mapObj = NetworkMapper.supply(obj);

		const dsl = new NetworkSupplyQueryBuilder().build();
		const mapDsl = NetworkMapper.supply(dsl);

		expect(mapObj).toEqual({ params: {}, cacheKey: "network:supply:" });
		expect(mapDsl).toEqual(mapObj);
	});

	it("supply: timestamp comparator (gte) parity", () => {
		const obj = { timestamp: "gte:1700000000" } as any;
		const mapObj = NetworkMapper.supply(obj);

		const dsl = new NetworkSupplyQueryBuilder().timestamp().greaterThanOrEqualTo(1700000000).build();
		const mapDsl = NetworkMapper.supply(dsl);

		expect(mapObj).toEqual({
			params: { timestamp: "gte:1700000000" },
			cacheKey: "network:supply:gte:1700000000",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("supply: preserves repeated timestamp filters and includes all of them in the cache key", () => {
		const obj = { timestamp: ["gte:1700000000", "lt:1700003600"] } as const;
		const mapObj = NetworkMapper.supply(obj);

		const dsl = new NetworkSupplyQueryBuilder().timestamp().greaterThanOrEqualTo(1700000000).timestamp().lessThan(1700003600).build();
		const mapDsl = NetworkMapper.supply(dsl);

		expect(mapObj).toEqual({
			params: { timestamp: ["gte:1700000000", "lt:1700003600"] },
			cacheKey: "network:supply:gte:1700000000,lt:1700003600",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("supply: uses the rest-java timestamp parser and two-value cap", () => {
		expect(NetworkMapper.supply({ timestamp: "GTE:00000000000000001.9" })).toEqual({
			params: { timestamp: "GTE:00000000000000001.9" },
			cacheKey: "network:supply:GTE:00000000000000001.9",
		});
		expect(() => NetworkMapper.supply({ timestamp: "9999999999" })).toThrow(ValidationError);
		expect(() => NetworkMapper.supply({ timestamp: ["gte:1", "lte:2", "eq:1"] })).toThrow(ValidationError);
	});

	it.each(["totalcoins", "TOTALCOINS", "ToTaLcOiNs", "circulating", "CIRCULATING", "CiRcUlAtInG"])(
		"supply: accepts q=%s case-insensitively and keeps cache identity canonical",
		(q) => {
			const objectMapped = NetworkMapper.supply({ q } as any);
			const dslMapped = NetworkMapper.supply(new NetworkSupplyQueryBuilder().q(q as any).build());
			const canonical = q.toLowerCase();

			expect(objectMapped).toEqual({ params: { q }, cacheKey: `network:supply::q=${canonical}` });
			expect(dslMapped).toEqual(objectMapped);
		}
	);

	it("supply: includes q and every timestamp in cache identity", () => {
		expect(NetworkMapper.supply({ timestamp: ["gte:1", "lte:2"], q: "CIRCULATING" })).toEqual({
			params: { timestamp: ["gte:1", "lte:2"], q: "CIRCULATING" },
			cacheKey: "network:supply:gte:1,lte:2:q=circulating",
		});
	});

	it.each(["total", "released", "totalcoins ", "", null, 1])("supply: rejects invalid q value %j", (q) => {
		expect(() => NetworkMapper.supply({ q } as any)).toThrow(ValidationError);
		expect(() => new NetworkSupplyQueryBuilder().q(q as any)).toThrow(ValidationError);
	});

	/* ---------------------
     /network/exchangerate
     --------------------- */
	it("exchangeRate: exact timestamp parity", () => {
		const obj = { timestamp: "1700000001.123456789" } as any;
		const mapObj = NetworkMapper.exchangeRate(obj);

		const dsl = new NetworkExchangeRateQueryBuilder().timestamp("1700000001.123456789").build();
		const mapDsl = NetworkMapper.exchangeRate(dsl);

		expect(mapObj).toEqual({
			params: { timestamp: "1700000001.123456789" },
			cacheKey: "network:exchangerate:1700000001.123456789",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("exchangeRate: comparator as DSL parity", () => {
		const obj = { timestamp: "lt:1700000050" } as any;
		const mapObj = NetworkMapper.exchangeRate(obj);

		const dsl = new NetworkExchangeRateQueryBuilder().timestamp().lessThan(1700000050).build();
		const mapDsl = NetworkMapper.exchangeRate(dsl);

		expect(mapObj).toEqual({
			params: { timestamp: "lt:1700000050" },
			cacheKey: "network:exchangerate:lt:1700000050",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("exchangeRate: preserves repeated timestamp filters", () => {
		const obj = { timestamp: ["gt:1700000000", "lte:1700003600"] } as const;
		const mapObj = NetworkMapper.exchangeRate(obj);

		const dsl = new NetworkExchangeRateQueryBuilder().timestamp().greaterThan(1700000000).timestamp().lessThanOrEqualTo(1700003600).build();
		const mapDsl = NetworkMapper.exchangeRate(dsl);

		expect(mapObj).toEqual({
			params: { timestamp: ["gt:1700000000", "lte:1700003600"] },
			cacheKey: "network:exchangerate:gt:1700000000,lte:1700003600",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	/* ---------------------
     /network/fees
     --------------------- */
	it("fees: multiple timestamp filters + order parity", () => {
		const obj = {
			timestamp: ["gte:1700000000", "lte:1700003600"],
			order: "desc",
		} as any;
		const mapObj = NetworkMapper.fees(obj);

		const dsl = new NetworkFeesQueryBuilder().timestamp().greaterThanOrEqualTo(1700000000).timestamp().lessThanOrEqualTo(1700003600).order("desc").build();
		const mapDsl = NetworkMapper.fees(dsl);

		expect(mapObj).toEqual({
			timestamp: ["gte:1700000000", "lte:1700003600"],
			order: "desc",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("fees: single exact timestamp parity", () => {
		const obj = {
			timestamp: "1700000002.0001",
		} as any;
		const mapObj = NetworkMapper.fees(obj);

		const dsl = new NetworkFeesQueryBuilder().timestamp("1700000002.0001").build();
		const mapDsl = NetworkMapper.fees(dsl);

		expect(mapObj).toEqual({
			timestamp: ["1700000002.0001"],
		});
		expect(mapDsl).toEqual(mapObj);
	});

	/* ---------------------
     /network/nodes
     --------------------- */
	it("nodes: plain file.id and int node.id parity", () => {
		const obj = {
			fileId: "0.0.102",
			nodeId: 0, // node 0 is valid
			order: "asc",
			limit: 10,
		} as any;
		const mapObj = NetworkMapper.nodes(obj);

		const dsl = new NetworkNodesQueryBuilder().fileId("0.0.102").nodeId(0).order("asc").limit(10).build();
		const mapDsl = NetworkMapper.nodes(dsl);

		expect(mapObj).toEqual({
			"file.id": "0.0.102",
			"node.id": "0",
			order: "asc",
			limit: 10,
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("nodes: equality-only file.id + comparator node.id parity", () => {
		const obj = {
			fileId: "eq:0.0.80",
			nodeId: "gte:2",
			order: "desc",
			limit: 5,
		} as any;
		const mapObj = NetworkMapper.nodes(obj);

		const dsl = new NetworkNodesQueryBuilder().fileId().equalTo("0.0.80").nodeId().greaterThanOrEqualTo(2).order("desc").limit(5).build();
		const mapDsl = NetworkMapper.nodes(dsl);

		expect(mapObj).toEqual({
			"file.id": "eq:0.0.80",
			"node.id": "gte:2",
			order: "desc",
			limit: 5,
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("nodes: reject non-equality fileId comparators", () => {
		expect(() => NetworkMapper.nodes({ fileId: "ne:0.0.80" } as any)).toThrow(ValidationError);
		expect(() => (new NetworkNodesQueryBuilder().fileId() as any).notEqualTo("0.0.80")).toThrow(ValidationError);
	});

	it("nodes: keeps Java range spellings and packed bounds in object/DSL parity", () => {
		const fileId = "eq:0000000000000000000000000102";
		expect(NetworkMapper.nodes({ fileId })).toEqual({ "file.id": fileId });
		expect(new NetworkNodesQueryBuilder().fileId().equalTo("0000000000000000000000000102").build().fileId).toBe(fileId);
		expect(() => NetworkMapper.nodes({ fileId: "eq:512.0.0" })).toThrow(ValidationError);
		expect(() => new NetworkNodesQueryBuilder().fileId().equalTo("512.0.0")).toThrow(ValidationError);
	});

	it("nodes: preserves up to 100 repeated ID bounds", () => {
		const mapped = NetworkMapper.nodes({ nodeId: ["GTE:+1", "lte:0005"] });
		const built = new NetworkNodesQueryBuilder().nodeId("GTE:+1").nodeId().lessThanOrEqualTo("0005").build();
		expect(mapped).toEqual({ "node.id": ["GTE:+1", "lte:0005"] });
		expect(NetworkMapper.nodes(built)).toEqual(mapped);
		expect(NetworkMapper.nodes({ nodeId: ["eq:1", "eq:2"] })).toEqual({ "node.id": ["eq:1", "eq:2"] });
		expect(() => NetworkMapper.nodes({ nodeId: Array.from({ length: 101 }, () => "gte:1") })).toThrow(ValidationError);
		expect(() => NetworkMapper.nodes({ nodeId: ["gte:5", "lte:4"] })).toThrow(ValidationError);
	});

	it("nodes: reject nodeId with 'ne' comparator", () => {
		const obj = { nodeId: "ne:1" } as any;
		expect(() => NetworkMapper.nodes(obj)).toThrow(ValidationError);

		expect(() => (new NetworkNodesQueryBuilder().nodeId() as any).notEqualTo(1)).toThrow(ValidationError);
	});

	it("nodes: reject non-integer comparator for nodeId", () => {
		const obj = { nodeId: "lt:abc" } as any;
		expect(() => NetworkMapper.nodes(obj)).toThrow(ValidationError);

		expect(() => new NetworkNodesQueryBuilder().nodeId().lessThan("abc" as any)).toThrow(ValidationError);
	});

	it("nodes: follows Java long-range signs and boundary conversion", () => {
		expect(NetworkMapper.nodes({ nodeId: "gte:+2" as any })).toEqual({ "node.id": "gte:+2" });
		expect(new NetworkNodesQueryBuilder().nodeId("-0" as any).build().nodeId).toBe("-0");
		expect(() => NetworkMapper.nodes({ nodeId: "lt:0" })).toThrow(ValidationError);
		expect(() => new NetworkNodesQueryBuilder().nodeId().lessThan(0)).toThrow(ValidationError);
		expect(() => NetworkMapper.nodes({ nodeId: "gt:9223372036854775807" })).toThrow(ValidationError);
	});
});
