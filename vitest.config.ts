// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Enable coverage on CI only; locally, run `vitest --coverage` when you want it.
		coverage: {
			enabled: process.env.CI === "true",
			provider: "v8", // fast, built-in
			reporter: ["text", "lcov", "json-summary"],
			reportsDirectory: "./coverage",

			// Keep thresholds moderate so they pass now but still catch regressions.
			// Adjust upward over time.
			thresholds: {
				lines: 75,
				functions: 75,
				statements: 75,
				branches: 65,
			},

			// Optional hygiene (Vitest excludes specs by default, but this is explicit)
			exclude: ["**/*.spec.*", "**/tests/**", "**/__mocks__/**", "**/*.d.ts"],

			// Enforce thresholds globally (not per-file)
			// perFile: false, // (default is global-only; uncomment if you want to be explicit)
		},
	},
});
