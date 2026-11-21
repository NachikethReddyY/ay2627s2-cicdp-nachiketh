import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import traverse, { type Scope } from "@babel/traverse";
import { isIdentifier, isStringLiteral, type Node } from "@babel/types";
import { parseSource } from "./parse-source.ts";

export type Violation = { file: string; line: number; message: string };

const NO_COMPUTED_IMPORT = "Do not pass a template literal or variable to import() or require(). Use a string literal so the boundary check can verify the dependency.";

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

function namespaceHasValue(node: Node): boolean {
  switch (node.type) {
    case "TSModuleDeclaration":
      return !node.declare && node.body != null && namespaceHasValue(node.body);
    case "TSModuleBlock":
      return node.body.some(namespaceHasValue);
    case "ExportNamedDeclaration":
      return node.declaration != null && namespaceHasValue(node.declaration);
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return false;
    default:
      return !("declare" in node && node.declare === true);
  }
}

function isCommonJsGlobal(node: Node, name: "module" | "require", scope: Scope, extraBindings: WeakMap<Scope, Set<string>>) {
  if (!isIdentifier(node, { name })) return false;
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    if (extraBindings.get(current)?.has(name)) return false;
    const binding = current.getOwnBinding(name);
    if (!binding) continue;
    if (binding.path.isTSImportEqualsDeclaration()) return binding.path.node.importKind === "type";
    return binding.kind === "unknown" || binding.path.parentPath?.isVariableDeclaration({ declare: true }) === true;
  }
  return true;
}

function dependencyArgument(node: Node, scope: Scope, extraBindings: WeakMap<Scope, Set<string>>) {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "ExportNamedDeclaration":
    case "ImportExpression":
    case "TSImportType":
      return node.source ?? undefined;
    case "TSExternalModuleReference":
      return node.expression;
    case "CallExpression":
    case "OptionalCallExpression": {
      const callee = node.callee;
      if (isCommonJsGlobal(callee, "require", scope, extraBindings)) return node.arguments[0] ?? null;
      if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return undefined;
      if (!isCommonJsGlobal(callee.object, "module", scope, extraBindings)) return undefined;
      const isRequire = callee.computed
        ? isStringLiteral(callee.property, { value: "require" })
        : isIdentifier(callee.property, { name: "require" });
      return isRequire ? node.arguments[0] ?? null : undefined;
    }
    default:
      return undefined;
  }
}

export function checkFile(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.startsWith("apps/api/test/");
  const inApi = file.startsWith("apps/api/");
  const inPackage = file.startsWith("packages/");

  const ast = parseSource(file, text);
  const extraBindings = new WeakMap<Scope, Set<string>>();
  function addBinding(scope: Scope, name: string) {
    const names = extraBindings.get(scope) ?? new Set<string>();
    names.add(name);
    extraBindings.set(scope, names);
  }
  traverse(ast, {
    TSModuleDeclaration({ node, scope }) {
      if (isIdentifier(node.id) && namespaceHasValue(node)) addBinding(scope, node.id.name);
    },
    ClassMethod({ node, scope }) {
      if (node.kind !== "constructor") return;
      for (const parameter of node.params) {
        if (parameter.type !== "TSParameterProperty") continue;
        const value = parameter.parameter.type === "AssignmentPattern" ? parameter.parameter.left : parameter.parameter;
        if (isIdentifier(value)) addBinding(scope, value.name);
      }
    },
  });
  traverse(ast, {
    enter({ node, scope }) {
      const argument = dependencyArgument(node, scope, extraBindings);
      if (argument === undefined) return;
      const line = node.loc!.start.line;
      const add = (message: string) => out.push({ file, line, message });
      if (argument?.type !== "StringLiteral") {
        add(NO_COMPUTED_IMPORT);
        return;
      }
      const spec = argument.value;
      const target = spec.startsWith(".") ? normalize(join(dirname(file), spec)).split("\\").join("/") : spec;
      if (inPackage && (/^@learnquest\/(api|web)(?![\w-])/.test(target) || /^(apps|\.\.)\//.test(target) || /(^|\/)apps\//.test(target))) {
        add(`${spec}: ${/api/.test(target) ? CLIENT_TO_SERVER : PACKAGE_TO_APP}`);
      }
      if (inApi && !isTest && (/^@learnquest\/web(?![\w-])/.test(target) || /^apps\/web\//.test(target) || /(^|\/)apps\/web\//.test(target))) {
        add(`${spec}: ${SERVER_TO_CLIENT}`);
      }
    },
  });

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
