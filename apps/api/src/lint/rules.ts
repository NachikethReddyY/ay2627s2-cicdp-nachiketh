import globals from "globals";

// Rule sets for the learner-code checker. Everything here is data: no config file loading, no plugin auto-resolution.
// The checker only parses learner code and never runs it. Autofix output is never read.

/** Severity is irrelevant to the learner: every enabled rule is reported. */
export const JS_RULES = {
  "no-undef": "error",
  "no-unused-vars": "error",
  "prefer-const": "error",
  "no-var": "error",
  eqeqeq: "error",
  "no-unreachable": "error",
  "no-constant-condition": "error",
  "no-dupe-keys": "error",
  "no-self-assign": "error",
  "no-empty": "error",
} as const;

/** TypeScript: the same set, with the typescript-eslint unused-vars rule and no-undef off (the parser has no type info). */
export const TS_RULES = {
  ...JS_RULES,
  "no-undef": "off",
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": "error",
} as const;

/** Node globals (require, module, process, console, __dirname, ...) are declared so no-undef accepts them. */
export const NODE_GLOBALS: Record<string, "readonly"> = Object.fromEntries(
  Object.keys(globals.node).map((name) => [name, "readonly" as const]),
);

/** Ruff rule codes enabled for Python. */
export const PYTHON_RULES = ["F401", "F841", "F821", "E711", "E712", "E722", "E741", "B006", "N802", "N806"] as const;

/** Rule id reported when the code does not parse. */
export const SYNTAX_RULE_ID = "syntax-error";
