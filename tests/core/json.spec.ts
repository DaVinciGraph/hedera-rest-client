import { describe, expect, it, vi } from "vitest";
import { readJsonResponse } from "../../src/core/json";

describe("readJsonResponse", () => {
	it("keeps ordinary numbers and the safe integer boundaries as numbers", async () => {
		const value = await readJsonResponse<Record<string, number>>(
			new Response('{"zero":0,"negativeZero":-0,"small":42,"max":9007199254740991,"min":-9007199254740991}')
		);

		expect(value.zero).toBe(0);
		expect(Object.is(value.negativeZero, -0)).toBe(true);
		expect(value.small).toBe(42);
		expect(value.max).toBe(Number.MAX_SAFE_INTEGER);
		expect(value.min).toBe(Number.MIN_SAFE_INTEGER);
	});

	it("converts only unsafe integer literals to their exact decimal strings", async () => {
		const value = await readJsonResponse<{
			positive: string;
			negative: string;
			int64Max: string;
			nested: Array<{ amount: string }>;
		}>(
			new Response(
				'{"positive":9007199254740992,"negative":-9007199254740992,"int64Max":9223372036854775807,"nested":[{"amount":9007199254740993}]}'
			)
		);

		expect(value).toEqual({
			positive: "9007199254740992",
			negative: "-9007199254740992",
			int64Max: "9223372036854775807",
			nested: [{ amount: "9007199254740993" }],
		});
	});

	it("retains native number semantics for decimal and exponent literals", async () => {
		const value = await readJsonResponse<Record<string, number>>(
			new Response(
				'{"decimal":1.25,"integerLookingDecimal":9007199254740993.0,"exponent":1e3,"largeExponent":9.007199254740993e15,"overflowExponent":2.3e500,"underflowExponent":2.3e-500}'
			)
		);

		expect(value.decimal).toBe(1.25);
		expect(value.integerLookingDecimal).toBe(JSON.parse("9007199254740993.0"));
		expect(value.exponent).toBe(1000);
		expect(value.largeExponent).toBe(JSON.parse("9.007199254740993e15"));
		expect(value.overflowExponent).toBe(Infinity);
		expect(value.underflowExponent).toBe(0);
		for (const item of Object.values(value)) expect(typeof item).toBe("number");
	});

	it("leaves numeric strings unchanged and matches JSON.parse duplicate-key behavior", async () => {
		const value = await readJsonResponse<{ encoded: string; duplicate: number }>(
			new Response('{"encoded":"9223372036854775807","duplicate":1,"duplicate":2}')
		);

		expect(value).toEqual({ encoded: "9223372036854775807", duplicate: 2 });
	});

	it.each([
		'{"__proto__":{"polluted":true}}',
		'{"outer":[{"\\u005f_proto__":{"polluted":true}}]}',
		'{"__proto__":1}',
	])("rejects forbidden __proto__ keys without returning an altered-prototype object", async (text) => {
		expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
		await expect(readJsonResponse(new Response(text))).rejects.toThrow("Forbidden JSON key: __proto__");
		expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
	});

	it("allows __proto__ when it is a string value rather than an object key", async () => {
		await expect(readJsonResponse(new Response('{"value":"__proto__"}'))).resolves.toEqual({
			value: "__proto__",
		});
	});

	it("reads the original response text instead of its lossy json() method", async () => {
		const response = {
			text: vi.fn(async () => '{"value":9223372036854775807}'),
			json: vi.fn(async () => ({ value: 9223372036854776000 })),
		};

		await expect(readJsonResponse<{ value: string }>(response)).resolves.toEqual({ value: "9223372036854775807" });
		expect(response.text).toHaveBeenCalledOnce();
		expect(response.json).not.toHaveBeenCalled();
	});

	it("rejects invalid JSON", async () => {
		await expect(readJsonResponse(new Response('{"value":'))).rejects.toBeInstanceOf(SyntaxError);
	});
});
