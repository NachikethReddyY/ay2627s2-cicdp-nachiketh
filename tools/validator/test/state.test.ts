import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyState, ensureLayout, layoutFor, parseState, readState, removeState, writeState } from "../src/state.ts";

test("state round trips through the file", () => {
  const layout = layoutFor(mkdtempSync(join(tmpdir(), "validator-")));
  assert.equal(readState(layout), null);
  const state = emptyState("postgres://x/validator", true, new Date("2026-01-01T00:00:00Z"));
  state.services.api = { pid: 42, port: 3000, url: "http://localhost:3000", log: "/tmp/api.log", engine: true };
  writeState(layout, state);
  assert.deepEqual(readState(layout), state);
  removeState(layout);
  assert.equal(readState(layout), null);
});

test("parseState rejects garbage and incomplete objects", () => {
  assert.equal(parseState("not json"), null);
  assert.equal(parseState("null"), null);
  assert.equal(parseState(JSON.stringify({ database: "d" })), null);
});

test("ensureLayout ignores the whole state directory in git", () => {
  const layout = layoutFor(mkdtempSync(join(tmpdir(), "validator-")));
  ensureLayout(layout);
  assert.equal(readFileSync(join(layout.dir, ".gitignore"), "utf8"), "*\n");
});

test("layout puts logs, state and auth under .validator", () => {
  const layout = layoutFor("/repo");
  assert.equal(layout.stateFile, "/repo/.validator/state.json");
  assert.equal(layout.logsDir, "/repo/.validator/logs");
  assert.equal(layout.authState, "/repo/.validator/auth-state.json");
});
