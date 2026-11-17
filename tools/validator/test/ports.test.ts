import assert from "node:assert/strict";
import { test } from "node:test";
import { descendantsOf, foreignPortMessage, judgePort, parseLsofOwners, parsePort, parseProcessTable, portOfUrl } from "../src/ports.ts";

test("parsePort accepts valid ports only", () => {
  assert.equal(parsePort("5173"), 5173);
  assert.throws(() => parsePort("0"));
  assert.throws(() => parsePort("70000"));
  assert.throws(() => parsePort("abc"));
});

test("portOfUrl reads explicit and default ports", () => {
  assert.equal(portOfUrl("postgres://u:p@localhost:5433/db"), 5433);
  assert.equal(portOfUrl("http://localhost:3000/x"), 3000);
  assert.equal(portOfUrl("https://example.com"), 443);
});

test("parseLsofOwners reads field output and dedupes pids", () => {
  const out = "p100\ncnode\nf12\np200\ncpostgres\np100\ncnode\n";
  assert.deepEqual(parseLsofOwners(out), [
    { pid: 100, command: "node" },
    { pid: 200, command: "postgres" },
  ]);
  assert.deepEqual(parseLsofOwners(""), []);
});

test("process table parsing and descendants include the root and nested children", () => {
  const rows = parseProcessTable("  1     0\n 10     1\n 11    10\n 12    11\n 20     1\nbad line\n");
  assert.deepEqual(descendantsOf(rows, 10).sort(), [10, 11, 12]);
  assert.deepEqual(descendantsOf(rows, 99), [99]);
});

test("judgePort separates free, ours and foreign listeners", () => {
  assert.deepEqual(judgePort([], [10]), { kind: "free" });
  assert.deepEqual(judgePort([{ pid: 11, command: "node" }], [10, 11]), { kind: "ours" });
  assert.deepEqual(judgePort([{ pid: 50, command: "node" }], [10, 11]), { kind: "foreign", owner: { pid: 50, command: "node" } });
  assert.equal(judgePort([{ pid: 50, command: "node" }], []).kind, "foreign");
});

test("foreignPortMessage names the port and the process", () => {
  const message = foreignPortMessage(5173, { pid: 77, command: "node" });
  assert.match(message, /5173/);
  assert.match(message, /node/);
  assert.match(message, /77/);
});
