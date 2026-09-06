import { describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "../../src/core/errors";

describe("public configuration and validation errors", () => {
	it.each([ConfigError, ValidationError])("retains Error-compatible construction without exposing ErrorOptions", (ErrorType) => {
		const cause = new Error("root cause");
		const error = new ErrorType("message", { cause });

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe(ErrorType.name);
		expect(error.message).toBe("message");
		expect((error as Error & { cause?: unknown }).cause).toBe(cause);
	});
});
