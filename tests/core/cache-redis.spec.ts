import { describe, expect, it, vi } from "vitest";

import { RedisCacheAdapter } from "../../src/core/cache-redis";

describe("RedisCacheAdapter.clear", () => {
	it("uses node-redis raw command shapes and never deletes keys outside its prefix", async () => {
		const sendCommand = vi.fn(async (command: string[]) => {
			if (command[0] === "SCAN" && command[1] === "0") {
				// Include an unrelated key deliberately. The adapter must treat MATCH as
				// an optimization and enforce the prefix locally before DEL.
				return ["7", ["hedera:one", "other:must-survive"]];
			}
			if (command[0] === "SCAN" && command[1] === "7") {
				return ["0", ["hedera:two", "hedera:one"]];
			}
			if (command[0] === "DEL") return command.length - 1;
			throw new Error(`Unexpected command: ${command.join(" ")}`);
		});
		const scan = vi.fn(() => {
			throw new Error("high-level scan must not be used");
		});
		const del = vi.fn(() => {
			throw new Error("high-level del must not be used");
		});

		const cache = new RedisCacheAdapter({
			client: { sendCommand, scan, del },
			keyPrefix: "hedera:",
			scanCount: 25,
		});

		await cache.clear();

		expect(sendCommand.mock.calls).toEqual([
			[["SCAN", "0", "MATCH", "hedera:*", "COUNT", "25"]],
			[["DEL", "hedera:one"]],
			[["SCAN", "7", "MATCH", "hedera:*", "COUNT", "25"]],
			[["DEL", "hedera:two", "hedera:one"]],
		]);
		expect(scan).not.toHaveBeenCalled();
		expect(del).not.toHaveBeenCalled();
	});

	it("deletes each SCAN page in bounded chunks instead of retaining the keyspace", async () => {
		const keys = Array.from({ length: 2_001 }, (_, index) => `hedera:${index}`);
		const sendCommand = vi.fn(async (command: string[]) => {
			if (command[0] === "SCAN") return ["0", keys];
			if (command[0] === "DEL") return command.length - 1;
			throw new Error(`Unexpected command: ${command.join(" ")}`);
		});
		const cache = new RedisCacheAdapter({ client: { sendCommand }, keyPrefix: "hedera:" });

		await cache.clear();

		const deletes = sendCommand.mock.calls.map(([command]) => command).filter((command) => command[0] === "DEL");
		expect(deletes.map((command) => command.length - 1)).toEqual([1_000, 1_000, 1]);
	});

	it("uses ioredis raw command shapes and escapes glob metacharacters in the prefix", async () => {
		const prefix = "tenant:*?[x]\\:";
		const call = vi.fn(async (...command: string[]) => {
			if (command[0] === "SCAN") {
				// Simulate a server/client that returns false positives despite MATCH.
				return ["0", [`${prefix}one`, "tenant:unrelated", `${prefix}two`]];
			}
			if (command[0] === "DEL") return command.length - 1;
			throw new Error(`Unexpected command: ${command.join(" ")}`);
		});
		const sendCommand = vi.fn(() => {
			throw new Error("node-redis sendCommand shape must not be used");
		});

		const cache = new RedisCacheAdapter({ client: { call, sendCommand }, keyPrefix: prefix });

		await cache.clear();

		expect(call.mock.calls).toEqual([
			["SCAN", "0", "MATCH", "tenant:\\*\\?\\[x\\]\\\\:*", "COUNT", "500"],
			["DEL", `${prefix}one`, `${prefix}two`],
		]);
		expect(sendCommand).not.toHaveBeenCalled();
	});

	it("does nothing when no prefix is configured", async () => {
		const call = vi.fn();
		const sendCommand = vi.fn();
		const cache = new RedisCacheAdapter({ client: { call, sendCommand } });

		await cache.clear();

		expect(call).not.toHaveBeenCalled();
		expect(sendCommand).not.toHaveBeenCalled();
	});
});

