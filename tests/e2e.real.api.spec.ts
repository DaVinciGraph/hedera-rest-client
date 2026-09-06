import { describe, it, expect } from "vitest";
import { HederaRestClient } from "../src/HederaRestClient";

/**
 * End-to-End tests against the ACTUAL Hedera testnet public mirror node.
 * These tests verify that all endpoints work correctly with real API responses.
 *
 * NOTE: These tests make real network requests and may be slower.
 * They are designed to give confidence that the package works correctly for end users.
 */
describe("E2E: Real API Tests (Testnet Public Mirror Node)", () => {
	const client = new HederaRestClient({
		defaultProvider: "public",
		defaultNetwork: "testnet",
		log: false,
		switchProviderWhenOverflow: false,
		switchProviderOnFailure: false,
		provider: {
			public: {
				testnet: {
					url: "https://testnet.mirrornode.hedera.com",
					http: {
						retry: {
							enabled: true,
							maxAttempts: 3,
							initialDelayMs: 500,
							maxDelayMs: 5000,
							on404: false,
							on429: true,
							on5xx: true,
							onNetworkError: true,
						},
					},
				},
			},
		},
	});

	describe("Accounts Endpoints", () => {
		it("should fetch list of accounts and get one by ID", async () => {
			// First fetch list of accounts
			const listResult = await client.accounts().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.accounts).toBeDefined();
			expect(Array.isArray(listResult.accounts)).toBe(true);
			expect(listResult.accounts.length).toBeGreaterThan(0);
			expect(listResult.accounts.length).toBeLessThanOrEqual(5);

			// Get first account ID
			const accountId = listResult.accounts[0].account;
			expect(accountId).toMatch(/^\d+\.\d+\.\d+$/);

			// Fetch single account by ID
			const singleResult = await client.accounts().one({ idOrAliasOrEvmAddress: accountId }).get();
			expect(singleResult).not.toBeNull();
			expect(singleResult!.account).toBe(accountId);
			expect(singleResult!.balance).toBeDefined();

			// Fetch account tokens
			const tokensResult = await client.accounts().tokens({ idOrAliasOrEvmAddress: accountId, limit: 5 }).get();
			expect(tokensResult).toBeDefined();
			expect(tokensResult.tokens).toBeDefined();
			expect(Array.isArray(tokensResult.tokens)).toBe(true);

			// Fetch account NFTs
			const nftsResult = await client.accounts().nfts({ idOrAliasOrEvmAddress: accountId, limit: 5 }).get();
			expect(nftsResult).toBeDefined();
			expect(nftsResult.nfts).toBeDefined();
			expect(Array.isArray(nftsResult.nfts)).toBe(true);
		}, 30000);

		it("should return null for non-existent account", async () => {
			const result = await client.accounts().one({ idOrAliasOrEvmAddress: "0.0.0" }).get();

			expect(result).toBeNull();
		}, 30000);
	});

	describe("Transactions Endpoints", () => {
		it("should fetch list of transactions and get one by ID", async () => {
			// Fetch list of transactions
			const listResult = await client.transactions().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.transactions).toBeDefined();
			expect(Array.isArray(listResult.transactions)).toBe(true);
			expect(listResult.transactions.length).toBeGreaterThan(0);
			expect(listResult.transactions.length).toBeLessThanOrEqual(5);

			// Get first transaction ID
			const transactionId = listResult.transactions[0].transaction_id;
			expect(transactionId).toBeDefined();

			// Fetch single transaction by ID
			const singleResult = await client.transactions().byId({ transactionId }).get();
			expect(singleResult).not.toBeNull();
			expect(singleResult!.transactions).toBeDefined();
			expect(Array.isArray(singleResult!.transactions)).toBe(true);
			expect(singleResult!.transactions.length).toBeGreaterThan(0);
			expect(singleResult!.transactions[0].transaction_id).toBe(transactionId);
		}, 30000);

		it("should return empty transactions array for non-existent transaction", async () => {
			const result = await client.transactions().byId({ transactionId: "0.0.1-1234567890-999999999" }).get();

			// Non-existent transactions return { transactions: [] }
			expect(result).not.toBeNull();
			expect(result!.transactions).toBeDefined();
			expect(result!.transactions).toEqual([]);
		}, 30000);
	});

	describe("Blocks Endpoints", () => {
		it("should fetch list of blocks and get one by number", async () => {
			// Fetch list of blocks
			const listResult = await client.blocks().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.blocks).toBeDefined();
			expect(Array.isArray(listResult.blocks)).toBe(true);
			expect(listResult.blocks.length).toBeGreaterThan(0);
			expect(listResult.blocks.length).toBeLessThanOrEqual(5);

			// Get first block number
			const blockNumber = listResult.blocks[0].number;
			expect(typeof blockNumber).toBe("number");
			expect(blockNumber).toBeGreaterThan(0);

			// Fetch single block by number (need to convert to string)
			const singleResult = await client
				.blocks()
				.one({ hashOrNumber: String(blockNumber) })
				.get();
			expect(singleResult).not.toBeNull();
			expect(singleResult!.number).toBe(blockNumber);
			expect(singleResult!.timestamp).toBeDefined();
			expect(singleResult!.hash).toBeDefined();
		}, 30000);

		it("should return null for non-existent block", async () => {
			const result = await client.blocks().one({ hashOrNumber: "999999999" }).get();

			expect(result).toBeNull();
		}, 30000);
	});

	describe("Tokens Endpoints", () => {
		it("should fetch list of tokens and get one by ID", async () => {
			// Fetch list of tokens
			const listResult = await client.tokens().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.tokens).toBeDefined();
			expect(Array.isArray(listResult.tokens)).toBe(true);
			expect(listResult.tokens.length).toBeGreaterThan(0);
			expect(listResult.tokens.length).toBeLessThanOrEqual(5);

			// Get first token ID
			const tokenId = listResult.tokens[0].token_id;
			expect(tokenId).toMatch(/^\d+\.\d+\.\d+$/);

			// Fetch single token by ID
			const singleResult = await client.tokens().one({ tokenId }).get();
			expect(singleResult).not.toBeNull();
			expect(singleResult!.token_id).toBe(tokenId);
			expect(singleResult!.name).toBeDefined();
			expect(singleResult!.symbol).toBeDefined();

			// Fetch token balances
			const balancesResult = await client.tokens().balances({ tokenId, limit: 5 }).get();
			expect(balancesResult).toBeDefined();
			expect(balancesResult.balances).toBeDefined();
			expect(Array.isArray(balancesResult.balances)).toBe(true);
		}, 30000);

		it("should return null for non-existent token", async () => {
			const result = await client.tokens().one({ tokenId: "0.0.99999999" }).get();

			expect(result).toBeNull();
		}, 30000);
	});

	describe("Topics Endpoints", () => {
		it("should fetch topic messages for a topic", async () => {
			// Use a well-known testnet topic (Hedera Improvement Proposal topic)
			const topicId = "0.0.7";

			// Fetch topic messages
			const messagesResult = await client.topics().messages({ topicId, encoding: "utf8", limit: 5 }).get();
			expect(messagesResult).toBeDefined();
			expect(messagesResult.messages).toBeDefined();
			expect(Array.isArray(messagesResult.messages)).toBe(true);
		}, 30000);

		it("should return null for non-existent topic", async () => {
			const result = await client.topics().one({ topicId: "0.0.99999999" }).get();

			expect(result).toBeNull();
		}, 30000);
	});

	describe("Schedules Endpoints", () => {
		it("should fetch list of schedules and get one if available", async () => {
			// Fetch list of schedules
			const listResult = await client.schedules().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.schedules).toBeDefined();
			expect(Array.isArray(listResult.schedules)).toBe(true);

			// Only test singular if we have a schedule with a valid ID
			if (listResult.schedules.length > 0) {
				const scheduleId = listResult.schedules[0].schedule_id;
				if (scheduleId) {
					expect(scheduleId).toMatch(/^\d+\.\d+\.\d+$/);

					// Fetch single schedule
					const singleResult = await client.schedules().one({ scheduleId }).get();
					expect(singleResult).not.toBeNull();
					expect(singleResult!.schedule_id).toBe(scheduleId);
				}
			}
		}, 30000);

		it("should return null for non-existent schedule", async () => {
			const result = await client.schedules().one({ scheduleId: "0.0.99999999" }).get();

			expect(result).toBeNull();
		}, 30000);
	});

	describe("Contracts Endpoints", () => {
		it("should fetch list of contracts and get one if available", async () => {
			// Fetch list of contracts
			const listResult = await client.contracts().list({ limit: 5 }).get();

			expect(listResult).toBeDefined();
			expect(listResult.contracts).toBeDefined();
			expect(Array.isArray(listResult.contracts)).toBe(true);

			// Only test singular if we have a contract
			if (listResult.contracts.length > 0) {
				const contractId = listResult.contracts[0].contract_id;
				expect(contractId).toMatch(/^\d+\.\d+\.\d+$/);

				// Fetch single contract
				const singleResult = await client.contracts().one({ idOrAddress: contractId }).get();
				expect(singleResult).not.toBeNull();
				expect(singleResult!.contract_id).toBe(contractId);
			}
		}, 30000);

		it("should return null for non-existent contract", async () => {
			const result = await client.contracts().one({ idOrAddress: "0.0.99999999" }).get();

			expect(result).toBeNull();
		}, 30000);

		it("should fetch contract results and logs for a known contract", async () => {
			// Use a well-known testnet contract (system contract)
			const knownContractId = "0.0.359";

			// Fetch contract results
			const resultsResponse = await client.contracts().results({ idOrAddress: knownContractId, limit: 5 }).get();
			expect(resultsResponse).toBeDefined();
			expect(resultsResponse.results).toBeDefined();
			expect(Array.isArray(resultsResponse.results)).toBe(true);

			// Fetch contract logs
			const logsResponse = await client.contracts().logs({ idOrAddress: knownContractId, limit: 5 }).get();
			expect(logsResponse).toBeDefined();
			expect(logsResponse.logs).toBeDefined();
			expect(Array.isArray(logsResponse.logs)).toBe(true);
		}, 30000);
	});

	describe("Balances Endpoints", () => {
		it("should fetch list of balances", async () => {
			const result = await client.balances().list({ limit: 5 }).get();

			expect(result).toBeDefined();
			expect(result.balances).toBeDefined();
			expect(Array.isArray(result.balances)).toBe(true);
			expect(result.balances.length).toBeGreaterThan(0);
			expect(result.balances.length).toBeLessThanOrEqual(5);
			expect(result.timestamp).toBeDefined();
		}, 30000);
	});

	describe("Network Endpoints", () => {
		it("should fetch network supply", async () => {
			const result = await client.network().supply().get();

			expect(result).toBeDefined();
			expect(result.released_supply).toBeDefined();
			expect(result.total_supply).toBeDefined();
			expect(typeof result.released_supply).toBe("string");
			expect(typeof result.total_supply).toBe("string");
		}, 30000);

		it("should fetch scalar network supply modes as decimal strings", async () => {
			const total = await client.network().supply({ q: "totalcoins" }).get();
			const circulating = await client.network().supply((q) => q.q("CIRCULATING")).get();

			expect(total).toMatch(/^\d+\.\d{8}$/);
			expect(circulating).toMatch(/^\d+\.\d{8}$/);
		}, 30000);

		it("should fetch network exchangerate", async () => {
			const result = await client.network().exchangeRate().get();

			expect(result).toBeDefined();
			expect(result.current_rate).toBeDefined();
			expect(result.current_rate.cent_equivalent).toBeGreaterThan(0);
			expect(result.current_rate.hbar_equivalent).toBeGreaterThan(0);
		}, 30000);

		it("should fetch network fees", async () => {
			const result = await client.network().fees().get();

			expect(result).toBeDefined();
			expect(result.fees).toBeDefined();
			expect(Array.isArray(result.fees)).toBe(true);
			expect(result.fees.length).toBeGreaterThan(0);
		}, 30000);

		it("should estimate fees from one protobuf Transaction", async () => {
			// A deterministic, unsigned proto.Transaction. This endpoint estimates
			// only; it does not submit or mutate network state.
			const transaction = Uint8Array.from(
				Buffer.from(
					"KlAKTAoVCggI0oXYzAQQARIHCAAQABjpBxgAEgYIABAAGAMYgMLXLyICCHgyAHIgCh4KDQoHCAAQABjpBxABGAAKDQoHCAAQABjqBxACGAASAA==",
					"base64"
				)
			);

			const result = await client.network().estimateFees({ transaction, mode: "INTRINSIC" }).get();

			expect(Number(result.high_volume_multiplier)).toBeGreaterThanOrEqual(1);
			expect(Number(result.network.subtotal)).toBeGreaterThanOrEqual(0);
			expect(Number(result.node.base)).toBeGreaterThanOrEqual(0);
			expect(Array.isArray(result.node.extras)).toBe(true);
			expect(Number(result.service.base)).toBeGreaterThanOrEqual(0);
			expect(Array.isArray(result.service.extras)).toBe(true);
			expect(Number(result.total)).toBeGreaterThanOrEqual(0);
		}, 30000);

		it("should fetch the registered-node collection", async () => {
			const result = await client.network().registeredNodes({ limit: 1 }).get();

			expect(Array.isArray(result.registered_nodes)).toBe(true);
			expect(result.registered_nodes.length).toBeLessThanOrEqual(1);
			const nextUrl = result.next.url();
			expect(nextUrl === null || typeof nextUrl === "string").toBe(true);
		}, 30000);

		it("should fetch network stake", async () => {
			const result = await client.network().stake().get();

			expect(result).toBeDefined();
			expect(result.max_staking_reward_rate_per_hbar).toBeDefined();
			expect(result.node_reward_fee_fraction).toBeDefined();
		}, 30000);

		it("should fetch network nodes", async () => {
			const result = await client.network().nodes({ limit: 5 }).get();

			expect(result).toBeDefined();
			expect(result.nodes).toBeDefined();
			expect(Array.isArray(result.nodes)).toBe(true);
			expect(result.nodes.length).toBeGreaterThan(0);
			expect(result.nodes.length).toBeLessThanOrEqual(5);
		}, 30000);
	});

	describe("Caching with Real API", () => {
		it("should cache a token and retrieve from cache on second call", async () => {
			// First fetch a token list to get a valid token ID
			const listResult = await client.tokens().list({ limit: 1 }).get();
			expect(listResult.tokens.length).toBeGreaterThan(0);
			const tokenId = listResult.tokens[0].token_id;

			// First call - should hit the API
			const result1 = await client.tokens().one({ tokenId, useCache: true }).get();
			expect(result1).not.toBeNull();
			const symbol1 = result1!.symbol;

			// Second call - should retrieve from cache (no API call)
			const result2 = await client.tokens().one({ tokenId, useCache: true }).get();
			expect(result2).not.toBeNull();
			expect(result2!.symbol).toBe(symbol1);
			expect(result2!.token_id).toBe(tokenId);
		}, 30000);

		it("should bypass cached reads when useCache is false", async () => {
			// Fetch a token list to get a valid token ID
			const listResult = await client.tokens().list({ limit: 1 }).get();
			expect(listResult.tokens.length).toBeGreaterThan(0);
			const tokenId = listResult.tokens[0].token_id;

			// Call with useCache: false - should always hit the API
			const result1 = await client.tokens().one({ tokenId, useCache: false }).get();
			expect(result1).not.toBeNull();

			const result2 = await client.tokens().one({ tokenId, useCache: false }).get();
			expect(result2).not.toBeNull();
			expect(result2!.token_id).toBe(tokenId);
		}, 30000);
	});

	describe("Pagination with Real API", () => {
		it("should paginate through accounts using next function", async () => {
			const page1 = await client.accounts().list({ limit: 2 }).get();

			expect(page1.accounts.length).toBeLessThanOrEqual(2);

			// Check if next URL is available
			const nextUrl = page1.next.url();
			if (nextUrl) {
				const page2 = await page1.next();

				expect(page2).not.toBeNull();
				expect(page2!.accounts).toBeDefined();
				expect(Array.isArray(page2!.accounts)).toBe(true);

				// Ensure page 2 has different accounts than page 1
				if (page1.accounts.length > 0 && page2!.accounts.length > 0) {
					expect(page1.accounts[0].account).not.toBe(page2!.accounts[0].account);
				}
			}
		}, 30000);
	});
});
