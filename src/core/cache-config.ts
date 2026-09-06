import type { CacheConfig, ResourceCacheConfig } from "../types";
import { ConfigError } from "./errors";

export const CACHE_RESOURCE_KEYS = [
	"accounts",
	"tokens",
	"nfts",
	"blocks",
	"topics",
	"transactions",
	"schedules",
	"contracts",
	"network",
] as const satisfies ReadonlyArray<keyof NonNullable<CacheConfig["resources"]>>;

export type NormalizedCacheConfig = CacheConfig & {
	isEnabled: boolean;
	duration: number;
};

const CACHE_CONFIG_KEYS = new Set(["isEnabled", "duration", "resources", "adapter"]);
const RESOURCE_POLICY_KEYS = new Set(["isEnabled", "duration"]);

function isPlainRecord(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function validateKnownKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !allowed.has(key)) {
			throw new ConfigError(`${path}.${typeof key === "symbol" ? key.toString() : key} is not a supported option`);
		}
	}
}

function validateDuration(value: unknown, label: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new ConfigError(`${label} must be a finite, non-negative number of seconds`);
	}
	if (!Number.isFinite(value * 1_000) || Date.now() + value * 1_000 > Number.MAX_SAFE_INTEGER) {
		throw new ConfigError(`${label} is too large to represent a safe expiration time`);
	}
}

/** Validate and detach cache policy objects while retaining the adapter identity. */
export function snapshotCacheConfig(input: CacheConfig | undefined): NormalizedCacheConfig {
	if (input === undefined) return { isEnabled: false, duration: 600 };
	if (!isPlainRecord(input)) throw new ConfigError("cache must be a plain object");
	validateKnownKeys(input, CACHE_CONFIG_KEYS, "cache");
	if (input.isEnabled !== undefined && typeof input.isEnabled !== "boolean") {
		throw new ConfigError("cache.isEnabled must be a boolean");
	}

	const duration = input.duration === undefined ? 600 : input.duration;
	validateDuration(duration, "cache.duration");

	if (input.adapter !== undefined) {
		if (typeof input.adapter !== "object" || input.adapter === null) {
			throw new ConfigError("cache.adapter must be an object implementing CacheAdapter");
		}
		if (typeof input.adapter.get !== "function" || typeof input.adapter.set !== "function") {
			throw new ConfigError("cache.adapter must implement asynchronous get() and set() methods");
		}
	}

	let resources: CacheConfig["resources"];
	if (input.resources !== undefined) {
		if (!isPlainRecord(input.resources)) throw new ConfigError("cache.resources must be a plain object");
		for (const key of Reflect.ownKeys(input.resources)) {
			if (typeof key !== "string") throw new ConfigError(`cache.resources.${key.toString()} is not a supported resource`);
			if (!(CACHE_RESOURCE_KEYS as readonly string[]).includes(key)) {
				throw new ConfigError(`cache.resources.${key} is not a supported resource`);
			}
		}

		const snapshot: NonNullable<CacheConfig["resources"]> = {};
		for (const key of CACHE_RESOURCE_KEYS) {
			const value = input.resources[key];
			if (value === undefined) continue;
			if (!isPlainRecord(value)) throw new ConfigError(`cache.resources.${key} must be a plain object`);
			validateKnownKeys(value, RESOURCE_POLICY_KEYS, `cache.resources.${key}`);
			if (value.isEnabled !== undefined && typeof value.isEnabled !== "boolean") {
				throw new ConfigError(`cache.resources.${key}.isEnabled must be a boolean`);
			}
			if (value.duration !== undefined) validateDuration(value.duration, `cache.resources.${key}.duration`);
			snapshot[key] = Object.freeze({ ...value }) as ResourceCacheConfig;
		}
		resources = Object.freeze(snapshot);
	}

	return Object.freeze({
		isEnabled: input.isEnabled ?? false,
		duration,
		resources,
		adapter: input.adapter,
	});
}
