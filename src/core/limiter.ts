// src/core/limiter.ts

import Bottleneck from "bottleneck";
import type { LimiterConfig } from "../types";

export type LimiterBehavior = "queue" | "overflow";

/**
 * Raised when an overflow-mode request cannot start immediately.
 *
 * This is intentionally distinct from Bottleneck's general-purpose errors so
 * callers do not mistake configuration, shutdown, or task failures for a
 * capacity miss.
 */
export class LimiterCapacityError extends Error {
	constructor(public readonly bucket: string) {
		super(`Rate limiter bucket '${bucket}' has no immediate capacity`);
		this.name = "LimiterCapacityError";
	}
}

interface LimiterEntry {
	limiter: Bottleneck;
	pendingRegistration: Set<string>;
	version: number;
	nextId: number;
	minTime: number;
	overflowQueue: OverflowAdmission[];
	overflowFlushScheduled: boolean;
}

interface OverflowAdmission {
	task: () => unknown | PromiseLike<unknown>;
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
}

/**
 * Registry of Bottleneck rate limiters keyed by logical provider buckets.
 *
 * A bucket owns exactly one Bottleneck instance. Queueing and overflow routing
 * are scheduling decisions over that shared instance, so both modes observe
 * the same reservoir, minimum spacing, concurrency, and pending work.
 */
export class LimiterRegistry {
	private map = new Map<string, LimiterEntry>();

	private entry(bucket: string, cfg?: LimiterConfig) {
		if (!cfg) return undefined;

		let entry = this.map.get(bucket);
		if (!entry) {
			const limiter = new Bottleneck({
				reservoir: cfg.reservoir,
				reservoirRefreshAmount: cfg.reservoirRefreshAmount,
				reservoirRefreshInterval: cfg.reservoirRefreshInterval,
				minTime: cfg.minTime,
				maxConcurrent: cfg.maxConcurrent,
			});
			entry = {
				limiter,
				pendingRegistration: new Set(),
				version: 0,
				nextId: 0,
				minTime: cfg.minTime ?? 0,
				overflowQueue: [],
				overflowFlushScheduled: false,
			};
			const created = entry;
			limiter.on("scheduled", (info) => {
				if (created.pendingRegistration.delete(info.options.id)) created.version++;
			});
			this.map.set(bucket, entry);
		}

		return entry;
	}

	private submit<T>(entry: LimiterEntry, bucket: string, task: () => T | PromiseLike<T>): Promise<T> {
		const id = `${bucket}:attempt:${entry.nextId++}`;
		entry.pendingRegistration.add(id);
		entry.version++;
		try {
			const scheduled = entry.limiter.schedule({ id }, () => Promise.resolve(task()));
			return scheduled.catch((error) => {
				if (entry.pendingRegistration.delete(id)) entry.version++;
				throw error;
			});
		} catch (error) {
			if (entry.pendingRegistration.delete(id)) entry.version++;
			throw error;
		}
	}

	/**
	 * Decide one same-turn overflow burst against a single capacity snapshot.
	 *
	 * Bottleneck's `check()` is asynchronous. Batching prevents competing probes
	 * from repeatedly invalidating one another, and checking aggregate weights
	 * ensures only the capacity that was immediately available is admitted.
	 */
	private async flushOverflow(entry: LimiterEntry, bucket: string): Promise<void> {
		try {
			while (entry.overflowQueue.length > 0) {
				const batch = entry.overflowQueue.splice(0);
				const pending = entry.pendingRegistration.size;
				const version = entry.version;

				try {
					let available: boolean[];
					if (entry.minTime > 0) {
						// At most one member of a burst can own the current minTime slot.
						const first = pending === 0 && (await entry.limiter.check(1));
						available = batch.map((_, index) => index === 0 && first);
					} else {
						available = await Promise.all(batch.map((_, index) => entry.limiter.check(pending + index + 1)));
					}

					// A queued submission changed capacity while Bottleneck was checking.
					// Reject this probe burst conservatively instead of joining that queue.
					if (version !== entry.version) available.fill(false);
					let prefixAvailable = true;
					available = available.map((value) => (prefixAvailable = prefixAvailable && value));

					for (let index = 0; index < batch.length; index++) {
						const admission = batch[index];
						if (!available[index]) {
							admission.reject(new LimiterCapacityError(bucket));
							continue;
						}

						this.submit(entry, bucket, admission.task).then(admission.resolve, admission.reject);
					}
				} catch (error) {
					for (const admission of batch) admission.reject(error);
				}
			}
		} finally {
			entry.overflowFlushScheduled = false;
			// Defend against a future scheduling implementation that can enqueue
			// between the final queue check and clearing the flag.
			if (entry.overflowQueue.length > 0) this.queueOverflowFlush(entry, bucket);
		}
	}

	private queueOverflowFlush(entry: LimiterEntry, bucket: string): void {
		if (entry.overflowFlushScheduled) return;
		entry.overflowFlushScheduled = true;
		queueMicrotask(() => void this.flushOverflow(entry, bucket));
	}

	/**
	 * Return the limiter for a logical bucket, creating it on first use.
	 *
	 * `behavior` is retained for source compatibility with the former API, but
	 * it never changes the bucket identity. The same bucket always returns the
	 * same limiter instance.
	 */
	get(bucket: string, cfg?: LimiterConfig, _behavior: LimiterBehavior = "queue"): Bottleneck | undefined {
		return this.entry(bucket, cfg)?.limiter;
	}

	/**
	 * Schedule work against a logical limiter bucket.
	 *
	 * Queue mode delegates directly to Bottleneck. Overflow mode uses
	 * Bottleneck's native immediate-capacity check and refuses to join an
	 * existing local submission queue. Same-turn probes are evaluated as one
	 * burst so they cannot wait for each other and reuse later capacity.
	 */
	async schedule<T>(
		bucket: string,
		cfg: LimiterConfig | undefined,
		behavior: LimiterBehavior,
		task: () => T | PromiseLike<T>
	): Promise<T> {
		const entry = this.entry(bucket, cfg);
		if (!entry) return await task();
		if (behavior === "queue") return await this.submit(entry, bucket, task);

		return await new Promise<T>((resolve, reject) => {
			entry.overflowQueue.push({
				task,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.queueOverflowFlush(entry, bucket);
		});
	}
}
