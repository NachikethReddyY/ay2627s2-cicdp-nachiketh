import globals from "globals";

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

export const TS_RULES = {
  ...JS_RULES,
  "no-undef": "off",
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": "error",
} as const;

export const NODE_GLOBALS: Record<string, "readonly"> = Object.fromEntries(
  Object.keys(globals.node).map((name) => [name, "readonly" as const]),
);

export const PYTHON_RULES = ["F401", "F841", "F821", "E711", "E712", "E722", "E741", "B006", "N802", "N806"] as const;

export const SYNTAX_RULE_ID = "syntax-error";