describe("RedisCacheAdapter storage", () => {
	it("uses one atomic node-redis SET PX command with fractional-millisecond rounding", async () => {
		const sendCommand = vi.fn().mockResolvedValue("OK");
		const cache = new RedisCacheAdapter({ client: { sendCommand }, keyPrefix: "hedera:" });

		await cache.set("key", { ok: true }, 1.0001);

		expect(sendCommand).toHaveBeenCalledOnce();
		const command = sendCommand.mock.calls[0]![0] as string[];
		expect(command).toEqual(["SET", "hedera:key", expect.any(String), "PX", "1001"]);
		expect(JSON.parse(command[2]!)).toMatchObject({ v: { ok: true } });
	});

	it("uses ioredis call syntax and gives a positive sub-millisecond TTL a 1 ms lease", async () => {
		const call = vi.fn().mockResolvedValue("OK");
		const sendCommand = vi.fn();
		const cache = new RedisCacheAdapter({ client: { call, sendCommand } });

		await cache.set("key", "value", 0.0001);

		expect(call).toHaveBeenCalledWith("SET", "key", expect.any(String), "PX", "1");
		expect(sendCommand).not.toHaveBeenCalled();
	});

	it("deletes rather than writing a zero-TTL entry", async () => {
		const sendCommand = vi.fn().mockResolvedValue(1);
		const cache = new RedisCacheAdapter({ client: { sendCommand } });

		await cache.set("key", "value", 0);

		expect(sendCommand).toHaveBeenCalledOnce();
		expect(sendCommand).toHaveBeenCalledWith(["DEL", "key"]);
	});

	it("supports friendly-only clients with millisecond expiry", async () => {
		const client = {
			get: vi.fn(),
			set: vi.fn().mockResolvedValue("OK"),
			del: vi.fn(),
			pExpire: vi.fn().mockResolvedValue(true),
		};
		const cache = new RedisCacheAdapter({ client });

		await cache.set("key", "value", 1.25);

		expect(client.set).toHaveBeenCalledWith("key", expect.any(String));
		expect(client.pExpire).toHaveBeenCalledWith("key", 1_250);
	});

	it("rounds up only when a friendly client exposes second-level expiry", async () => {
		const client = {
			get: vi.fn(),
			set: vi.fn().mockResolvedValue("OK"),
			del: vi.fn(),
			expire: vi.fn().mockResolvedValue(true),
		};
		const cache = new RedisCacheAdapter({ client });

		await cache.set("key", "value", 1.25);

		expect(client.expire).toHaveBeenCalledWith("key", 2);
	});

	it("does not race-delete a newer value when friendly expiry setup fails", async () => {
		const expiryError = new Error("expiry unavailable");
		const client = {
			get: vi.fn(),
			set: vi.fn().mockResolvedValue("OK"),
			del: vi.fn().mockResolvedValue(1),
			pExpire: vi.fn().mockRejectedValue(expiryError),
		};
		const cache = new RedisCacheAdapter({ client });

		await expect(cache.set("key", "value", 10)).rejects.toBe(expiryError);
		expect(client.del).not.toHaveBeenCalled();
	});

	it("serializes friendly SET plus expiry per key so each value receives its own TTL", async () => {
		let releaseFirstExpiry!: () => void;
		const firstExpiry = new Promise<void>((resolve) => {
			releaseFirstExpiry = resolve;
		});
		const calls: string[] = [];
		const client = {
			get: vi.fn(),
			set: vi.fn(async (_key: string, payload: string) => {
				calls.push(`set:${JSON.parse(payload).v}`);
			}),
			del: vi.fn(),
			pExpire: vi.fn(async (_key: string, ttl: number) => {
				calls.push(`expire:${ttl}`);
				if (ttl === 1_000) await firstExpiry;
				return true;
			}),
		};
		const cache = new RedisCacheAdapter<string>({ client });

		const first = cache.set("key", "first", 1);
		await vi.waitFor(() => expect(calls).toEqual(["set:first", "expire:1000"]));
		const second = cache.set("key", "second", 10);

		await Promise.resolve();
		expect(calls).toEqual(["set:first", "expire:1000"]);

		releaseFirstExpiry();
		await Promise.all([first, second]);
		expect(calls).toEqual(["set:first", "expire:1000", "set:second", "expire:10000"]);
		expect((cache as any).friendlyMutationTails.size).toBe(0);
	});

	it("shares friendly per-key serialization across adapters using the same client", async () => {
		let releaseFirstExpiry!: () => void;
		const firstExpiry = new Promise<void>((resolve) => {
			releaseFirstExpiry = resolve;
		});
		const calls: string[] = [];
		const client = {
			get: vi.fn(),
			set: vi.fn(async (_key: string, payload: string) => {
				calls.push(`set:${JSON.parse(payload).v}`);
			}),
			del: vi.fn(),
			pExpire: vi.fn(async (_key: string, ttl: number) => {
				calls.push(`expire:${ttl}`);
				if (ttl === 1_000) await firstExpiry;
				return true;
			}),
		};
		const firstCache = new RedisCacheAdapter<string>({ client, keyPrefix: "shared:" });
		const secondCache = new RedisCacheAdapter<string>({ client, keyPrefix: "shared:" });

		const first = firstCache.set("key", "first", 1);
		await vi.waitFor(() => expect(calls).toEqual(["set:first", "expire:1000"]));
		const second = secondCache.set("key", "second", 10);
		await Promise.resolve();
		expect(calls).toEqual(["set:first", "expire:1000"]);

		releaseFirstExpiry();
		await Promise.all([first, second]);
		expect(calls).toEqual(["set:first", "expire:1000", "set:second", "expire:10000"]);
		expect((firstCache as any).friendlyMutationTails).toBe((secondCache as any).friendlyMutationTails);
		expect((firstCache as any).friendlyMutationTails.size).toBe(0);
	});

	it("queues a no-expiry adapter behind an expiring write on the same friendly client and key", async () => {
		let releaseExpiry!: () => void;
		const expiry = new Promise<void>((resolve) => {
			releaseExpiry = resolve;
		});
		const calls: string[] = [];
		const client = {
			get: vi.fn(),
			set: vi.fn(async (_key: string, payload: string) => {
				calls.push(`set:${JSON.parse(payload).v}`);
			}),
			del: vi.fn(),
			pExpire: vi.fn(async (_key: string, ttl: number) => {
				calls.push(`expire:${ttl}`);
				await expiry;
				return true;
			}),
		};
		const expiring = new RedisCacheAdapter<string>({ client, keyPrefix: "shared:" });
		const noExpiry = new RedisCacheAdapter<string>({ client, keyPrefix: "shared:", useRedisExpire: false });

		const first = expiring.set("key", "expiring", 1);
		await vi.waitFor(() => expect(calls).toEqual(["set:expiring", "expire:1000"]));
		const second = noExpiry.set("key", "persistent", 10);
		await Promise.resolve();
		expect(calls).toEqual(["set:expiring", "expire:1000"]);

		releaseExpiry();
		await Promise.all([first, second]);
		expect(calls).toEqual(["set:expiring", "expire:1000", "set:persistent"]);
		expect(client.pExpire).toHaveBeenCalledOnce();
		expect((expiring as any).friendlyMutationTails.size).toBe(0);
	});

	it("queues a no-expiry adapter delete behind an expiring write on the same friendly client and key", async () => {
		let releaseExpiry!: () => void;
		const expiry = new Promise<void>((resolve) => {
			releaseExpiry = resolve;
		});
		const calls: string[] = [];
		const client = {
			get: vi.fn(),
			set: vi.fn(async () => {
				calls.push("set");
			}),
			del: vi.fn(async () => {
				calls.push("delete");
			}),
			pExpire: vi.fn(async () => {
				calls.push("expire");
				await expiry;
			}),
		};
		const expiring = new RedisCacheAdapter({ client, keyPrefix: "shared:" });
		const noExpiry = new RedisCacheAdapter({ client, keyPrefix: "shared:", useRedisExpire: false });

		const write = expiring.set("key", "value", 1);
		await vi.waitFor(() => expect(calls).toEqual(["set", "expire"]));
		const deletion = noExpiry.delete("key");
		await Promise.resolve();
		expect(calls).toEqual(["set", "expire"]);

		releaseExpiry();
		await Promise.all([write, deletion]);
		expect(calls).toEqual(["set", "expire", "delete"]);
		expect((expiring as any).friendlyMutationTails.size).toBe(0);
	});

	it("does not serialize friendly mutations for different physical keys", async () => {
		let releaseFirstSet!: () => void;
		const firstSet = new Promise<void>((resolve) => {
			releaseFirstSet = resolve;
		});
		const client = {
			get: vi.fn(),
			set: vi.fn(async (key: string) => {
				if (key === "first") await firstSet;
			}),
			del: vi.fn(),
			pExpire: vi.fn().mockResolvedValue(true),
		};
		const cache = new RedisCacheAdapter({ client });

		const first = cache.set("first", "value", 1);
		await vi.waitFor(() => expect(client.set).toHaveBeenCalledWith("first", expect.any(String)));
		const second = cache.set("second", "value", 2);

		await expect(second).resolves.toBeUndefined();
		expect(client.pExpire).toHaveBeenCalledWith("second", 2_000);
		releaseFirstSet();
		await first;
		expect((cache as any).friendlyMutationTails.size).toBe(0);
	});

	it("continues and cleans up the per-key queue after a friendly expiry failure", async () => {
		const expiryError = new Error("first expiry failed");
		const client = {
			get: vi.fn(),
			set: vi.fn().mockResolvedValue("OK"),
			del: vi.fn(),
			pExpire: vi.fn().mockRejectedValueOnce(expiryError).mockResolvedValueOnce(true),
		};
		const cache = new RedisCacheAdapter({ client });

		const first = cache.set("key", "first", 1);
		const second = cache.set("key", "second", 2);

		await expect(first).rejects.toBe(expiryError);
		await expect(second).resolves.toBeUndefined();
		expect(client.set).toHaveBeenCalledTimes(2);
		expect(client.pExpire.mock.calls).toEqual([
			["key", 1_000],
			["key", 2_000],
		]);
		expect((cache as any).friendlyMutationTails.size).toBe(0);
	});

	it("orders a friendly delete after an in-flight two-command write", async () => {
		let releaseExpiry!: () => void;
		const expiry = new Promise<void>((resolve) => {
			releaseExpiry = resolve;
		});
		const calls: string[] = [];
		const client = {
			get: vi.fn(),
			set: vi.fn(async () => {
				calls.push("set");
			}),
			del: vi.fn(async () => {
				calls.push("delete");
			}),
			pExpire: vi.fn(async () => {
				calls.push("expire");
				await expiry;
			}),
		};
		const cache = new RedisCacheAdapter({ client });

		const write = cache.set("key", "value", 1);
		await vi.waitFor(() => expect(calls).toEqual(["set", "expire"]));
		const deletion = cache.delete("key");
		await Promise.resolve();
		expect(calls).toEqual(["set", "expire"]);

		releaseExpiry();
		await Promise.all([write, deletion]);
		expect(calls).toEqual(["set", "expire", "delete"]);
		expect((cache as any).friendlyMutationTails.size).toBe(0);
	});

	it("accepts finite fractional expiration timestamps", async () => {
		const expiresAt = Date.now() + 10_000.5;
		const client = {
			get: vi.fn().mockResolvedValue(JSON.stringify({ v: "value", e: expiresAt })),
			set: vi.fn(),
			del: vi.fn(),
			pExpire: vi.fn(),
		};
		const cache = new RedisCacheAdapter({ client });

		await expect(cache.get("key")).resolves.toEqual({ value: "value", expiresAt });
	});

	it("treats malformed JSON as a miss without a racy delete", async () => {
		const client = {
			get: vi.fn().mockResolvedValue("{not-json"),
			set: vi.fn(),
			del: vi.fn(),
			pExpire: vi.fn(),
		};
		const cache = new RedisCacheAdapter({ client });

		await expect(cache.get("key")).resolves.toBeUndefined();
		expect(client.del).not.toHaveBeenCalled();
	});
});

