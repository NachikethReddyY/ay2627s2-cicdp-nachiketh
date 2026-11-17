import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

export type CommentViolation = { file: string; line: number; text: string };
type Range = { start: number; end: number };

const ALLOWED = [
  /^\s*eslint-(disable|enable)(-next-line|-line)?\b.*\s--\s+\S/,
  /^\s*oxlint-(disable|enable)(-next-line|-line)?\b.*\s--\s+\S/,
  /^\s*@ts-expect-error\s+--\s+\S/,
  /^\s*@ts-check\s*$/,
  /^\/\s*<reference\s/,
  /^\s*#!/,
];

export const COMMENT_MESSAGE =
  "Comments are banned. Name the thing so it needs no explanation, extract a function, or add a test that states the rule. Directives need a reason after `--`.";

function isAllowed(value: string): boolean {
  return ALLOWED.some((re) => re.test(value));
}

function analyze(code: string, file: string) {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", ...(file.endsWith("x") ? (["jsx"] as const) : [])],
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    attachComment: true,
  });
  const jsxEmpty: Range[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return void node.forEach(walk);
    const n = node as { type?: string; start?: number; end?: number; expression?: { type?: string } } & Record<string, unknown>;
    if (n.type === "JSXExpressionContainer" && n.expression?.type === "JSXEmptyExpression" && n.start !== undefined && n.end !== undefined) {
      jsxEmpty.push({ start: n.start, end: n.end });
    }
    for (const key of Object.keys(n)) if (key !== "loc" && key !== "comments" && !key.endsWith("Comments")) walk(n[key]);
  };
  walk(ast.program);
  return { comments: ast.comments ?? [], jsxEmpty };
}

export function findBannedComments(file: string, code: string): CommentViolation[] {
  if (code.startsWith("#!")) code = "//" + code.slice(2);
  return analyze(code, file)
    .comments.filter((c) => !isAllowed(c.value))
    .map((c) => ({ file, line: c.loc?.start.line ?? 0, text: c.value.trim().slice(0, 60) }));
}

export function stripComments(file: string, code: string): string {
  const shebang = code.startsWith("#!") ? code.slice(0, code.indexOf("\n") + 1 || code.length) : "";
  const body = code.slice(shebang.length);
  const { comments, jsxEmpty } = analyze(body, file);
  const ranges: Range[] = [];
  for (const c of comments) {
    if (isAllowed(c.value) || c.start === null || c.start === undefined || c.end === null || c.end === undefined) continue;
    const container = jsxEmpty.find((r) => r.start <= c.start! && c.end! <= r.end);
    ranges.push(container ?? { start: c.start, end: c.end });
  }
  const unique = [...new Map(ranges.map((r) => [`${r.start}:${r.end}`, r])).values()].sort((a, b) => b.start - a.start);
  let out = body;
  for (const r of unique) {
    const before = out.slice(0, r.start);
    const after = out.slice(r.end);
    const lineStart = before.lastIndexOf("\n") + 1;
    const nextNewline = after.indexOf("\n");
    const lineTail = nextNewline === -1 ? after : after.slice(0, nextNewline);
    if (before.slice(lineStart).trim() === "" && lineTail.trim() === "") {
      out = before.slice(0, lineStart) + (nextNewline === -1 ? "" : after.slice(nextNewline + 1));
      continue;
    }
    const left = before.replace(/[ \t]+$/, "");
    const glue = /\w$/.test(left) && /^\w/.test(after.trimStart()) && !after.startsWith("\n") ? " " : "";
    out = left + glue + (after.startsWith("\n") || after === "" ? after : after.replace(/^[ \t]+/, left.endsWith("\n") || left === "" ? "" : " "));
  }
  return shebang + out.replace(/\n{3,}/g, "\n\n");
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".git", "drizzle", ".agents", "spikes", "coverage"]);
const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (SOURCE.test(e.name) && !/\.(d|gen|generated)\.[cm]?[jt]s$/.test(e.name) && !/\.(gen|generated)\.[cm]?[jt]s$/.test(e.name)) yield p;
  }
}

export function sourceFiles(root: string): string[] {
  return ["apps", "packages", "e2e", "scripts", "tools"].flatMap((top) => [...walk(join(root, top))]);
}

export function checkRepoComments(root: string): CommentViolation[] {
  return sourceFiles(root).flatMap((abs) => {
    const file = relative(root, abs).split("\\").join("/");
    return findBannedComments(file, readFileSync(abs, "utf8"));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--fix")) {
    let changed = 0;
    for (const abs of sourceFiles(root)) {
      const file = relative(root, abs);
      const before = readFileSync(abs, "utf8");
      const after = stripComments(file, before);
      if (after !== before) {
        writeFileSync(abs, after);
        changed += 1;
      }
    }
    console.log(`stripped comments in ${changed} files`);
  } else {
    const found = checkRepoComments(root);
    for (const v of found) console.error(`${v.file}:${v.line}  ${COMMENT_MESSAGE}  (${v.text})`);
    if (found.length > 0) process.exit(1);
    console.log("no banned comments");
  }
}
