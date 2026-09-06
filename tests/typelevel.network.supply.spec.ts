import { describe, expect, it } from "vitest";
import type { NetworkResource, NetworkSupplyQuery, NetworkSupplyResponse } from "../src";

describe("network supply response selection", () => {
	it("selects JSON or text from object and DSL query types", () => {
		if (false) {
			const network = null as unknown as NetworkResource;
			const structured: Promise<NetworkSupplyResponse> = network.supply().get();
			const structuredObject: Promise<NetworkSupplyResponse> = network.supply({ timestamp: "1" }).get();
			const structuredDsl: Promise<NetworkSupplyResponse> = network.supply((q) => q.timestamp("1")).get();
			const total: Promise<string> = network.supply({ q: "ToTaLcOiNs" }).get();
			const circulating: Promise<string> = network.supply((q) => q.q("CiRcUlAtInG")).get();
			const dynamicQuery = {} as NetworkSupplyQuery;
			const dynamic: Promise<NetworkSupplyResponse | string> = network.supply(dynamicQuery).get();
			const voidDsl: Promise<NetworkSupplyResponse | string> = network
				.supply((q) => {
					q.q("totalcoins");
				})
				.get();

			// @ts-expect-error unsupported supply selectors are rejected statically
			network.supply({ q: "released" });
			void [structured, structuredObject, structuredDsl, total, circulating, dynamic, voidDsl];
		}

		expect(true).toBe(true);
	});
});
