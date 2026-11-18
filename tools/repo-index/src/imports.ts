import { posix } from "node:path";
import { isScriptPath, parseProgramBody, type AstNode } from "./ast.ts";

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function importSpecifiers(body: AstNode[]): string[] {
  return body
    .filter((statement) => ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(statement.type))
    .map((statement) => statement.source as { value?: unknown } | null | undefined)
    .map((source) => source?.value)
    .filter((value): value is string => typeof value === "string");
}

function candidatesFor(base: string): string[] {
  const withoutJsSuffix = base.replace(/\.(m|c)?jsx?$/, "");
  const swapped = withoutJsSuffix === base ? [] : RESOLVABLE_EXTENSIONS.map((ext) => `${withoutJsSuffix}${ext}`);
  const appended = RESOLVABLE_EXTENSIONS.map((ext) => `${base}${ext}`);
  const indexes = RESOLVABLE_EXTENSIONS.map((ext) => `${base}/index${ext}`);
  return [base, ...swapped, ...appended, ...indexes];
}

export function resolveRelative(fromPath: string, specifier: string, knownPaths: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  return candidatesFor(base).find((candidate) => knownPaths.has(candidate)) ?? null;
}

export function extractImports(path: string, text: string, knownPaths: ReadonlySet<string>): string[] {
  if (!isScriptPath(path)) return [];
  const body = parseProgramBody(path, text);
  if (!body) return [];
  const resolved = importSpecifiers(body)
    .map((specifier) => resolveRelative(path, specifier, knownPaths))
    .filter((target): target is string => target !== null && target !== path);
  return [...new Set(resolved)];
}
