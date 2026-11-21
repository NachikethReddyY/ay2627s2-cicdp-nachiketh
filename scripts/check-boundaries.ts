import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Violation = { file: string; line: number; message: string };

const IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;

const NO_COMPUTED_IMPORT = "Do not pass a template literal or variable to import() or require(). Use a string literal so the boundary check can verify the dependency.";

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

const CLIENT_TO_SERVER =
  "Shared and client code must not depend on the API. Move the shared type or helper into packages/ui-catalog or packages/player-core and import it from there.";
const SERVER_TO_CLIENT =
  "The API must not depend on the web app. Move the shared code into a package under packages/ and import it from both.";
const PACKAGE_TO_APP =
  "A package under packages/ must not import an app. Apps depend on packages, never the reverse. Move the shared code into the package.";
const NO_TS_IGNORE =
  "Do not silence the type checker with @ts-ignore or @ts-nocheck. Fix the type, or use @ts-expect-error with a reason after `--`.";
const NO_DISABLE_GUARDRAIL =
  "Do not disable no-restricted-syntax or no-restricted-imports. They carry the repo's guardrails. Fix the code the rule points at.";
const NO_BARE_DISABLE =
  "eslint-disable needs a reason: `// eslint-disable-next-line <rule> -- why`. If you cannot give a real reason, fix the code.";

export function checkFile(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.startsWith("apps/api/test/");
  const inApi = file.startsWith("apps/api/");
  const inPackage = file.startsWith("packages/");

  for (const match of text.matchAll(/\b(?:import|require)\s*\(\s*(?:(?!["'\s])|(?:"[^"\n]*"|'[^'\n]*')\s*\+)/g)) {
    out.push({ file, line: lineOf(text, match.index), message: NO_COMPUTED_IMPORT });
  }

  for (const m of text.matchAll(IMPORT)) {
    const line = lineOf(text, m.index);
    const add = (message: string) => out.push({ file, line, message });
    const spec = m[1];
    const target = spec.startsWith(".") ? normalize(join(dirname(file), spec)).split("\\").join("/") : spec;
    if (inPackage && (/^@learnquest\/(api|web)(?![\w-])/.test(target) || /^(apps|\.\.)\//.test(target) || /(^|\/)apps\//.test(target))) {
      add(`${spec}: ${/api/.test(target) ? CLIENT_TO_SERVER : PACKAGE_TO_APP}`);
    }
    if (inApi && !isTest && (/^@learnquest\/web(?![\w-])/.test(target) || /^apps\/web\//.test(target) || /(^|\/)apps\/web\//.test(target))) {
      add(`${spec}: ${SERVER_TO_CLIENT}`);
    }
  }

  text.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const add = (message: string) => out.push({ file, line, message });
    if (!isTest) {
      if (/@ts-(ignore|nocheck)\b/.test(raw)) add(NO_TS_IGNORE);
      if (/eslint-disable[^\n]*no-restricted-(syntax|imports)/.test(raw)) add(NO_DISABLE_GUARDRAIL);
      if (/eslint-disable/.test(raw) && !/eslint-disable-(next-line|line)\s+[\w@/-]+(\s*,\s*[\w@/-]+)*\s+--\s+\S/.test(raw)) add(NO_BARE_DISABLE);
    }
  });
  return out;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".git", "drizzle"]);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name)) yield p;
  }
}

export function checkRepo(root: string): Violation[] {
  const out: Violation[] = [];
  for (const top of ["apps", "packages", "e2e", "tools"]) {
    for (const abs of walk(join(root, top))) {
      const file = relative(root, abs).split(sep).join("/");
      if (file !== "apps/web/src/pages/changelog-releases.generated.ts") out.push(...checkFile(file, readFileSync(abs, "utf8")));
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const found = checkRepo(root);
  for (const v of found) console.error(`${v.file}:${v.line}  ${v.message}`);
  if (found.length > 0) process.exit(1);
  console.log("boundaries ok");
}
