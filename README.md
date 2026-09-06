# @davincigraph/hedera-rest-client

A comprehensive, type-safe TypeScript client for the **Hedera Mirror Node REST API**. This library provides a clean, fluent interface for reading on-chain data from the Hedera network—accounts, tokens, contracts, blocks, topics, transactions, and more—without manually constructing URLs, handling pagination, or managing retries and rate limits.

Designed for production use in server-side applications, APIs, dashboards, and data-driven dApps that require reliable access to Hedera's public data services.

### Key features

-   **Fluent builder/DSL interface** with full TypeScript autocompletion for every Mirror Node resource
-   **Automatic pagination** with intuitive `page.next()` helpers
-   **Configurable retry policies** with exponential backoff, jitter, and `Retry-After` support
-   **Rate limiting** integration via Bottleneck (per-provider or per-network)
-   **Preemptive provider switching** when rate limits are at capacity (overflow detection)
-   **Automatic failover** across multiple providers on the same network
-   **Network-safe caching** (memory, Redis, IndexedDB) with explicit cached reads and per-resource TTL control
-   **Per-network limit resolution** for symbolic limits (`"default"`, `"max"`)
-   **Unified singleton client** — configure once, use everywhere
-   Works in **ESM** and **CJS** environments; requires **Node.js ≥ 18**

> **Package name:** `@davincigraph/hedera-rest-client`

---

## Table of contents

