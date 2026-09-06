import { describe, expect, it, vi } from "vitest";
import { TokensBuilder } from "../../src/resources/tokens/builder";
import { TopicsBuilder } from "../../src/resources/topics/builder";
import { TransactionsBuilder } from "../../src/resources/transactions/builder";

function makeRegistry() {
	const target = {
		provider: "public",
		network: "testnet",
		baseUrl: "https://testnet.mirror.test",
		page: { defaultLimit: 25, maxLimit: 100 },
	};
	return {
		resolve: vi.fn(() => target),
		get: vi.fn(async () => ({ text: async () => "{}", json: async () => ({}) })),
		getLogger: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })),
	};
}

function makeCache() {
	return {
		enabled: true,
		ttlSeconds: 60,
		get: vi.fn(async () => ({ source: "cache" })),
		set: vi.fn(async () => undefined),
	};
}

describe("singular operation query snapshots", () => {
	it.each([
		{
			name: "tokens.one",
			create: (registry: any, cache: any) => {
				const query = { tokenId: "0.0.1", useCache: false };
				const operation = new TokensBuilder(registry, "public", "testnet", { token: cache }).one(query);
				return { query, operation, mutate: () => (query.tokenId = "0.0.2"), expectedPath: "/api/v1/tokens/0.0.1" };
			},
		},
		{
			name: "tokens.nft",
			create: (registry: any, cache: any) => {
				const query = { tokenId: "0.0.1", serialNumber: 1, useCache: false };
				const operation = new TokensBuilder(registry, "public", "testnet", { nft: cache }).nft(query);
				return { query, operation, mutate: () => (query.serialNumber = 2), expectedPath: "/api/v1/tokens/0.0.1/nfts/1" };
			},
		},
		{
			name: "topics.one",
			create: (registry: any, cache: any) => {
				const query = { topicId: "0.0.1", useCache: false };
				const operation = new TopicsBuilder(registry, "public", "testnet", { topic: cache }).one(query);
				return { query, operation, mutate: () => (query.topicId = "0.0.2"), expectedPath: "/api/v1/topics/0.0.1" };
			},
		},
		{
			name: "topics.messageBySequence",
			create: (registry: any, cache: any) => {
				const query = { topicId: "0.0.1", sequenceNumber: 1, useCache: false };
				const operation = new TopicsBuilder(registry, "public", "testnet", { message: cache }).messageBySequence(query);
				return { query, operation, mutate: () => (query.sequenceNumber = 2), expectedPath: "/api/v1/topics/0.0.1/messages/1" };
			},
		},
		{
			name: "topics.messageByTimestamp",
			create: (registry: any, cache: any) => {
				const query = { timestamp: "1.000000001", useCache: false };
				const operation = new TopicsBuilder(registry, "public", "testnet", { message: cache }).messageByTimestamp(query);
				return { query, operation, mutate: () => (query.timestamp = "2.000000002"), expectedPath: "/api/v1/topics/messages/1.000000001" };
			},
		},
		{
			name: "transactions.byId",
			create: (registry: any, cache: any) => {
				const query = { transactionId: "0.0.1-1-1", useCache: false };
				const operation = new TransactionsBuilder(registry, "public", "testnet", { one: cache }).byId(query);
				return { query, operation, mutate: () => (query.transactionId = "0.0.2-2-2"), expectedPath: "/api/v1/transactions/0.0.1-1-1" };
			},
		},
	])("$name keeps cache permission in the same snapshot as request identity", async ({ create }) => {
		const registry = makeRegistry();
		const cache = makeCache();
		const { query, operation, mutate, expectedPath } = create(registry, cache);

		mutate();
		query.useCache = true;
		await operation.get();

		expect(cache.get).not.toHaveBeenCalled();
		expect(registry.get).toHaveBeenCalledOnce();
		expect(registry.get.mock.calls[0]?.[1]).toBe(expectedPath);
	});
});
