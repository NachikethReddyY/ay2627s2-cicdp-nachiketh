import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

// Hooks correctness only; style and types are tsc's job. The TypeScript is parsed with Babel because
// typescript-eslint does not support TypeScript 7 yet.
export default [
  { ignores: ["dist", "node_modules"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ["@babel/preset-typescript", "@babel/preset-react"] },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
