// src/resources/base.ts

import type { ProviderName, NetworkName } from "../types";
import { ProviderRegistry, validateName } from "../core/provider";

/**
 * Base class for all resource builders (e.g., AccountsBuilder, TokensBuilder).
 *
 * What this class does
 * --------------------
 * - Stores **builder‑local overrides** for `provider` and `network`.
 * - Exposes **fluent setters** (`provider()`, `network()`) so callers can write:
 *   ```ts
 *   const tokens = new TokensBuilder(registry)
 *     .provider("myProvider")
 *     .network("mainnet");
 *   ```
 * - Provides a protected {@link resolve} helper that asks the shared
 *   {@link ProviderRegistry} to compute the final target (provider+network and any
 *   other registry‑specific data) **right before a request is executed**.
 *
 * Why it matters
 * --------------
 * All concrete builders call `this.resolve()` inside their `get()` methods. This
 * ensures the most recent `provider()`/`network()` overrides are honored at the
 * moment of the request, and that per‑network behaviors (like default limits) are
 * correctly derived by the registry.
 *
 * Fluent typing
 * -------------
 * The generic `TBuilder` type parameter lets subclass setters return *their own*
 * concrete builder type for chainability (e.g., `TokensBuilder` returns
 * `TokensBuilder` from `.provider()`).
 *
 * Usage examples
 * --------------
 * ```ts
 * // Set overrides once and reuse:
 * const accounts = new AccountsBuilder(registry)
 *   .provider("primary")
 *   .network("mainnet");
 *
 * const page = await accounts.list({ limit: 25 }).get();
 *
 * // Change provider on the fly (takes effect at the next .get()):
 * accounts.provider("failover");
 * const next = await accounts.list({ limit: 25 }).get();
 * ```
 *
 * Practical notes
 * ---------------
 * - Provider/network values must be non-empty strings and are checked by the
 *   fluent setters. Membership in the configured registry is checked by
 *   `resolve()` when a request executes.
 * - Because `provider()` and `network()` mutate the builder, avoid sharing the same
 *   builder instance across unrelated concurrent operations if they require different
 *   targets. Prefer creating dedicated builder instances per workflow.
 */
export abstract class ResourceBuilder<TBuilder> {
	/**
	 * The *current* provider override for this builder (if any).
	 * If unset, the registry’s defaults will be used.
	 */
	protected currentProvider?: ProviderName;

	/**
	 * The *current* network override for this builder (if any).
	 * If unset, the registry’s defaults will be used.
	 */
	protected currentNetwork?: NetworkName;

	/**
	 * Create a builder bound to a shared {@link ProviderRegistry}.
	 *
	 * @param registry A shared registry that knows how to route requests to the correct
	 *                 provider and network, and how to fail over if enabled.
	 * @param provider Optional initial provider override for this builder.
	 * @param network  Optional initial network override for this builder.
	 */
	constructor(protected registry: ProviderRegistry, provider?: ProviderName, network?: NetworkName) {
		if (provider !== undefined) validateName(provider, "provider");
		if (network !== undefined) validateName(network, "network");
		this.currentProvider = provider;
		this.currentNetwork = network;
	}

	/**
	 * Set or change the provider override for this builder.
	 *
	 * Behavior
	 * --------
	 * - Validates the required name immediately; configured-provider membership is
	 *   checked by {@link ProviderRegistry.resolve} when a request is executed.
	 * - Returns the concrete builder type (`TBuilder`) to support fluent chaining.
	 *
	 * @example
	 * ```ts
	 * const b = new BlocksBuilder(registry).provider("primary");
	 * ```
	 *
	 * @param name The provider identifier (as registered in the {@link ProviderRegistry}).
	 * @returns The builder instance (to allow chaining).
	 */
	provider(name: ProviderName): TBuilder {
		validateName(name, "provider");
		this.currentProvider = name;
		// @ts-expect-error fluent override
		return this;
	}

	/**
	 * Set or change the network override for this builder.
	 *
	 * Behavior
	 * --------
	 * - Validates the required name immediately; configured-network membership is
	 *   checked by {@link ProviderRegistry.resolve} when a request is executed.
	 * - Returns the concrete builder type (`TBuilder`) to support fluent chaining.
	 *
	 * @example
	 * ```ts
	 * const b = new TransactionsBuilder(registry).network("testnet");
	 * ```
	 *
	 * @param name The network identifier (as registered in the {@link ProviderRegistry}).
	 * @returns The builder instance (to allow chaining).
	 */
	network(name: NetworkName): TBuilder {
		validateName(name, "network");
		this.currentNetwork = name;
		// @ts-expect-error fluent override
		return this;
	}

	/**
	 * Resolve the effective target (provider + network + registry‑specific details)
	 * to be used for the next request.
	 *
	 * When this is called
	 * -------------------
	 * Concrete builders invoke `resolve()` **inside their `get()` methods** so that any
	 * `provider()`/`network()` changes made just before `get()` are applied.
	 *
	 * Return value
	 * ------------
	 * The shape is defined by {@link ProviderRegistry.resolve}. It typically includes:
	 * - the chosen provider name,
	 * - the chosen network name,
	 * - and any additional data the registry needs to perform the HTTP call.
	 */
	protected resolve() {
		return this.registry.resolve(this.currentProvider, this.currentNetwork);
	}
}
