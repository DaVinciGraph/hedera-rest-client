import { describe, expect, it } from "vitest";

import { AccountsBuilder } from "../../src/resources/accounts/builder";
import type { Hook, HookStorage } from "../../src/types";
import { buildQuery } from "../../src/core/utils";
import { resolveMirrorNodeUrl } from "../../src/core/url";

class FakeResponse {
	constructor(private readonly body: unknown) {}

	async json() {
		return this.body;
	}
	async text() {
		return JSON.stringify(this.body);
	}
}

class FakeRegistry {
	readonly calls: Array<{ path: string; params: Record<string, any> | undefined; signal: AbortSignal | undefined }> = [];
	readonly responses: unknown[] = [];

	resolve(provider?: string, network?: string) {
		return {
			provider: provider ?? "public",
			network: network ?? "testnet",
			page: { defaultLimit: 25, maxLimit: 100 },
			baseUrl: "https://example.test/base",
		};
	}

	async get(_target: unknown, path: string, params?: Record<string, any>, signal?: AbortSignal) {
		this.calls.push({ path, params, signal });
		return new FakeResponse(this.responses.shift());
	}

	async getWithTarget(target: any, path: string, params?: Record<string, any>, signal?: AbortSignal) {
		const response = await this.get(target, path, params, signal);
		return {
			response,
			target,
			requestUrl: resolveMirrorNodeUrl(target.baseUrl, path, buildQuery(params ?? {})),
		};
	}
}

const hook: Hook = {
	admin_key: null,
	contract_id: "0.0.9",
	created_timestamp: "123.000000001",
	deleted: false,
	extension_point: "ACCOUNT_ALLOWANCE_HOOK",
	hook_id: "9223372036854775807",
	owner_id: "0.0.8",
	timestamp_range: { from: "123.000000001", to: null },
	type: "EVM",
};

const slot: HookStorage = {
	key: "0x01",
	timestamp: "123.000000001",
	value: null,
};

describe("AccountsBuilder hook operations", () => {
	it("builds the hook-list object request and returns a typed page", async () => {
		const registry = new FakeRegistry();
		registry.responses.push({ hooks: [hook], links: { next: null } });
		const builder = new AccountsBuilder(registry as any, "public", "testnet");

		const page = await builder
			.hooks({ idOrAliasOrEvmAddress: "0.8", hookId: "9223372036854775807", limit: "max", order: "desc" })
			.get();

		expect(registry.calls).toHaveLength(1);
		expect(registry.calls[0]).toMatchObject({
			path: "/api/v1/accounts/0.8/hooks",
			params: { "hook.id": "9223372036854775807", limit: 100, order: "desc" },
		});
		expect(page.hooks).toEqual([hook]);
		expect(page.next.url()).toBeNull();
	});

	it("supports the hook-list DSL and follows paging links", async () => {
		const registry = new FakeRegistry();
		registry.responses.push(
			{ hooks: [hook], links: { next: "/api/v1/accounts/8/hooks?hook.id=2&limit=1" } },
			{ hooks: [{ ...hook, hook_id: 2 }], links: { next: null } }
		);
		const builder = new AccountsBuilder(registry as any, "public", "testnet");

		const first = await builder.hooks((query) => query.idOrAliasOrEvmAddress("8").hookId(1).limit(1)).get();
		const second = await first.next();

		expect(registry.calls[0]).toMatchObject({ path: "/api/v1/accounts/8/hooks", params: { "hook.id": 1, limit: 1 } });
		expect(registry.calls[1].path).toBe("/api/v1/accounts/8/hooks?hook.id=2&limit=1");
		expect(second?.hooks[0].hook_id).toBe(2);
	});

	it("builds the hook-storage object request and retains response metadata", async () => {
		const registry = new FakeRegistry();
		registry.responses.push({ hook_id: "9223372036854775807", owner_id: "0.0.8", storage: [slot], links: { next: null } });
		const builder = new AccountsBuilder(registry as any, "public", "testnet");

		const page = await builder
			.hookStorage({
				idOrAliasOrEvmAddress: "0.0.8",
				hookId: "9223372036854775807",
				key: "gte:0x01",
				timestamp: ["gte:123.000000001", "lt:124"],
				limit: "default",
				order: "asc",
			})
			.get();

		expect(registry.calls[0]).toMatchObject({
			path: "/api/v1/accounts/0.0.8/hooks/9223372036854775807/storage",
			params: {
				key: "gte:0x01",
				timestamp: ["gte:123.000000001", "lt:124"],
				limit: 25,
				order: "asc",
			},
		});
		expect(page).toMatchObject({ hook_id: "9223372036854775807", owner_id: "0.0.8", storage: [slot] });
	});

	it("accepts hook id zero in the storage DSL and maps metadata on every page", async () => {
		const registry = new FakeRegistry();
		registry.responses.push(
			{ hook_id: 0, owner_id: "0.0.8", storage: [slot], links: { next: "/api/v1/accounts/0.0.8/hooks/0/storage?key=gt%3A01" } },
			{ hook_id: 0, owner_id: "0.0.8", storage: [{ ...slot, key: "0x02" }], links: { next: null } }
		);
		const builder = new AccountsBuilder(registry as any, "public", "testnet");

		const first = await builder
			.hookStorage((query) => query.idOrAliasOrEvmAddress("0.0.8").hookId(0).key().greaterThan("01").timestamp().equalTo("123").limit(1))
			.get();
		const second = await first.next();

		expect(registry.calls[0]).toMatchObject({
			path: "/api/v1/accounts/0.0.8/hooks/0/storage",
			params: { key: "gt:01", timestamp: ["eq:123"], limit: 1 },
		});
		expect(second).toMatchObject({ hook_id: 0, owner_id: "0.0.8", storage: [{ key: "0x02" }] });
	});
});
