import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";
import { EFFECT_ALLOWLIST, TIMER_ALLOWLIST } from "./eslint.allowlists.js";

const EFFECT_MESSAGE =
  "Do not add useEffect. Derive the value during render, or handle it in the event handler that caused it. If it " +
  "truly syncs with something outside React, stop and ask a human; do not add this file to the allowlist.";
const TIMER_MESSAGE =
  "Do not add imperative timers (setTimeout, setInterval, requestAnimationFrame, requestIdleCallback). They patch " +
  "over a state or layout problem. Fix the cause: CSS transitions, derived state, or an existing hook.";

const TIMERS = "setTimeout|setInterval|requestAnimationFrame|requestIdleCallback";
const API_IMPORT_MESSAGE =
  "The web app may only use the API through its types: import type { AppRouter } from '@learnquest/api/router'. " +
  "Value, relative and dynamic imports of API code would ship server code to the browser.";
const EFFECTS = "use(Layout|Insertion)?Effect";
const restrictedSyntax = (restrictEffects, restrictTimers) => [
  "error",
  { selector: "ImportDeclaration[source.value=/^@learnquest\\/api/][importKind!='type']", message: API_IMPORT_MESSAGE },
  { selector: "ImportDeclaration[source.value=/(^|\\/)api\\/src\\//]", message: API_IMPORT_MESSAGE },
  { selector: "ExportNamedDeclaration[source.value=/^@learnquest\\/api/][exportKind!='type']", message: API_IMPORT_MESSAGE },
  { selector: "ExportAllDeclaration[source.value=/^@learnquest\\/api/]", message: API_IMPORT_MESSAGE },
  { selector: "ImportExpression[source.value=/(^@learnquest\\/api)|((^|\\/)api\\/src\\/)/]", message: API_IMPORT_MESSAGE },
  ...(restrictEffects
    ? [
        { selector: `CallExpression[callee.name=/^${EFFECTS}$/]`, message: EFFECT_MESSAGE },
        { selector: `CallExpression[callee.object.name='React'][callee.property.name=/^${EFFECTS}$/]`, message: EFFECT_MESSAGE },
        { selector: `ImportSpecifier[imported.name=/^${EFFECTS}$/]`, message: EFFECT_MESSAGE },
        { selector: `MemberExpression[property.name=/^${EFFECTS}$/]`, message: EFFECT_MESSAGE },
      ]
    : []),
  ...(restrictTimers
    ? [
        { selector: `CallExpression[callee.name=/^(${TIMERS})$/]`, message: TIMER_MESSAGE },
        { selector: `CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(${TIMERS})$/]`, message: TIMER_MESSAGE },
        { selector: `CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.computed=true][callee.property.value=/^(${TIMERS})$/]`, message: TIMER_MESSAGE },
      ]
    : []),
];

const parser = {
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    babelOptions: { presets: ["@babel/preset-typescript", "@babel/preset-react"] },
  },
};

const productFiles = ["src/**/*.{ts,tsx}"];
const testFiles = ["src/**/*.test.{ts,tsx}"];

export default [
  { ignores: ["dist", "node_modules"] },
  {
    files: productFiles,
    languageOptions: parser,
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-restricted-syntax": restrictedSyntax(true, true),
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@learnquest/api", message: "Import only the router type: import type { AppRouter } from '@learnquest/api/router'." }],
          patterns: [
            {
              group: ["@learnquest/api/*", "**/apps/api/**", "!@learnquest/api/router"],
              message: "The web app may only use the API through its types: import type { AppRouter } from '@learnquest/api/router'.",
            },
          ],
        },
      ],
    },
  },
  { files: EFFECT_ALLOWLIST, ignores: TIMER_ALLOWLIST, rules: { "no-restricted-syntax": restrictedSyntax(false, true) } },
  { files: TIMER_ALLOWLIST, ignores: EFFECT_ALLOWLIST, rules: { "no-restricted-syntax": restrictedSyntax(true, false) } },
  {
    files: EFFECT_ALLOWLIST.filter((f) => TIMER_ALLOWLIST.includes(f)),
    rules: { "no-restricted-syntax": restrictedSyntax(false, false) },
  },
  { files: testFiles, rules: { "no-restricted-syntax": restrictedSyntax(false, false) } },
];