-   [Installation](#installation)
-   [Quick start](#quick-start)
-   [Configuration](#configuration)
    -   [Core options](#core-options)
    -   [Provider configuration](#provider-configuration)
    -   [Retry policy](#retry-policy)
    -   [Rate limiting](#rate-limiting)
    -   [Failover strategies](#failover-strategies)
    -   [Caching](#caching)
-   [Usage guide](#usage-guide)
    -   [Two query styles: object vs DSL](#two-query-styles-object-vs-dsl)
    -   [Comparators, timestamps & entity IDs](#comparators-timestamps--entity-ids)
    -   [Pagination](#pagination)
    -   [Scoping by provider/network](#scoping-by-providernetwork)
    -   [Cancellation and timeouts](#cancellation-and-timeouts)
    -   [Error handling](#error-handling)
-   [Resource reference](#resource-reference)
    -   [Accounts](#accounts)
    -   [Balances](#balances)
    -   [Blocks](#blocks)
    -   [Contracts](#contracts)
    -   [Network](#network)
    -   [Schedules](#schedules)
    -   [Tokens](#tokens)
    -   [Topics](#topics)
    -   [Transactions](#transactions)
-   [TypeScript & module formats](#typescript--module-formats)
-   [License](#license)

---

## Installation

```bash
# npm
npm install @davincigraph/hedera-rest-client

# pnpm
pnpm add @davincigraph/hedera-rest-client

# yarn
yarn add @davincigraph/hedera-rest-client
```

**Requirements:**

-   Using the published package: Node.js **18+**
-   TypeScript consumers: TypeScript **5.9+**
-   Building, testing, or publishing from source: Node.js **^20.19.0, ^22.12.0, or >=24.0.0** (required by the development toolchain)
-   Works in ESM or CJS projects (dual format distribution)

---

## Quick start

Create a shared client instance and use it throughout your application:

```ts
// hederaRestClient.ts
import { HederaRestClient } from "@davincigraph/hedera-rest-client";

export const hederaRestClient = new HederaRestClient({
	defaultProvider: "public",
	defaultNetwork: "testnet",
	log: true,
});
```

Use it to fetch data:

```ts
import { hederaRestClient } from "./hederaRestClient";

// Fetch tokens with pagination
const { tokens, next } = await hederaRestClient.tokens().list({ order: "desc", limit: 10 }).get();

console.log(tokens);

// Get next page
const page2 = await next();

// Fetch a single account
const account = await hederaRestClient.accounts().one({ idOrAliasOrEvmAddress: "0.0.98" }).get();

console.log(account);
```

---

## Configuration

### Core options

```ts
new HederaRestClient(config: HederaRestClientConfig)
```

| Option                       | Type                | Default                   | Description                                                                                          |
| ---------------------------- | ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `defaultProvider`            | `string`            | `"public"`                | Initial provider name to use for requests                                                            |
| `defaultNetwork`             | `string`            | `"testnet"`               | Initial canonical or custom configured network identity                                               |
| `log`                        | `boolean`           | `false`                   | Enable console logging for debugging (requests, retries, failover, cache)                            |
| `switchProviderWhenOverflow` | `boolean`           | `false`                   | When `true`, preemptively switch to another provider if the current one's rate limit is at capacity  |
| `switchProviderOnFailure`    | `boolean`           | `false`                   | When `true`, try each alternate provider on the same network at most once after a retryable failure  |
| `cache`                      | `CacheConfig`       | See [Caching](#caching)   | Write-through cache configuration with explicit cached reads                                        |
| `provider`                   | `ProviderConfigMap` | Built-in public endpoints | Provider definitions with URLs, static headers, rate limits, and retry policies                       |

### Provider configuration

The `provider` field allows you to define one or more API providers with custom URLs, authentication, rate limits, and retry policies:

Configuration is resolved without mutating the object passed to the client. Retry
fields inherit individually from provider to network, so a network can override
only the fields it needs. A network-level limiter is a complete, isolated
replacement for the provider limiter; when it is absent, the provider limiter is
shared by all of that provider's networks.

```ts
provider: {
  public: {
    testnet: {
      url: "https://testnet.mirrornode.hedera.com",
      http: {
        limiter: {
          reservoir: 50,
          reservoirRefreshInterval: 1000,
          reservoirRefreshAmount: 50,
        },
        retry: {
          enabled: true,
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 5000,
          backoff: "full-jitter",
          on404: false,
          on429: true,
          on5xx: true,
          onNetworkError: true,
          honorRetryAfter: true,
        },
      },
    },
    mainnet: {
      url: "https://mainnet.mirrornode.hedera.com",
      http: { /* ... */ },
    },
    previewnet: {
      url: "https://previewnet.mirrornode.hedera.com",
      http: { /* ... */ },
    },
    page: {
      defaultLimit: 25,
      maxLimit: 100,
    },
  },
  arkhia: {
    // Provider-level headers are inherited by every Arkhia network.
    headers: {
      "x-api-key": process.env.ARKHIA_API_KEY!,
      // Uncomment only when API Secret is enabled for the Arkhia project.
      // "x-api-secret": process.env.ARKHIA_API_SECRET!,
    },
    testnet: {
      // Copy this URL from the Arkhia dashboard. Both forms are accepted:
      // https://<base>/hedera/testnet
      // https://<base>/hedera/testnet/api/v1
      url: process.env.ARKHIA_TESTNET_REST_URL!,
      http: { /* per-network limiter and retry */ },
    },
    mainnet: {
      url: process.env.ARKHIA_MAINNET_REST_URL!,
    },
    http: {
      // Provider-level limiter shared across all networks
      limiter: { /* ... */ },
      retry: { /* ... */ },
    },
    page: {
      defaultLimit: 25,
      maxLimit: 100,
      // The public network-nodes operation has its own 10/25 contract.
      endpoints: {
        "network.nodes": { defaultLimit: 10, maxLimit: 25 },
      },
    },
  },
  privateFork: {
    // Use `networks` for arbitrary names without colliding with provider options.
    networks: {
      localnet: {
        url: "https://mirror.example/hedera/localnet/api/v1",
      },
    },
  },
}
```

**Key concepts:**

-   **Per-network config**: Canonical networks can use the direct `testnet`, `mainnet`, and `previewnet` keys; arbitrary fork/private network names use `networks: Record<string, NetworkConfig>`
-   **Built-in public networks**: Without a `provider` map, the client includes Hedera's public `testnet`, `mainnet`, and `previewnet` Mirror Node endpoints
-   **Provider-level vs network-level**: You can define HTTP settings and static `headers` at the provider level (shared across networks) or per network
-   **Header precedence**: Header names are case-insensitive. Provider-level `headers` are applied first, the legacy per-network `apiKey` shorthand overrides them, and per-network `headers` have final precedence
-   **Arkhia authentication**: Configure `x-api-key` and, when enabled for the project, `x-api-secret` in `headers`. Obtain both the REST URL and credentials from the Arkhia dashboard; see [Arkhia's API Secret documentation](https://docs.arkhia.io/docs/arkhia-services/Integration/api-secret)
-   **Paging limits**: `defaultLimit` is used when you pass `limit: "default"`, and `maxLimit` clamps user-provided numeric limits. Use `page.endpoints["network.nodes"]` for an operation-specific policy; provider and network values inherit field by field.
-   **Network identity**: A network name is the cache and failover identity of one ledger. Give different private/fork ledgers different names, even if two providers use similar URLs. Providers using the same name are asserting that their responses are interchangeable for that ledger.

Invalid URLs, defaults, page limits, limiter settings, retry settings, headers,
cache policies, unknown configuration properties, and duplicate direct/
`networks` definitions are rejected with `ConfigError` during construction
instead of being deferred until the first request.

#### Provider URL contract

Each network `url` must be an absolute `http:` or `https:` URL without embedded
credentials, a query string, or a fragment. Configure authentication through
`headers` instead. The URL can point to any of these levels:

```text
https://mirror.example
https://mirror.example/hedera/testnet
https://mirror.example/hedera/testnet/api/v1/
```

Path prefixes and trailing slashes are supported. Resource builders add `/api/v1` exactly once, so a URL copied from a provider dashboard can include the complete API root.

In runtimes that expose a manual redirect's `Location` (including Node.js),
redirects are followed only when they remain on the same origin, and every hop
is charged to the selected provider's limiter. Browsers may expose manual
redirects only as `opaqueredirect`; those are refused safely because their
destination cannot be inspected. Configured authentication headers are never
forwarded to a response-controlled cross-origin destination.

The older single-header form remains supported for compatibility:

```ts
testnet: {
  url: "https://mirror.example",
  apiKey: { key: "x-api-key", value: process.env.API_KEY! },
}
```

### Retry policy

Each provider (or network) can have its own retry policy. Network retry fields
override provider fields individually; omitted or `undefined` fields inherit.
Retries are disabled unless `enabled: true` is configured.

```ts
retry: {
	enabled?: boolean; // Master on/off switch
	maxAttempts?: number; // Integer >= 1; total attempts, e.g. 3 = 1 initial + 2 retries
	initialDelayMs?: number; // Starting delay (0..2,147,483,647 ms)
	maxDelayMs?: number; // Maximum delay cap (0..2,147,483,647 ms)
	backoff?: "fixed" | "full-jitter"; // Backoff strategy
	on404?: boolean; // Retry 404 responses (default: false)
	on429?: boolean; // Retry 429 rate limit errors (default: true)
	on5xx?: boolean; // Retry 5xx server errors (default: true)
	onNetworkError?: boolean; // Retry network errors (timeouts, connection failures)
	honorRetryAfter?: boolean; // Respect Retry-After header when present
}
```

**Backoff strategies:**

The `backoff` field controls how retry delays are calculated (default: `"full-jitter"`):

-   **`"fixed"`**: Always wait `initialDelayMs` between retries (capped by `maxDelayMs`)

    -   Predictable, constant delays
    -   Example: `initialDelayMs: 100` → each retry waits exactly 100ms

-   **`"full-jitter"`**: Exponential backoff with randomization (AWS full-jitter algorithm)
    -   Formula: `random(0, min(maxDelayMs, initialDelayMs * 2^attempt))`
    -   Prevents thundering herd problem (many clients retrying simultaneously)
    -   Example with `initialDelayMs: 250, maxDelayMs: 4000`:
        -   1st retry: 0-250ms (random)
        -   2nd retry: 0-500ms (random)
        -   3rd retry: 0-1000ms (random)
        -   4th retry: 0-2000ms (random)
        -   5th+ retry: 0-4000ms (random, capped)

**When `Retry-After` header is present:**
The backoff strategy is bypassed and the server-specified delay is used instead
(if `honorRetryAfter: true`). Both delay-seconds and HTTP-date values are supported,
and the result is clamped to 2,147,483,647 ms so host timers cannot overflow.

**Example configurations:**

```ts
// Aggressive retries with full-jitter (recommended for production)
http: {
  retry: {
    enabled: true,
    maxAttempts: 5,
    initialDelayMs: 250,
    maxDelayMs: 4000,
    backoff: "full-jitter", // Default
    on404: false,
    on429: true,
    on5xx: true,
    onNetworkError: true,
    honorRetryAfter: true,
  },
}

// Fixed delays (useful for testing or predictable behavior)
http: {
  retry: {
    enabled: true,
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 1000, // Same as initial = truly fixed
    backoff: "fixed",
    on429: true,
    on5xx: true,
  },
}
```

### Rate limiting

Rate limiting is configured via the `limiter` field in HTTP settings. The client uses [Bottleneck](https://www.npmjs.com/package/bottleneck) under the hood:

```ts
limiter: {
	reservoir?: number; // Initial capacity (tokens available)
	reservoirRefreshInterval?: number; // Milliseconds between refills; positive multiple of 250
	reservoirRefreshAmount?: number; // Value the reservoir resets to on each refill
	minTime?: number; // Minimum milliseconds between requests
	maxConcurrent?: number; // Maximum concurrent requests
}
```

Refresh interval and amount must be configured together with an initial
`reservoir`; this prevents an unintentionally unlimited startup window. The
local Bottleneck scheduler requires refill intervals divisible by 250 ms, and
timer fields must not exceed 2,147,483,647 ms.

**Example: 50 requests per second**

```ts
limiter: {
  reservoir: 50,
  reservoirRefreshInterval: 1000,
  reservoirRefreshAmount: 50,
}
```

**Limiter buckets:**

-   If a limiter is defined at the **provider level**, all networks share the same bucket
-   A limiter defined **per network** completely replaces the provider limiter and uses its own bucket
-   Queue and overflow decisions share one Bottleneck instance and one reservoir for each bucket
-   Every physical request consumes capacity, including retry and failover attempts
-   Concurrency capacity remains occupied until the response body has been read and validated, not merely until response headers arrive
-   Every followed same-origin redirect hop consumes capacity independently
-   Without overflow switching, exhausted requests queue on their selected provider
-   With overflow switching, alternate providers are probed first; if none can start, the request queues on the original provider

If an `AbortSignal` fires while a request is queued, the caller is rejected promptly
and no HTTP request is sent. Bottleneck cannot remove one queued job individually,
so that canceled placeholder may consume a local token or `minTime` slot when it
eventually drains; this conservative behavior never exceeds the provider's limit.

### Failover strategies

The client supports two independent failover mechanisms:

#### 1. Overflow switching (`switchProviderWhenOverflow`)

**When enabled:** Before sending a request, the client checks if the current provider's rate limiter has immediate capacity. If not, it tries other providers of the same network.

**Behavior:**

-   Rotates through all providers for the network (starting with your requested one)
-   Uses the first provider that can start the request immediately
-   If all providers are at capacity, queues on the originally requested provider
-   **Single-provider networks:** Never probes; always queues

**Use case:** Maximize throughput by distributing load across multiple API providers without waiting in queues.

```ts
switchProviderWhenOverflow: true;
```

#### 2. Failure-based failover (`switchProviderOnFailure`)

**When enabled:** If a request fails after all configured retries, the client
visits each remaining provider on the same network at most once. Each alternate
provider gets one physical attempt, with its own retry policy disabled.

**Behavior:**

-   Triggers on transport/network failures (including timeouts and response-stream failures), malformed success responses, and retryable HTTP errors (rejected redirects, 429, 5xx)
-   **404 responses** for singular resources are treated as final and return `null` (no failover)
-   Never executes the same provider twice, including when overflow routing selected a provider other than the requested one
-   Every alternate attempt passes through that destination provider's limiter
-   When overflow switching is also enabled, alternates with immediate capacity are tried before saturated alternates. If those immediate alternatives fail, capacity-blocked alternates queue in deterministic provider order until one succeeds, a non-failover error occurs, or all are exhausted; no alternate provider executes more than one HTTP attempt in that failover pass.
-   If no alternate exists, the original typed error is preserved

**Use case:** Improve reliability when a specific provider is down or misbehaving.

```ts
switchProviderOnFailure: true;
```

**Using both together:**

```ts
new HederaRestClient({
	switchProviderWhenOverflow: true, // Preemptively switch when at capacity
	switchProviderOnFailure: true, // Failover on errors
	// ...
});
```

### Caching

Caching is available for selected singular-resource and network-information endpoints. Enabling it and reading from it are deliberately separate decisions:

-   `cache.isEnabled: true` enables write-through storage. Every successful fresh response from a cacheable endpoint refreshes its cache entry.
-   `useCache: true` allows that request to return an existing cached response. Without it, the request always fetches fresh data and then refreshes the cache.
-   `cache.isEnabled: false` is the master off switch. It prevents all cache reads and writes, even if a resource has `isEnabled: true` or a request has `useCache: true`.
-   When the master switch is on, a resource inherits the enabled policy unless its own `isEnabled` is explicitly `false`.
-   Cache adapter reads and writes are fail-open: an unavailable Redis, IndexedDB, or custom adapter does not block the Mirror Node request and is reported when logging is enabled.
-   Malformed or expired adapter records are never served. Cleanup is performed only when the adapter can do so without deleting a newer concurrent write; backend expiry remains the normal reclamation mechanism.
-   Memory and IndexedDB adapters also reclaim expired write-through records with bounded opportunistic scans during writes; they install no background timer. Redis uses server TTL commands when available.
-   Values are cloned when crossing the client's cache boundary, so mutating a fresh response or cache hit cannot corrupt later cached responses.
-   TTLs must be finite, non-negative numbers. A zero TTL expires immediately; `NaN`, infinities, negative values, and unsafe durations are rejected.
-   Cache policy is snapshotted when the client is constructed, so later mutations to the caller's configuration object cannot silently change behavior. The adapter instance itself is intentionally retained.

| Cache enabled | `useCache` | Cache read | HTTP request | Cache write after success |
| ------------- | ---------- | ---------- | ------------ | ------------------------- |
| No            | Either     | No         | Yes          | No                        |
| Yes           | No/omitted | No         | Yes          | Yes                       |
| Yes           | Yes, hit   | Yes        | No           | No                        |
| Yes           | Yes, miss  | Yes        | Yes          | Yes                       |

```ts
cache: {
  isEnabled: boolean;           // Master on/off (default: false)
  duration?: number;            // Global TTL in seconds (default: 600)
  adapter?: CacheAdapter<unknown>; // Custom adapter (default: in-memory)

  resources?: {
    accounts?: { isEnabled?: boolean; duration?: number };
    blocks?: { isEnabled?: boolean; duration?: number };
    contracts?: { isEnabled?: boolean; duration?: number };
    network?: { isEnabled?: boolean; duration?: number };
    tokens?: { isEnabled?: boolean; duration?: number };
    nfts?: { isEnabled?: boolean; duration?: number };
    topics?: { isEnabled?: boolean; duration?: number };
    transactions?: { isEnabled?: boolean; duration?: number };
    schedules?: { isEnabled?: boolean; duration?: number };
  };
}
```

**Cache adapters:**

-   `MemoryCacheAdapter` (default): In-memory, process-local cache
-   `IndexedDbCacheAdapter`: Browser-based persistent cache
-   `RedisCacheAdapter`: Server-side distributed cache

Redis TTL writes use one atomic `SET ... PX` command when the client exposes a
raw command API. Minimal Redis-compatible clients are also supported through a
`set`/`expire` fallback. All friendly-only mutations are serialized per physical
key for adapters sharing the same client instance, including adapters configured
without physical expiry, so one local concurrent write cannot apply its expiry
to another value. If the expiry step fails, the error is reported and the
embedded deadline still prevents stale reads; the adapter does not issue an
unsafe unconditional delete that could erase a concurrent write.
`clear()` scans and deletes matching prefix pages incrementally rather than
retaining every discovered key in application memory.

`IndexedDbCacheAdapter.clear()` likewise honors `keyPrefix`; it scans the object
store and removes only matching keys. With no prefix it clears the dedicated
store, preserving the adapter's original behavior.

**Cacheable endpoints:**

-   `accounts.one()`
-   `blocks.one()`
-   `contracts.one()`, `contracts.resultByTimestamp()`, `contracts.resultByTransaction()`
-   `network.supply()`, `network.exchangeRate()`, `network.stake()`
-   `schedules.one()`
-   `tokens.one()`, `tokens.nft()`
-   `topics.one()`, `topics.messageBySequence()`, `topics.messageByTimestamp()`
-   `transactions.byId()`

**Usage:**

```ts
// Enable caching globally
const hederaRestClient = new HederaRestClient({
	cache: {
		isEnabled: true,
		duration: 300, // 5 minutes default
		resources: {
			tokens: { duration: 600 }, // 10 minutes for tokens
			accounts: { duration: 120 }, // 2 minutes for accounts
		},
	},
});

// Explicitly allow this request to use an existing cached response
const token = await hederaRestClient.tokens().one({ tokenId: "0.0.123", useCache: true }).get();

// Omitting useCache forces a fresh request and refreshes the entry
const freshToken = await hederaRestClient.tokens().one({ tokenId: "0.0.123" }).get();
```

**Cache keys:**

-   Use the versioned namespace `hedera-rest-client:2:<JSON-network>:...`; lossless JSON string encoding keeps arbitrary custom network names collision-free across UTF-8 backends, and version 1 keys are not read
-   Include the network resolved when `.get()` executes, preventing cross-network responses even after a builder's `.network(...)` override changes
-   Deliberately exclude the provider, so public Mirror Node, Arkhia, and other providers can share equivalent responses for the same Hedera network
-   Therefore, use a distinct network name and (for shared Redis deployments) a distinct adapter `keyPrefix` for every non-equivalent ledger
-   Include relevant query parameters (e.g., timestamp filters)
-   Do not read legacy, unversioned keys

---

## Usage guide

### Two query styles: object vs DSL

Every resource method accepts either:

1. **Object style** (plain TypeScript object)
2. **DSL style** (fluent builder callback)

Both produce identical requests:

Object inputs are validated as exact request shapes at runtime. Misspelled or
unknown properties and malformed booleans/enums throw `ValidationError`; they
are never silently discarded. Repeated filters accept mutable or readonly
arrays, including values created with `as const`.

```ts
// Object style
await hederaRestClient
	.tokens()
	.list({
		tokenId: "gte:0.0.100",
		order: "desc",
		limit: 10,
	})
	.get();

// DSL style (with autocomplete!)
await hederaRestClient
	.tokens()
	.list((q) => q.tokenId().greaterThanOrEqualTo("0.0.100").order("desc").limit(10))
	.get();
```

**DSL benefits:**

-   Full TypeScript autocomplete
-   Type-safe comparators
-   Better discoverability

### Comparators, timestamps & entity IDs

**Comparators:**
Many filters accept comparator strings:

-   `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
-   Format: `"op:value"` (e.g., `"gte:0.0.1000"`)
-   Plain values are treated as `eq`
-   Some endpoints **forbid `ne`** on specific fields (noted in reference)

**Timestamps:**

-   Format: `"seconds"` or `"seconds.fraction"` (e.g., `"1700000000.123456789"`)
-   Can use comparators: `"gte:1700000000.0"`, `"lt:1700003600.0"`
-   Many endpoints accept **arrays** for ranges: `["gte:...", "lt:..."]`
-   Some endpoints require **exact** timestamps (no comparators)

**Entity IDs:**

-   Responses use the canonical `"shard.realm.num"` form (for example, `"0.0.98"`)
-   Request identifiers also accept `"num"` and `"realm.num"` shorthand where supported by the endpoint
-   Some endpoints accept **aliases** or **EVM addresses** (`0x...`)

### Pagination

List endpoints return a page object with:

-   The resource array (`accounts`, `tokens`, `blocks`, etc.)
-   `next(): Promise<Page | null>` — fetches the next page or returns `null`
-   `next.url(): string | null` — returns the absolute URL of the next page

```ts
const page1 = await hederaRestClient.accounts().list({ limit: 25, order: "desc" }).get();

console.log(page1.accounts);

// Fetch next page
const page2 = await page1.next();
if (page2) {
	console.log(page2.accounts);
	console.log(page2.next.url()); // Next page URL or null
}

// Iterate through all pages
let currentPage: typeof page1 | null = page1;
while (currentPage) {
	processAccounts(currentPage.accounts);
	currentPage = await currentPage.next();
}
```

`limit: "default"` and `limit: "max"` are resolved only after the provider that
will execute that request is selected. Numeric limits and server-provided next
links are also re-clamped against each actual failover provider's `maxLimit`.
This keeps pagination valid when providers for the same network enforce
different page policies or use different URL path prefixes. Endpoint policies
such as `page.endpoints["network.nodes"]` participate in the same failover and
pagination resolution.

### Scoping by provider/network

**Global scoping:**

```ts
const mainnet = hederaRestClient.useNetwork("mainnet");
const arkhia = hederaRestClient.useProvider("arkhia");

// All calls use mainnet
const blocks = await mainnet.blocks().list({ limit: 10 }).get();

// All calls use arkhia provider
const tokens = await arkhia.tokens().list({ limit: 10 }).get();

// Chain both
const specific = hederaRestClient.useProvider("arkhia").useNetwork("mainnet");
```

**Per-query scoping:**

```ts
// Less common, but supported
await hederaRestClient.accounts().provider("arkhia").network("mainnet").list({ limit: 10 }).get();
```

### Cancellation and timeouts

Every initial operation and every `next()` call accepts the same optional
request controls. The timeout applies independently to each physical attempt
and includes redirect handling and complete response-body consumption.

```ts
const controller = new AbortController();

const page = await hederaRestClient
	.tokens()
	.list({ limit: "max" })
	.get({ signal: controller.signal, timeoutMs: 10_000 });

const nextPage = await page.next({ signal: controller.signal, timeoutMs: 10_000 });
```

A caller abort stops limiter waiting, retries, failover, transport, and body
reading. A timeout is a retryable transport failure and may use the configured
retry/failover policy.

These controls govern the HTTP pipeline. The intentionally small
`CacheAdapter` contract has no cancellation parameter, so a custom adapter
should impose its own operation timeout if its backend could wait indefinitely.
An already-aborted signal is rejected before a cache lookup begins; aborting
after custom cache I/O has started cannot interrupt that adapter operation.

### Error handling

**HTTP errors:**

```ts
import { ConfigError, HttpError, HttpNetworkError, ValidationError } from "@davincigraph/hedera-rest-client";

try {
	const account = await hederaRestClient.accounts().one({ idOrAliasOrEvmAddress: "0.0.999999" }).get();

	// For .one() methods, 404 returns null (no exception)
	if (!account) {
		console.log("Account not found");
	}
} catch (error) {
	if (error instanceof HttpError) {
		console.error(`HTTP ${error.status}: ${error.message}`);
		console.error(error.body); // Parsed response body
	} else if (error instanceof HttpNetworkError) {
		console.error(`Network failure after ${error.attempts} attempts for ${error.url}`);
		console.error(error.cause); // Original fetch/DNS/connection error
	} else if (error instanceof ValidationError || error instanceof ConfigError) {
		console.error(error.name, error.message);
	} else {
		console.error("Other error:", error);
	}
}
```

**Validation errors:**

```ts
import { ValidationError } from "@davincigraph/hedera-rest-client";

try {
	await hederaRestClient.accounts().one({ idOrAliasOrEvmAddress: "invalid" }).get();
} catch (error) {
	if (error instanceof ValidationError) {
		console.error("Invalid input:", error.message);
	}
}
```

**404 handling:**

-   **Singular resources** (`.one()`, `.byId()`, etc.): Return `null` instead of throwing
-   **List endpoints**: Throw `HttpError` with status 404
-   **`transactions.byId()`**: Returns `{ transactions: [] }` on 404 (special case)

---

## Resource reference

Below is a complete reference of all resources, methods, filters, and examples.

> **Notation:** "(cacheable)" means `.useCache(true)` is supported

### Accounts

**Builder:** `hederaRestClient.accounts()`

#### `list(query?) => { get(): Promise<AccountsPage> }`

_GET `/api/v1/accounts`_

**Filters:**

-   `accountId`: entity ID or comparator
-   `accountBalance`: number or comparator
-   `accountPublicKey`: string
-   `includeBalance`: one to 100 boolean occurrences; arrays and repeated DSL calls preserve their order
-   `order`: `"asc"` | `"desc"`
-   `limit`: number | `"default"` | `"max"`

**Example:**

```ts
const { accounts, next } = await hederaRestClient
	.accounts()
	.list((q) => q.accountId().greaterThanOrEqualTo("0.0.1000").includeBalance(true).order("desc").limit(25))
	.get();
```

#### `one(query) (cacheable) => { get(): Promise<AccountBalanceTransactionsPage | null> }`

_GET `/api/v1/accounts/{idOrAliasOrEvmAddress}`_

**Fields:**

-   `idOrAliasOrEvmAddress` **(required)**: request entity ID (`num`, `realm.num`, or `shard.realm.num`) | alias | EVM address
-   `timestamp`: exact or comparator (string or array)
-   `transactiontype`: string
-   `transactions`: boolean
-   `order`, `limit`
-   `useCache`: boolean

The result retains every raw `AccountBalanceTransactions` field, including
`transactions` and `links`, and adds typed `next()` / `next.url()` helpers for
the embedded transaction history. `next()` returns another complete account
page or `null`. Cached responses reconstruct these helpers without storing
functions in the cache.

**Returns `null` on 404**

**Example:**

```ts
const account = await hederaRestClient
	.accounts()
	.one((q) => q.idOrAliasOrEvmAddress("0.0.98").useCache(true))
	.get();

const olderTransactions = await account?.next();
```

#### `hooks(query) => { get(): Promise<AccountHooksPage> }`

_GET `/api/v1/accounts/{idOrAliasOrEvmAddress}/hooks`_

Lists the hooks owned by an account. The result contains `hooks` and the standard
`next()` / `next.url()` pagination helpers.

**Fields and filters:**

-   `idOrAliasOrEvmAddress` **(required)**: account ID, alias, or EVM address
-   `hookId`: non-negative ID/range filter; up to 100 repeated `hook.id` values, with `eq`, `gt`, `gte`, `lt`, or `lte`
-   `order`: `"asc"` | `"desc"` (server default: `"desc"`)
-   `limit`: number | `"default"` | `"max"`

**Object form:**

```ts
const page = await hederaRestClient.accounts().hooks({
	idOrAliasOrEvmAddress: "0.0.1234",
	hookId: 1,
	order: "desc",
	limit: 25,
}).get();

console.log(page.hooks);
const nextPage = await page.next();
```

**DSL form:**

```ts
const page = await hederaRestClient
	.accounts()
	.hooks((q) => q.idOrAliasOrEvmAddress("0.0.1234").hookId(1).order("desc").limit(25))
	.get();
```

#### `hookStorage(query) => { get(): Promise<AccountHookStoragePage> }`

_GET `/api/v1/accounts/{idOrAliasOrEvmAddress}/hooks/{hookId}/storage`_

Lists the storage slots belonging to one account hook. The page contains
`storage`, `hook_id`, `owner_id`, and the standard `next()` / `next.url()`
pagination helpers.

**Fields and filters:**

-   `idOrAliasOrEvmAddress` **(required)**: account ID, alias, or EVM address
-   `hookId` **(required)**: non-negative hook ID used in the path
-   `key`: 1–64 hexadecimal digits with an optional `0x` prefix; up to 100 values with `eq`, `gt`, `gte`, `lt`, or `lte`
-   `timestamp`: one or two rest-java values; the optional suffix is raw nanoseconds, and `ne` is unsupported
-   `order`: `"asc"` | `"desc"` (server default: `"asc"`)
-   `limit`: number | `"default"` | `"max"`

**Object form:**

```ts
const page = await hederaRestClient.accounts().hookStorage({
	idOrAliasOrEvmAddress: "0.0.1234",
	hookId: 1,
	key: "gte:0x01",
	timestamp: ["gte:1700000000.0", "lt:1700003600.0"],
	limit: 25,
}).get();

console.log(page.owner_id, page.hook_id, page.storage);
```

**DSL form:**

```ts
const page = await hederaRestClient
	.accounts()
	.hookStorage((q) =>
		q
			.idOrAliasOrEvmAddress("0.0.1234")
			.hookId(1)
			.key().greaterThanOrEqualTo("0x01")
			.timestamp().greaterThanOrEqualTo("1700000000.0")
			.limit(25)
	)
	.get();
```

#### `hbarAllowances(query) => { get(): Promise<CryptoAllowancesPage> }`

_GET `/api/v1/accounts/{id}/allowances/crypto`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `spenderId`: entity ID or comparator (**`ne` forbidden**)
-   `order`, `limit`

#### `tokenAllowances(query) => { get(): Promise<TokenAllowancesPage> }`

_GET `/api/v1/accounts/{id}/allowances/tokens`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `spenderId`: comparator allowed (**`ne` forbidden**)
-   `tokenId`: comparator allowed (**requires `spenderId`; `ne` forbidden**)
-   `order`, `limit`

#### `nftAllowances(query) => { get(): Promise<NFTAllowancesPage> }`

_GET `/api/v1/accounts/{id}/allowances/nfts`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `view`: `"owner"` (default) | `"spender"`
-   `counterpartyId`: one exact value or a lower/upper pair (**`ne` forbidden**)
-   `tokenId`: one exact value or a lower/upper pair (**requires `counterpartyId`; `ne` forbidden**)
-   `order`, `limit`

#### `tokens(query) => { get(): Promise<AccountTokensPage> }`

_GET `/api/v1/accounts/{id}/tokens`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `tokenId`: entity ID or comparator (**`ne` forbidden**)
-   `order`, `limit`

#### `nfts(query) => { get(): Promise<AccountNFTsPage> }`

_GET `/api/v1/accounts/{id}/nfts`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `tokenId`: comparator allowed (**`ne` forbidden**)
-   `serialNumber`: integer or comparator (**requires `tokenId`**, **`ne` forbidden**)
-   `spenderId`: entity ID or comparator (**`ne` forbidden**)
-   `order`, `limit`

#### `rewards(query) => { get(): Promise<AccountRewardsPage> }`

_GET `/api/v1/accounts/{id}/rewards`_

**Filters:**

-   `idOrAliasOrEvmAddress` (path)
-   `timestamp`: exact or comparator (single or array; `ne` is unsupported)
-   `order`, `limit`

#### `outstandingAirdrops(query) => { get(): Promise<AccountAirdropsPage> }`

_GET `/api/v1/accounts/{id}/airdrops/outstanding`_

Path `id` is the **sender**.

**Filters:**

-   `receiverId`: one or two range values (`ne` is rejected because Mirror Node ignores it)
-   `tokenId`: one or two numeric entity-ID range values (`ne` is rejected)
-   `serialNumber`: one or two independent integer range values (`ne` forbidden)
-   `order`, `limit`

#### `pendingAirdrops(query) => { get(): Promise<AccountAirdropsPage> }`

_GET `/api/v1/accounts/{id}/airdrops/pending`_

Path `id` is the **receiver**.

**Filters:**

-   `senderId`: one or two range values (`ne` is rejected because Mirror Node ignores it)
-   `tokenId`: one or two numeric entity-ID range values (`ne` is rejected)
-   `serialNumber`: one or two independent integer range values (`ne` forbidden)
-   `order`, `limit`

---

### Balances

**Builder:** `hederaRestClient.balances()`

#### `list(query?) => { get(): Promise<BalancesPage> }`

_GET `/api/v1/balances`_

**Filters:**

-   `accountId`: entity ID or comparator
-   `accountBalance`: number or comparator
-   `accountPublicKey`: string
-   `timestamp`: single or array
-   `order`, `limit`

**Example:**

```ts
const { balances, timestamp } = await hederaRestClient
	.balances()
	.list((q) => q.accountBalance().greaterThan(1_000_000).timestamp().lessThanOrEqualTo("1700000000.0").order("desc").limit(50))
	.get();
```

---

### Blocks

**Builder:** `hederaRestClient.blocks()`

#### `list(query?) => { get(): Promise<BlocksPage> }`

_GET `/api/v1/blocks`_

**Filters:**

-   `blockNumber`: number or comparator (**`ne` forbidden**)
-   `timestamp`: single or array
-   `order`, `limit`

#### `one(query) (cacheable) => { get(): Promise<Block | null> }`

_GET `/api/v1/blocks/{hashOrNumber}`_

**Fields:**

-   `hashOrNumber`: decimal block number or a 32/48-byte hash (with optional `0x`)
-   `useCache`: boolean

**Returns `null` on 404**

**Example:**

```ts
const block = await hederaRestClient
	.blocks()
	.one({
		hashOrNumber: "12345",
		useCache: true,
	})
	.get();
```

---

### Contracts

**Builder:** `hederaRestClient.contracts()`

#### `list(query?) => { get(): Promise<ContractsPage> }`

_GET `/api/v1/contracts`_

**Filters:**

-   `contractId`: entity ID, unprefixed 40-hex-character (20-byte) EVM address, or comparator
-   `order`, `limit`

#### `one(query) (cacheable) => { get(): Promise<ContractResponse | null> }`

_GET `/api/v1/contracts/{idOrAddress}`_

**Fields:**

-   `idOrAddress`: request entity ID (`num`, `realm.num`, or `shard.realm.num`) or EVM address
-   `timestamp`: single or array
-   `useCache`: boolean

**Returns `null` on 404**

#### `results(query) => { get(): Promise<ContractsResultsPage> }`

_GET `/api/v1/contracts/{id}/results`_

**Filters:**

-   `idOrAddress` (path)
-   `timestamp`: single or array
-   `from`: account ID or address
-   `blockHash`: **eq-only**
-   `blockNumber`: **eq-only** (decimal or hex)
-   `blockHash` and `blockNumber` are mutually exclusive
-   `internal`: boolean
-   `transactionIndex`: non-negative 32-bit int (**requires `blockHash` or `blockNumber`**)
-   `order`, `limit`

#### `resultByTimestamp(query) (cacheable) => { get(): Promise<ContractResultDetails | null> }`

_GET `/api/v1/contracts/{id}/results/{timestamp}`_

**Fields:**

-   `idOrAddress` (path)
-   `timestamp`: **exact** (no comparator)
-   `hbar`: `true` for tinybars (default), `false` for weibars
-   `useCache`: boolean

**Returns `null` on 404**

#### `globalResults(query?) => { get(): Promise<ContractsResultsPage> }`

_GET `/api/v1/contracts/results`_

**Filters:**

-   `timestamp`: single or array
-   `from`: account ID or address
-   `blockHash`: **eq-only**
-   `blockNumber`: **eq-only**
-   `blockHash` and `blockNumber` are mutually exclusive
-   `internal`: boolean
-   `hbar`: `true` for tinybars (default), `false` for weibars
-   `transactionIndex`: non-negative 32-bit int (**requires `blockHash` or `blockNumber`**)
-   `order`, `limit`

#### `resultByTransaction(query) (cacheable) => { get(): Promise<ContractResultDetails | null> }`

_GET `/api/v1/contracts/results/{transactionIdOrHash}`_

**Fields:**

-   `transactionIdOrHash`: `"0.0.x-s-ns"` or 32-byte hash
-   `nonce`: non-negative 32-bit int
-   `hbar`: `true` for tinybars (default), `false` for weibars
-   `useCache`: boolean

**Returns `null` on 404**

#### `globalLogs(query?) => { get(): Promise<ContractLogsPage> }`

_GET `/api/v1/contracts/results/logs`_

**Filters:**

-   `topic0`, `topic1`, `topic2`, `topic3`: 1–64 hex digits, optional `0x` (arrays allowed)
-   **If any topic:** `timestamp` is **required** and must span ≤ **7 days**
-   `index`: comparator or integer (**requires `timestamp`**, no `ne`)
-   `transactionHash`: **eq-only** 32/48-byte hash
-   `timestamp`: single or array; supports `eq`, `gt`, `gte`, `lt`, `lte` (not `ne`)
-   `order`, `limit`

#### `logs(query) => { get(): Promise<ContractLogsPage> }`

_GET `/api/v1/contracts/{id}/results/logs`_

Same as `globalLogs` plus `idOrAddress` path parameter. Topic filters also accept
multiple values in both object and DSL forms.

#### `state(query) => { get(): Promise<ContractStatePage> }`

_GET `/api/v1/contracts/{id}/state`_

The page retains the raw Mirror Node `links` field and adds `next()` / `next.url()`.

**Filters:**

-   `slot`: one or more 1–64 digit hex keys; comparators supported except `ne`
-   `timestamp`: single or array; comparators supported except `ne`
-   `order`, `limit`

#### `call(query) => { get(): Promise<ContractCallResponse> }`

_POST `/api/v1/contracts/call`_

**Body:**

-   `to` **(required)**: `0x...` address
-   `from`: `0x...` address
-   `data`: hex payload (≤ 131072 bytes)
-   `block`: `"latest"` | `"pending"` | `"earliest"` | hex/decimal block tag
-   `estimate`: boolean
-   `gas`, `gasPrice`, `value`: non-negative int64 values; use decimal strings above `Number.MAX_SAFE_INTEGER`

**Note:** When `estimate === true`, `block` must be `"latest"` or omitted.

#### `actions(query) => { get(): Promise<ContractActionsPage> }`

_GET `/api/v1/contracts/results/{transactionIdOrHash}/actions`_

**Filters:**

-   `transactionIdOrHash` (path)
-   `index`: integer or comparator (**`ne` forbidden**)
-   `order`, `limit`

#### `opcodes(query) => { get(): Promise<OpcodesResponse> }`

_GET `/api/v1/contracts/results/{transactionIdOrHash}/opcodes`_

**Flags:**

-   `stack`, `memory`, `storage`: boolean

---

### Network

**Builder:** `hederaRestClient.network()`

#### `supply(query?)` (cacheable)

-   Without `q`: `{ get(): Promise<NetworkSupplyResponse> }`
-   With `q`: `{ get(): Promise<string> }`

_GET `/api/v1/network/supply`_

**Filters:**

-   `timestamp`: one or two rest-java values; an optional suffix is raw nanoseconds, and `ne` is unsupported
-   `q`: case-insensitive `"totalcoins"` or `"circulating"`; when present, `get()` returns the selected supply as an HBAR-denominated decimal string instead of the JSON response
-   `useCache`: boolean

#### `fees(query?) => { get(): Promise<NetworkFeesResponse> }`

_GET `/api/v1/network/fees`_

**Filters:**

-   `timestamp`: one or two rest-java values; supports `eq`, `gt`, `gte`, `lt`, and `lte` (`ne` is not supported)
-   `order`

#### `estimateFees(query) => { get(): Promise<FeeEstimateResponse> }`

_POST `/api/v1/network/fees`_

Estimates the network, node, service, and total fees for one protobuf-encoded
HAPI `Transaction`. Fee amounts in the response, including `base`,
`fee_per_unit`, `subtotal`, and `total`, are expressed in **tinycents**, not
tinybars.

**Fields:**

-   `transaction` **(required)**: one singular protobuf `Transaction`, encoded as a `Uint8Array`, `ArrayBuffer`, or, in Node.js, `Buffer`
-   `mode`: case-insensitive `"INTRINSIC"` (default; transaction properties only) | `"STATE"` (includes current network state)
-   `highVolumeThrottle`: integer from `0` through `10000`, expressed in basis points (`10000` = 100%); mapped to `high_volume_throttle`
-   `contentType`: case-insensitive `"application/protobuf"` (default) | `"application/x-protobuf"`

The client snapshots the transaction's exact byte range when `.get()` begins,
sends those bytes unchanged, and reuses that owned snapshot across limiter
waiting, retries, and provider failover. Supporting both registered media types
makes the call usable with public Hedera Mirror Nodes and compatible forks.
This operation is not cached.

> **SDK serialization:** Do not pass `Transaction.toBytes()` directly. The
> official JavaScript SDK encodes those bytes as a protobuf `TransactionList`,
> while this endpoint requires one singular protobuf `Transaction`. The REST
> client deliberately does not unwrap it: protobuf payloads are not
> self-describing, a list can contain a separate transaction for each target
> node, and choosing an entry belongs to the caller. This also keeps the REST
> client independent of any particular SDK or protobuf package.

**Object form:**

```ts
// Optional conversion when starting with an official JavaScript SDK Transaction.
// Install @hiero-ledger/proto in your application to perform this conversion.
import { proto } from "@hiero-ledger/proto";

const transactionList = proto.TransactionList.decode(sdkTransaction.toBytes());
const singularTransaction = transactionList.transactionList[0];

if (!singularTransaction) {
	throw new Error("The SDK transaction did not contain a protobuf Transaction");
}

const transactionBytes = proto.Transaction.encode(singularTransaction).finish();

const estimate = await hederaRestClient.network().estimateFees({
	transaction: transactionBytes,
	mode: "STATE",
	highVolumeThrottle: 2500,
	contentType: "application/protobuf",
}).get();

console.log(estimate.total); // tinycents
```

**DSL form:**

```ts
const estimate = await hederaRestClient
	.network()
	.estimateFees((q) =>
		q
			.transaction(transactionBytes)
			.mode("STATE")
			.highVolumeThrottle(2500)
			.contentType("application/x-protobuf")
	)
	.get();
```

#### `exchangeRate(query?) (cacheable) => { get(): Promise<NetworkExchangeRateSetResponse> }`

_GET `/api/v1/network/exchangerate`_

**Filters:**

-   `timestamp`: one or two rest-java values; an optional suffix is raw nanoseconds, and `ne` is unsupported
-   `useCache`: boolean

#### `nodes(query?) => { get(): Promise<NetworkNodesPage> }`

_GET `/api/v1/network/nodes`_

The page retains the raw Mirror Node `links` field and adds `next()` / `next.url()`.

**Filters:**

-   `fileId`: entity ID or equality comparator (`eq` only)
-   `nodeId`: up to 100 integer/range values (**no `ne`**)
-   `order`, `limit` (built-in public nodes: default `10`, maximum `25`)

#### `registeredNodes(query?) => { get(): Promise<RegisteredNodesPage> }`

_GET `/api/v1/network/registered-nodes`_

Lists services registered on-chain, including block nodes, mirror nodes, RPC
relays, and general services. The result contains `registered_nodes` and the
standard `next()` / `next.url()` pagination helpers.

**Filters:**

-   `registeredNodeId`: one or two integer/range values; equality must be supplied alone and `ne` is unsupported
-   `type`: case-insensitive `"BLOCK_NODE"` | `"GENERAL_SERVICE"` | `"MIRROR_NODE"` | `"RPC_RELAY"` | `"UNKNOWN"`
-   `order`: `"asc"` | `"desc"`
-   `limit`: number | `"default"` | `"max"`

**Object form:**

```ts
const page = await hederaRestClient.network().registeredNodes({
	registeredNodeId: "gte:1",
	type: "BLOCK_NODE",
	order: "asc",
	limit: 25,
}).get();

console.log(page.registered_nodes);
```

**DSL form:**

```ts
const page = await hederaRestClient
	.network()
	.registeredNodes((q) =>
		q.registeredNodeId().greaterThanOrEqualTo(1).type("BLOCK_NODE").order("asc").limit(25)
	)
	.get();
```

#### `stake(query?) (cacheable) => { get(): Promise<NetworkStakeResponse> }`

_GET `/api/v1/network/stake`_

**Filters:**

-   `useCache`: boolean

---

### Schedules

**Builder:** `hederaRestClient.schedules()`

#### `list(query?) => { get(): Promise<SchedulesPage> }`

_GET `/api/v1/schedules`_

**Filters:**

-   `accountId`: entity ID or comparator
-   `scheduleId`: entity ID or comparator
-   `order`, `limit`

#### `one(query) (cacheable) => { get(): Promise<Schedule | null> }`

_GET `/api/v1/schedules/{scheduleId}`_

**Fields:**

-   `scheduleId` **(required)**: request entity ID (`num`, `realm.num`, or `shard.realm.num`)
-   `useCache`: boolean

**Returns `null` on 404**

---

### Tokens

**Builder:** `hederaRestClient.tokens()`

#### `list(query?) => { get(): Promise<TokensPage> }`

_GET `/api/v1/tokens`_

**Filters:**

-   `accountId`: exact request entity ID or EVM address (no comparator)
-   `tokenId`: request entity ID or long-zero Solidity address, optionally with a comparator
-   `publicKey`: string
-   `name`: 3–100 UTF-8 bytes (**mutually exclusive** with `accountId` and `tokenId`)
-   `type`: one to 100 case-insensitive token-type labels. `"ALL"`, `"FUNGIBLE_COMMON"`, and `"NON_FUNGIBLE_UNIQUE"` have autocomplete; newer provider/fork labels remain accepted. Arrays and repeated DSL calls accumulate, and supplied casing is preserved
-   `order`, `limit`

#### `one(query) (cacheable) => { get(): Promise<TokenInfo | null> }`

_GET `/api/v1/tokens/{tokenId}`_

**Fields:**

-   `tokenId`: request entity ID or long-zero Solidity address
-   `timestamp`: one to 100 exact or comparator (`"eq"`, `"lt"`, `"lte"`) occurrences; the last occurrence selects the response and cache entry
-   `useCache`: boolean

**Returns `null` on 404**

#### `balances(query) => { get(): Promise<TokenBalancesPage> }`

_GET `/api/v1/tokens/{tokenId}/balances`_

**Filters:**

-   `tokenId` (path): request entity ID or long-zero Solidity address
-   `accountId`: entity ID or comparator
-   `accountPublicKey`: string
-   `accountBalance`: equality or comparator
-   `timestamp`: single or array
-   `order`, `limit`

#### `nfts(query) => { get(): Promise<TokenNftsPage> }`

_GET `/api/v1/tokens/{tokenId}/nfts`_

**Filters:**

-   `tokenId` (path): request entity ID or long-zero Solidity address
-   `accountId`: entity ID or comparator (including `ne`)
-   `serialNumber`: positive integer or comparator (including `ne`)
-   `order`, `limit`

#### `nft(query) (cacheable) => { get(): Promise<Nft | null> }`

_GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}`_

**Fields:**

-   `tokenId`: request entity ID or long-zero Solidity address
-   `serialNumber` (positive integer)
-   `useCache`: boolean

**Returns `null` on 404**

#### `nftTransactions(query) => { get(): Promise<NftTransactionsPage> }`

_GET `/api/v1/tokens/{tokenId}/nfts/{serialNumber}/transactions`_

**Filters:**

-   `tokenId` (path): request entity ID or long-zero Solidity address
-   `serialNumber` (path): positive integer
-   `timestamp`: single or array
-   `order`, `limit`

---

### Topics

**Builder:** `hederaRestClient.topics()`

#### `one(query) (cacheable) => { get(): Promise<Topic | null> }`

_GET `/api/v1/topics/{topicId}`_

**Fields:**

-   `topicId`: request entity ID (`num`, `realm.num`, or `shard.realm.num`)
-   `useCache`: boolean

**Returns `null` on 404**

#### `messages(query) => { get(): Promise<TopicMessagesPage> }`

_GET `/api/v1/topics/{topicId}/messages`_

**Filters:**

-   `topicId` (path): request entity ID (`num`, `realm.num`, or `shard.realm.num`)
-   `encoding`: case-insensitive `"base64"` | `"utf8"` | `"utf-8"`; the supplied casing is preserved
-   `sequenceNumber`: integer or comparator (**`ne` forbidden**)
-   `timestamp`: single or array (`ne` is unsupported)
-   `order`, `limit`

#### `messageBySequence(query) (cacheable) => { get(): Promise<TopicMessage | null> }`

_GET `/api/v1/topics/{topicId}/messages/{sequenceNumber}`_

**Fields:**

-   `topicId`: request entity ID (`num`, `realm.num`, or `shard.realm.num`)
-   `sequenceNumber` (positive integer)
-   `useCache`: boolean

**Returns `null` on 404**

#### `messageByTimestamp(query) (cacheable) => { get(): Promise<TopicMessage | null> }`

_GET `/api/v1/topics/messages/{timestamp}`_

**Fields:**

-   `timestamp`: **exact** (no comparator)
-   `useCache`: boolean

**Returns `null` on 404**

---

### Transactions

**Builder:** `hederaRestClient.transactions()`

#### `list(query?) => { get(): Promise<TransactionsPage> }`

_GET `/api/v1/transactions`_

**Filters:**

-   `accountId`: entity ID or comparator
-   `timestamp`: single or array
-   `transactiontype`: string
-   `result`: case-insensitive `"success"` | `"fail"` (supplied casing is preserved)
-   `type`: case-insensitive `"credit"` | `"debit"` (supplied casing is preserved)
-   `order`, `limit`

**Example:**

```ts
const { transactions } = await hederaRestClient
	.transactions()
	.list((q) => q.accountId().greaterThanOrEqualTo("0.0.1000").result("success").order("asc").limit(25))
	.get();
```

#### `byId(query) (cacheable) => { get(): Promise<TransactionByIdResponse> }`

_GET `/api/v1/transactions/{transactionIdOrHash}`_

**Fields:**

-   `transactionId`: a `"0.0.x-seconds-nanos"` transaction ID, or its 48-byte transaction hash encoded as exactly 96 hexadecimal digits (optional `0x`) or standard Base64/Base64URL
-   `nonce`: non-negative 32-bit integer (number only)
-   `scheduled`: one to 100 boolean occurrences; arrays and repeated DSL calls preserve their order, and the final value selects the response/cache entry
-   `useCache`: boolean

**Returns `{ transactions: [] }` on 404** (not `null`)

---

## TypeScript & module formats

-   **Compiler requirement:** TypeScript 5.9 or newer for the published declarations
-   **Fully typed:** All builders, DSLs, and responses have complete TypeScript definitions
-   **Lossless `int64` values:** `Int64` is `number | string`; safe integer literals are returned as numbers and unsafe literals as exact decimal strings
-   **Wire-accurate DTOs:** Nullable and optional response fields follow the Mirror Node schema and verified public-node behavior
-   **Stable page ergonomics:** Raw API collections may be omitted, but client page objects always expose an array plus `next()` / `next.url()`
-   **Forward-compatible labels:** Known transaction types provide autocomplete while newer provider/fork labels remain accepted
-   **Nameable resource handles:** Resource handle types returned by `accounts()`, `tokens()`, and the other top-level factories are exported, so downstream libraries can emit declarations without referring to client internals
-   **Dual format:** Ships with both ESM and CJS builds
-   **Tree-shakeable:** Package is marked `sideEffects: false`

**ESM:**

```ts
import { HederaRestClient } from "@davincigraph/hedera-rest-client";
```

**CJS:**

```js
const { HederaRestClient } = require("@davincigraph/hedera-rest-client");
```

---

## License

MIT © DaVinciGraph
