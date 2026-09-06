import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/core/errors";
import { requestOptionArgs } from "../../src/core/request-options";

describe("request option validation", () => {
	it("accepts empty options, timeouts, signals, and null-prototype records", () => {
		const controller = new AbortController();
		expect(requestOptionArgs({})).toEqual([]);
		expect(requestOptionArgs({ timeoutMs: 1 })).toEqual([undefined, 1]);
		expect(requestOptionArgs({ signal: controller.signal })).toEqual([controller.signal]);

		const options = Object.assign(Object.create(null), { timeoutMs: 10 }) as { timeoutMs: number };
		expect(requestOptionArgs(options)).toEqual([undefined, 10]);
	});

	it.each([
		null,
		[],
		new Date(),
		{ timeOutMs: 10 },
		{ timeoutMs: 0 },
		{ timeoutMs: 1.5 },
		{ timeoutMs: Number.NaN },
		{ signal: {} },
	])("rejects malformed request options %#", (options) => {
		expect(() => requestOptionArgs(options as never)).toThrow(ValidationError);
	});

	it("rejects symbol properties instead of silently ignoring them", () => {
		const option = { [Symbol("timeout")]: 10 };
		expect(() => requestOptionArgs(option as never)).toThrow(/Unknown request option/);
	});

	it("throws an already-aborted signal's exact standard reason", () => {
		const controller = new AbortController();
		const reason = new DOMException("cancelled by caller", "AbortError");
		controller.abort(reason);

		expect(() => requestOptionArgs({ signal: controller.signal })).toThrow(reason);
	});

	it("uses the standard AbortError when AbortController.abort() has no explicit reason", () => {
		const controller = new AbortController();
		controller.abort();

		expect(() => requestOptionArgs({ signal: controller.signal })).toThrow(expect.objectContaining({ name: "AbortError" }));
	});
});