describe("RedisCacheAdapter validation", () => {
	it("rejects unknown string and symbol options", () => {
		expect(() => new RedisCacheAdapter({ client: { sendCommand: vi.fn() }, typo: true } as any)).toThrow(/typo/);
		const marker = Symbol("typo");
		const options: any = { client: { sendCommand: vi.fn() } };
		options[marker] = true;
		expect(() => new RedisCacheAdapter(options)).toThrow(/Symbol\(typo\)/);
	});

	it("rejects arrays, class instances, and structurally incomplete clients", () => {
		expect(() => new RedisCacheAdapter([] as any)).toThrow(/options must be an object/);
		expect(() => new RedisCacheAdapter(new (class Options {})() as any)).toThrow(/options must be an object/);
		expect(() => new RedisCacheAdapter({ client: {} })).toThrow(/get/);
		expect(() =>
			new RedisCacheAdapter({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } })
		).toThrow(/expiry method|pExpire/);
	});

	it("allows prefixed friendly clients and rejects only unsupported clear usage", async () => {
		const cache = new RedisCacheAdapter({
			client: { get: vi.fn(), set: vi.fn(), del: vi.fn(), pExpire: vi.fn() },
			keyPrefix: "hedera:",
		});

		await expect(cache.clear()).rejects.toThrow(/call|sendCommand/);
	});

	it("accepts a complete friendly client when Redis expiry is disabled", () => {
		expect(
			() =>
				new RedisCacheAdapter({
					client: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
					useRedisExpire: false,
				})
		).not.toThrow();
	});
});
