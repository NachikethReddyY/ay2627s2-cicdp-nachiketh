import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenTree } from "./fileTree.ts";
import { sandboxNodes, type DirState } from "./sandboxTree.ts";

const file = (name: string) => ({ name, type: "file" as const, size: 1 });
const dir = (name: string) => ({ name, type: "dir" as const, size: 0 });
const home = { entries: [dir("notes"), file("solution.js")], truncated: false };

test("a folder that was never listed is a collapsed folder with no children yet", () => {
  const nodes = sandboxNodes(home, new Map());
  assert.deepEqual(nodes.map((n) => [n.name, n.children !== undefined]), [["notes", true], ["solution.js", false]]);
  assert.deepEqual(flattenTree(nodes, new Set()).map((r) => r.path), ["notes", "solution.js"]);
});

test("an open folder shows its loaded entries, a placeholder while loading, or an error", () => {
  const loaded: DirState = { entries: [file("a.txt")], truncated: false };
  const open = new Set(["notes"]);
  const rows = (dirs: Map<string, DirState>) => flattenTree(sandboxNodes(home, dirs), open).map((r) => r.path);
  assert.deepEqual(rows(new Map([["notes", "loading"]])), ["notes", "notes/Loading…", "solution.js"]);
  assert.deepEqual(rows(new Map([["notes", "error"]])), ["notes", "notes/Could not list files", "solution.js"]);
  assert.deepEqual(rows(new Map([["notes", loaded]])), ["notes", "notes/a.txt", "solution.js"]);
});

test("nested folders join paths from the sandbox home, and truncation adds a marker", () => {
  const dirs = new Map<string, DirState>([
    ["notes", { entries: [dir("deep")], truncated: true }],
    ["notes/deep", { entries: [file("x.py")], truncated: false }],
  ]);
  const open = new Set(["notes", "notes/deep"]);
  const paths = flattenTree(sandboxNodes(home, dirs), open).map((r) => r.path);
  assert.deepEqual(paths, ["notes", "notes/deep", "notes/deep/x.py", "notes/…more", "solution.js"]);
});
