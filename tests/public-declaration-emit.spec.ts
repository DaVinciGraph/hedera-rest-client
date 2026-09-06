import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("public declaration surface", () => {
	it("lets consumers emit named resource and operation return types", () => {
		const fixture = path.resolve("tests/fixtures/public-declaration-consumer.ts");
		const declarations = new Map<string, string>();
		const program = ts.createProgram([fixture], {
			declaration: true,
			emitDeclarationOnly: true,
			esModuleInterop: true,
			module: ts.ModuleKind.ES2022,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			skipLibCheck: true,
			strict: true,
			target: ts.ScriptTarget.ES2022,
		});
		const emit = program.emit(undefined, (fileName, contents) => declarations.set(fileName, contents));
		const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics].filter(
			(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
		);
		const formattedDiagnostics = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: (fileName) => fileName,
			getCurrentDirectory: () => process.cwd(),
			getNewLine: () => "\n",
		});
		expect(formattedDiagnostics).toBe("");

		const declaration = [...declarations.entries()].find(([fileName]) => fileName.endsWith("public-declaration-consumer.d.ts"))?.[1];
		expect(declaration).toBeDefined();
		for (const publicName of [
			"AccountsResource",
			"BalancesResource",
			"BlocksResource",
			"SchedulesResource",
			"TokensResource",
			"TopicsResource",
			"TransactionsResource",
			"ContractsResource",
			"NetworkResource",
			"OperationHandle",
		]) {
			expect(declaration).toContain(publicName);
		}
		expect(declaration).not.toMatch(/ProviderRegistry|ResolvedTarget/);
		expect(declaration).toContain("networkSupplyRequest: import(\"../../src\").OperationHandle<import(\"../../src\").NetworkSupplyResponse>");
		expect(declaration).toContain("networkTotalSupplyRequest: import(\"../../src\").OperationHandle<string>");
		expect(declaration).toContain("networkCirculatingSupplyRequest: import(\"../../src\").OperationHandle<string>");
	}, 15_000);
});
