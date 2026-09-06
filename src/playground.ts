import { HederaRestClient } from "./HederaRestClient";

const client = new HederaRestClient({
	defaultProvider: "public", // which provider entry to use by default (see ProviderRegistry)
	defaultNetwork: "testnet", // "testnet" | "mainnet" | "previewnet"
	log: true, // enable library logging
	switchProviderWhenOverflow: true, // preemptively switch provider when rate limit is at capacity
	switchProviderOnFailure: true, // after a retryable failure, try each remaining provider once

	// Global cache configuration: enabled resources store fresh responses;
	// per-request useCache flags explicitly permit cached reads.
	cache: {
		isEnabled: true, // master switch
		duration: 300, // global TTL (seconds) if resource‑specific TTL not set
		// adapter: new RedisCacheAdapter({ ... }) or new IndexedDbCacheAdapter(...) etc.
		// Per‑resource TTL overrides (seconds). Omit to use the global duration.
		resources: {
			accounts: { duration: 600, isEnabled: false },
			blocks: { duration: 600, isEnabled: false },
			contracts: { duration: 600, isEnabled: false },
			network: { duration: 120, isEnabled: false },
			tokens: { duration: 600, isEnabled: false },
			nfts: { duration: 600, isEnabled: false },
			topics: { duration: 300, isEnabled: false },
			transactions: { duration: 600, isEnabled: false },
			schedules: { duration: 600, isEnabled: false },
		},
	},

	// provider: optional advanced registry/provider overrides (rare). Leave unset unless you know you need it.
	provider: {
		public: {
			testnet: {
				url: "https://testnet.mirrornode.hedera.com",
				http: {
					// 50 requests per second
					limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
					retry: {
						enabled: true,
						maxAttempts: 3,
						initialDelayMs: 1000,
						maxDelayMs: 4000,

						on429: false,
						on5xx: true,
						onNetworkError: true,
					},
				},
			},
			mainnet: {
				url: "https://mainnet.mirrornode.hedera.com",
				http: {
					// 50 requests per second
					limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
					retry: { enabled: true },
				},
			},
			page: { defaultLimit: 25, maxLimit: 100 },
		},
		arkhia: {
			headers: {
				"x-api-key": "<YOUR_API_KEY>",
				// "x-api-secret": "<YOUR_API_SECRET>", // Uncomment if enabled.
			},
			testnet: {
				// Use the REST URL shown in the Arkhia dashboard. A URL ending
				// in /api/v1 is accepted and will not duplicate the API prefix.
				url: "https://your-base-url.example/hedera/testnet/api/v1",
			},
			http: {
				// 50 requests per second
				limiter: { reservoir: 50, reservoirRefreshInterval: 1000, reservoirRefreshAmount: 50 },
			},
			page: { defaultLimit: 25, maxLimit: 200 },
		},
	},
});

// const { accounts: accs, next } = await client.accounts().list().get();
// console.log(accs?.length, (await next())?.accounts?.length);

// const accounts = await client
// 	.accounts()
// 	.one((q) => q.idOrAliasOrEvmAddress("0.0.5006621").includeTransactions(false))
// 	.get();
// console.log(accounts);

// const accounts1 = await client
// 	.accounts()
// 	.one((q) => q.idOrAliasOrEvmAddress("0.0.5006623").includeTransactions(false).useCache(true))
// 	.get();
// console.log(accounts1?.account);

const call = await client
	.useNetwork("mainnet")
	.contracts()
	.call((q) => q.to("0x0000000000000000000000000000000000165941").data("0x0dfe1681").block("latest"))
	.get();
console.log(call);
