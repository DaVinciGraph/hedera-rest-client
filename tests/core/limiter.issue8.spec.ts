import { describe, expect, it, vi } from "vitest";
import { LimiterCapacityError, LimiterRegistry } from "../../src/core/limiter";

describe("LimiterRegistry shared bucket semantics", () => {
	it("returns one Bottleneck instance for queue and overflow behavior", async () => {
		const registry = new LimiterRegistry();
		const config = { reservoir: 1 };
		const queueLimiter = registry.get("provider:testnet", config, "queue")!;
		const overflowLimiter = registry.get("provider:testnet", config, "overflow")!;

		try {
			expect(overflowLimiter).toBe(queueLimiter);
		} finally {
			await queueLimiter.stop({ dropWaitingJobs: true });
		}
	});

	it("makes overflow observe reservoir capacity already consumed in queue mode", async () => {
		const registry = new LimiterRegistry();
		const config = { reservoir: 1 };
		const limiter = registry.get("provider:testnet", config)!;
		const overflowTask = vi.fn(async () => "must not run");

		try {
			await expect(registry.schedule("provider:testnet", config, "queue", async () => "queued result")).resolves.toBe("queued result");
			await expect(registry.schedule("provider:testnet", config, "overflow", overflowTask)).rejects.toMatchObject({
				name: "LimiterCapacityError",
				bucket: "provider:testnet",
			});
			expect(overflowTask).not.toHaveBeenCalled();
			expect(await limiter.currentReservoir()).toBe(0);
		} finally {
			await limiter.stop({ dropWaitingJobs: true });
		}
	});

	it("admits exactly one concurrent overflow probe when one token is available", async () => {
		const registry = new LimiterRegistry();
		const config = { reservoir: 1, maxConcurrent: 1 };
		const limiter = registry.get("provider:testnet", config)!;
		const task = vi.fn(async (value: number) => value);

		try {
			const results = await Promise.allSettled(
				Array.from({ length: 12 }, (_, index) =>
					registry.schedule("provider:testnet", config, "overflow", () => task(index))
				)
			);

			const fulfilled = results.filter((result) => result.status === "fulfilled");
			const rejected = results.filter((result) => result.status === "rejected");

			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(11);
			expect(task).toHaveBeenCalledTimes(1);
			expect(await limiter.currentReservoir()).toBe(0);
			for (const result of rejected) {
				if (result.status === "rejected") expect(result.reason).toBeInstanceOf(LimiterCapacityError);
			}
		} finally {
			await limiter.stop({ dropWaitingJobs: true });
		}
	});

	it("does not let immediate tasks reuse capacity within one overflow burst", async () => {
		const registry = new LimiterRegistry();
		const config = { maxConcurrent: 5 };
		const limiter = registry.get("provider:testnet", config)!;
		const task = vi.fn(async (value: number) => value);

		try {
			const results = await Promise.allSettled(
				Array.from({ length: 100 }, (_, index) =>
					registry.schedule("provider:testnet", config, "overflow", () => task(index))
				)
			);

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
			expect(results.filter((result) => result.status === "rejected")).toHaveLength(95);
			expect(task).toHaveBeenCalledTimes(5);
		} finally {
			await limiter.stop({ dropWaitingJobs: true });
		}
	});

	it("admits every immediately available reservoir and concurrency slot exactly once", async () => {
		const registry = new LimiterRegistry();
		const config = { reservoir: 5, maxConcurrent: 5 };
		const limiter = registry.get("provider:testnet", config)!;
		let releaseTasks!: () => void;
		const taskGate = new Promise<void>((resolve) => {
			releaseTasks = resolve;
		});
		const task = vi.fn(async (value: number) => {
			await taskGate;
			return value;
		});
		const resultsPromise = Promise.allSettled(
			Array.from({ length: 20 }, (_, index) =>
				registry.schedule("provider:testnet", config, "overflow", () => task(index))
			)
		);

		try {
			await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(5), { timeout: 1_000 });
			expect(await limiter.currentReservoir()).toBe(0);
		} finally {
			releaseTasks();
			await resultsPromise;
			await limiter.stop({ dropWaitingJobs: true });
		}

		const results = await resultsPromise;
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(15);
	});

	it("does not admit concurrent minTime probes into future time slots", async () => {
		const registry = new LimiterRegistry();
		const config = { minTime: 100 };
		const limiter = registry.get("provider:testnet", config)!;
		const task = vi.fn(async (value: number) => value);

		try {
			const results = await Promise.allSettled(
				Array.from({ length: 12 }, (_, index) =>
					registry.schedule("provider:testnet", config, "overflow", () => task(index))
				)
			);

			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			expect(results.filter((result) => result.status === "rejected")).toHaveLength(11);
			expect(task).toHaveBeenCalledTimes(1);
		} finally {
			await limiter.stop({ dropWaitingJobs: true });
		}
	});

	it("bypasses Bottleneck when no limiter configuration is present", async () => {
		const registry = new LimiterRegistry();
		const task = vi.fn(() => 42);

		await expect(registry.schedule("unlimited", undefined, "overflow", task)).resolves.toBe(42);
		expect(task).toHaveBeenCalledOnce();
		expect(registry.get("unlimited", undefined)).toBeUndefined();
	});
});
