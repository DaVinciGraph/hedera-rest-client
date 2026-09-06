// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	format: ["esm", "cjs"], // emit both ESM and CJS
	dts: true, // generate .d.ts from your TS types
	sourcemap: true,
	clean: true,
	target: "node18", // match the package's documented runtime floor
	// esbuild already tree-shakes bundled output. Avoid tsup's additional Rollup
	// pass, which emits a source-map trailer before tsup adds its own trailer.
	treeshake: false,
	minify: false, // keep library sources readable for debugging
	skipNodeModulesBundle: true, // keep runtime dependencies external
});
