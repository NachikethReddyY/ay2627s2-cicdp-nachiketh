import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// webContainerPreview.ts pulls in @webcontainer/api and extensionless imports that plain node cannot load, so the
// test reads the constant out of the source. The bridge has no backslashes or template placeholders, so the raw
// text between the backticks is its value.
const source = readFileSync(new URL("./webContainerPreview.ts", import.meta.url), "utf8");
const start = source.indexOf("PREVIEW_BRIDGE = `") + "PREVIEW_BRIDGE = `".length;
const PREVIEW_BRIDGE = source.slice(start, source.indexOf("</script>`;", start) + "</script>".length);

const body = PREVIEW_BRIDGE.replace(/^<script>/, "").replace(/<\/script>$/, "");

test("the bridge text was found and has no template placeholders or backslashes", () => {
  assert.ok(PREVIEW_BRIDGE.startsWith("<script>"));
  assert.ok(!PREVIEW_BRIDGE.includes("${") && !PREVIEW_BRIDGE.includes("\\"));
});

test("the bridge is one script whose body parses as JavaScript", () => {
  assert.equal(PREVIEW_BRIDGE.match(/<\/script>/g)?.length, 1);
  assert.doesNotThrow(() => new Function(body));
});

test("the bridge keeps its marker and handles every host command", () => {
  assert.ok(PREVIEW_BRIDGE.includes("__learnquestPreview: true"));
  assert.ok(PREVIEW_BRIDGE.includes("__learnquestPreviewCommand"));
  for (const type of ["inspect", "dom-request", "styles-request", "set-style", "highlight", "sources-request", "source-request"]) {
    assert.ok(PREVIEW_BRIDGE.includes(`'${type}'`), `missing command ${type}`);
  }
});

test("the bridge sends every message type the panel reads", () => {
  for (const type of ["console", "inspect-state", "element", "contextmenu", "pointerdown", "dom", "styles", "network", "sources", "source", "ready"]) {
    assert.ok(PREVIEW_BRIDGE.includes(`type: '${type}'`), `missing message ${type}`);
  }
});

test("the bridge announces itself last and holds nodes weakly", () => {
  assert.ok(body.trimEnd().endsWith("send({ type: 'ready' });\n})();"));
  assert.ok(body.includes("new WeakRef(node)") && body.includes(".deref()"));
});
