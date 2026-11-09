import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";
import { Linter } from "eslint";
import ruff from "@astral-sh/ruff-wasm-nodejs";
import { JS_RULES, NODE_GLOBALS, PYTHON_RULES, SYNTAX_RULE_ID, TS_RULES } from "./rules.ts";
import type { Finding, LintLanguage } from "./index.ts";

// Runs inside a worker_threads Worker. It only parses learner code; nothing is ever evaluated.

// typescript-eslint cannot load TypeScript 7 (it has no JS API), so inside this thread only, "typescript" resolves to
// the TypeScript 6 compatibility package. The API's own `tsc` is unaffected.
const require = createRequire(import.meta.url);
const ts6 = pathToFileURL(require.resolve("@typescript/typescript6")).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "typescript" ? { url: ts6, format: "commonjs", shortCircuit: true } : nextResolve(specifier, context),
});

const { parser: tsParser } = await import("@typescript-eslint/parser").then((m) => ({ parser: m }));
const tsPlugin = (await import("@typescript-eslint/eslint-plugin")).default;

const linter = new Linter({ configType: "flat" });

// Inline directives are ignored: learner comments cannot silence rules or add "unused directive" reports.
const linterOptions = { noInlineConfig: true, reportUnusedDisableDirectives: "off" } as const;

const jsConfig = [{ files: ["**/*.js"], linterOptions, languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: NODE_GLOBALS }, rules: JS_RULES }];
const tsConfig = [
  {
    files: ["**/*.ts"],
    linterOptions,
    languageOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", globals: NODE_GLOBALS },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: TS_RULES,
  },
];

function lintEslint(code: string, language: "javascript" | "typescript"): Finding[] {
  const isTs = language === "typescript";
  const messages = linter.verify(code, (isTs ? tsConfig : jsConfig) as never, { filename: isTs ? "input.ts" : "input.js" });
  // Only the rule id, position and message are kept; `fix` and `suggestions` are dropped on purpose.
  return messages
    .filter((m) => m.ruleId !== null || m.fatal)
    .map((m) => ({ ruleId: m.ruleId ?? SYNTAX_RULE_ID, line: m.line, column: m.column, message: m.message }));
}

type RuffDiagnostic = { code: string | null; message: string; start_location: { row: number; column: number } };
const workspace = new ruff.Workspace(
  { ...ruff.Workspace.defaultSettings(), lint: { select: [...PYTHON_RULES] } },
  ruff.PositionEncoding.Utf16,
);

function lintPython(code: string): Finding[] {
  return workspace.check(code).map((d: RuffDiagnostic) => ({
    ruleId: d.code ?? SYNTAX_RULE_ID,
    line: d.start_location.row,
    column: d.start_location.column,
    message: d.message,
  }));
}

function lint(code: string, language: LintLanguage): Finding[] {
  const found = language === "python" ? lintPython(code) : lintEslint(code, language);
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

parentPort!.on("message", (msg: { id: number; code: string; language: LintLanguage }) => {
  try {
    parentPort!.postMessage({ id: msg.id, findings: lint(msg.code, msg.language) });
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : "lint failed" });
  }
});
parentPort!.postMessage({ ready: true });
