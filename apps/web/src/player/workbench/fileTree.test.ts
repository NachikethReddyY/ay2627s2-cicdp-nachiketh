import { test } from "node:test";
import assert from "node:assert/strict";
import { ancestors, filePaths, flattenTree, initialOpen, toggleFolder, type TreeNode } from "./fileTree.ts";

const tree: TreeNode[] = [
  {
    name: "root",
    open: true,
    children: [
      { name: "a", children: [{ name: "x.ts" }] },
      { name: "b", open: true, children: [{ name: "y.ts", status: "M" }] },
      { name: "z.md" },
    ],
  },
];

test("initialOpen lists the folders marked open, at any depth", () => {
  assert.deepEqual([...initialOpen(tree)].sort(), ["root", "root/b"]);
});

test("flattenTree hides the children of closed folders and numbers the depth", () => {
  const rows = flattenTree(tree, initialOpen(tree));
  assert.deepEqual(
    rows.map((r) => [r.path, r.depth, r.open]),
    [
      ["root", 0, true],
      ["root/a", 1, false],
      ["root/b", 1, true],
      ["root/b/y.ts", 2, false],
      ["root/z.md", 1, false],
    ],
  );
  assert.equal(rows[3].node.status, "M");
  assert.equal(rows[4].isFolder, false);
});

test("toggleFolder opens and closes without changing the input", () => {
  const open = new Set(["root"]);
  const opened = toggleFolder(open, "root/a");
  assert.ok(opened.has("root/a"));
  assert.ok(!open.has("root/a"));
  assert.ok(!toggleFolder(opened, "root/a").has("root/a"));
  assert.deepEqual(flattenTree(tree, toggleFolder(open, "root/a")).map((r) => r.path), ["root", "root/a", "root/a/x.ts", "root/b", "root/z.md"]);
});

test("a closed root shows one row", () => {
  assert.equal(flattenTree(tree, new Set()).length, 1);
});

test("filePaths walks closed folders too", () => {
  assert.deepEqual(filePaths(tree), ["root/a/x.ts", "root/b/y.ts", "root/z.md"]);
});

test("ancestors lists each folder above a file", () => {
  assert.deepEqual(ancestors("a/b/c.ts"), ["a", "a/b"]);
  assert.deepEqual(ancestors("c.ts"), []);
});

test("rows carry their place among siblings", () => {
  const rows = flattenTree(tree, initialOpen(tree));
  assert.deepEqual([rows[1].posInSet, rows[1].setSize, rows[4].posInSet], [1, 3, 3]);
});
