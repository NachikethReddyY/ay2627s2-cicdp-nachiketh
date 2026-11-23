import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort } from "node:worker_threads";
import { Linter } from "eslint";
import { format } from "prettier/standalone";
import babel from "prettier/plugins/babel";
import estree from "prettier/plugins/estree";
import typescript from "prettier/plugins/typescript";
import ruff from "@astral-sh/ruff-wasm-nodejs";
import { formatFindings } from "./format.ts";
import { JS_RULES, NODE_GLOBALS, PYTHON_RULES, SYNTAX_RULE_ID, TS_RULES } from "./rules.ts";
import type { Finding, LintLanguage } from "./index.ts";

const require = createRequire(import.meta.url);
const ts6 = pathToFileURL(require.resolve("@typescript/typescript6")).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "typescript" ? { url: ts6, format: "commonjs", shortCircuit: true } : nextResolve(specifier, context),
});

const { parser: tsParser } = await import("@typescript-eslint/parser").then((m) => ({ parser: m }));
const tsPlugin = (await import("@typescript-eslint/eslint-plugin")).default;

const linter = new Linter({ configType: "flat" });

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

async function lint(code: string, language: LintLanguage): Promise<Finding[]> {
  const found = language === "python" ? lintPython(code) : lintEslint(code, language);
  if (!found.some(({ ruleId }) => ruleId === SYNTAX_RULE_ID || ruleId === "invalid-syntax")) {
    if (language === "python") {
      found.push(...formatFindings(code, workspace.format(code), "Ruff"));
    } else {
      try {
        const isTypeScript = language === "typescript";
        const formatted = await format(code, {
          parser: isTypeScript ? "typescript" : "babel",
          plugins: [isTypeScript ? typescript : babel, estree],
          singleQuote: true,
        });
        found.push(...formatFindings(code, formatted, "Prettier"));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

parentPort!.on("message", async (msg: { id: number; code: string; language: LintLanguage }) => {
  try {
    parentPort!.postMessage({ id: msg.id, findings: await lint(msg.code, msg.language) });
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, error: e instanceof Error ? e.message : "lint failed" });
  }
});
parentPort!.postMessage({ ready: true });
