import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attrEntries,
  defaultExpanded,
  filterComputed,
  filterLogs,
  findPath,
  formatBytes,
  formatDuration,
  hasNode,
  isFailedRequest,
  isTextNode,
  parseDeclaration,
  upsertNetwork,
  urlName,
  urlPath,
  visibleNetwork,
  visibleRows,
} from "./devtoolsHelpers.ts";
import type { DomNode, NetworkEntry } from "./previewDevtoolsProtocol.ts";

const tree: DomNode = {
  id: 1,
  tag: "html",
  attrs: {},
  children: [
    { id: 2, tag: "head", attrs: {}, children: [] },
    {
      id: 3,
      tag: "body",
      attrs: { class: "page" },
      children: [
        { id: 4, tag: "div", attrs: { id: "a" }, children: [{ id: 5, tag: "#text", attrs: {}, text: "hi", children: [] }] },
        { id: 6, tag: "p", attrs: {}, children: [] },
      ],
    },
  ],
};

const net = (id: number, extra: Partial<NetworkEntry> = {}): NetworkEntry => ({ id, method: "GET", url: "http://x/a", kind: "fetch", startedAt: 0, ...extra });

test("findPath returns ids from the root, or null", () => {
  assert.deepEqual(findPath(tree, 5), [1, 3, 4, 5]);
  assert.deepEqual(findPath(tree, 1), [1]);
  assert.equal(findPath(tree, 99), null);
  assert.equal(hasNode(tree, 6), true);
  assert.equal(hasNode(tree, 99), false);
});

test("defaultExpanded opens the top levels only", () => {
  assert.deepEqual([...defaultExpanded(tree, 2)].sort(), [1, 3]);
  assert.deepEqual([...defaultExpanded(tree, 3)].sort(), [1, 3, 4]);
});

test("visibleRows follows the expanded set", () => {
  assert.deepEqual(visibleRows(tree, new Set()).map((r) => r.node.id), [1]);
  const rows = visibleRows(tree, new Set([1, 3]));
  assert.deepEqual(rows.map((r) => [r.node.id, r.depth, r.parentId]), [[1, 0, null], [2, 1, 1], [3, 1, 1], [4, 2, 3], [6, 2, 3]]);
});

test("text nodes and attributes", () => {
  assert.equal(isTextNode({ id: 5, tag: "#text", attrs: {}, children: [] }), true);
  assert.equal(isTextNode(tree), false);
  assert.deepEqual(attrEntries(tree.children[1]!), [["class", "page"]]);
});

test("filterLogs keeps all without a filter and only chosen levels with one", () => {
  const logs = [{ level: "log" as const }, { level: "error" as const }, { level: "warn" as const }];
  assert.equal(filterLogs(logs, null).length, 3);
  assert.equal(filterLogs(logs, new Set()).length, 3);
  assert.deepEqual(filterLogs(logs, new Set(["error" as const])), [{ level: "error" }]);
});

test("formatBytes and formatDuration", () => {
  assert.equal(formatBytes(undefined), "-");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 kB");
  assert.equal(formatBytes(20 * 1024), "20 kB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(formatDuration(undefined), "pending");
  assert.equal(formatDuration(12.4), "12 ms");
  assert.equal(formatDuration(1500), "1.50 s");
});

test("url helpers", () => {
  assert.equal(urlPath("http://localhost:3000/src/app.js?v=1"), "/src/app.js?v=1");
  assert.equal(urlName("http://localhost:3000/src/app.js?v=1"), "app.js");
  assert.equal(urlName("http://localhost:3000/"), "/");
  assert.equal(urlPath("not a url"), "not a url");
});

test("network rows: failure, replace by id, cleared boundary", () => {
  assert.equal(isFailedRequest(net(1, { status: 404 })), true);
  assert.equal(isFailedRequest(net(1, { error: "x" })), true);
  assert.equal(isFailedRequest(net(1, { status: 200 })), false);
  const list = upsertNetwork([net(1), net(2)], net(1, { status: 200 }));
  assert.equal(list.length, 2);
  assert.equal(list[0]?.status, 200);
  const rows = visibleNetwork([net(1), net(2), net(3), net(2, { status: 500 })], 1);
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [[2, 500], [3, undefined]]);
});

test("parseDeclaration", () => {
  assert.deepEqual(parseDeclaration("color: red;"), { property: "color", value: "red", important: false });
  assert.deepEqual(parseDeclaration("margin : 0 auto !important"), { property: "margin", value: "0 auto", important: true });
  assert.deepEqual(parseDeclaration("background: url(a:b)"), { property: "background", value: "url(a:b)", important: false });
  assert.equal(parseDeclaration("nonsense"), null);
  assert.equal(parseDeclaration(": red"), null);
});

test("filterComputed sorts by name and filters by name or value", () => {
  const computed = { width: "10px", color: "red", display: "block" };
  assert.deepEqual(filterComputed(computed, "").map(([n]) => n), ["color", "display", "width"]);
  assert.deepEqual(filterComputed(computed, "RED").map(([n]) => n), ["color"]);
  assert.deepEqual(filterComputed(computed, "dis").map(([n]) => n), ["display"]);
});

test("findPath stops on a cycle instead of recursing forever", () => {
  const a: DomNode = { id: 1, tag: "a", attrs: {}, children: [] };
  const b: DomNode = { id: 2, tag: "b", attrs: {}, children: [a] };
  a.children.push(b);
  assert.equal(findPath(a, 99), null);
  assert.deepEqual(findPath(a, 2), [1, 2]);
});

test("findPath gives up below depth 200", () => {
  const root: DomNode = { id: 0, tag: "n", attrs: {}, children: [] };
  let cur = root;
  for (let i = 1; i <= 250; i++) {
    const next: DomNode = { id: i, tag: "n", attrs: {}, children: [] };
    cur.children.push(next);
    cur = next;
  }
  assert.equal(findPath(root, 250), null);
  assert.equal(findPath(root, 150)?.length, 151);
});
