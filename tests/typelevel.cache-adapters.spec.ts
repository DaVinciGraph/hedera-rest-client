import type Redis from "ioredis";
import { describe, expect, it } from "vitest";

import {
	IndexedDbCacheAdapter,
	type IndexedDbDatabase,
	RedisCacheAdapter,
	type RedisCacheClient,
} from "../src";

describe("cache adapter client types", () => {
	it("accepts standard clients without depending on their packages in the public API", () => {
		if (false) {
			const redis = null as unknown as Redis;
			const redisShape: RedisCacheClient = redis;
			new RedisCacheAdapter({ client: redis });

			const indexedDb = null as unknown as IDBDatabase;
			const indexedDbShape: IndexedDbDatabase = indexedDb;
			new IndexedDbCacheAdapter({ db: indexedDb });

			void redisShape;
			void indexedDbShape;
		}

		expect(true).toBe(true);
	});
});
