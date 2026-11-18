import assert from "node:assert/strict";
import { test } from "node:test";
import { flagCount, parseArgs, tailLines } from "../src/args.ts";
import { browserArgs, resolveScreenshotPath } from "../src/browse.ts";

test("parseArgs splits command, positionals and flags", () => {
  const args = parseArgs(["up", "--engine", "--fresh"]);
  assert.equal(args.command, "up");
  assert.ok(args.flags.has("engine"));
  assert.ok(args.flags.has("fresh"));
});

test("parseArgs reads value flags in both spellings", () => {
  assert.equal(parseArgs(["logs", "api", "--tail", "5"]).flags.get("tail"), "5");
  assert.equal(parseArgs(["logs", "api", "--tail=7"]).flags.get("tail"), "7");
  assert.deepEqual(parseArgs(["logs", "api", "--tail", "5"]).positionals, ["api"]);
});

test("flagCount validates and defaults", () => {
  assert.equal(flagCount(parseArgs(["logs"]), "tail", 100), 100);
  assert.equal(flagCount(parseArgs(["logs", "--tail", "3"]), "tail", 100), 3);
  assert.throws(() => flagCount(parseArgs(["logs", "--tail", "0"]), "tail", 100));
});

test("tailLines keeps the last lines and ignores a trailing newline", () => {
  assert.equal(tailLines("a\nb\nc\n", 2), "b\nc");
  assert.equal(tailLines("a", 5), "a");
});

test("browserArgs adds the validator session unless one is given", () => {
  assert.deepEqual(browserArgs(["snapshot", "-i"]), ["--session", "validator", "snapshot", "-i"]);
  assert.deepEqual(browserArgs(["--session", "other", "snapshot"]), ["--session", "other", "snapshot"]);
});

test("screenshot paths are made absolute so the browser daemon writes where the caller expects", () => {
  assert.deepEqual(resolveScreenshotPath(["screenshot", "a.png"], "/work", "/shots", 1), ["screenshot", "/work/a.png"]);
  assert.deepEqual(resolveScreenshotPath(["screenshot", "/abs/a.png"], "/work", "/shots", 1), ["screenshot", "/abs/a.png"]);
  assert.deepEqual(resolveScreenshotPath(["screenshot"], "/work", "/shots", 9), ["screenshot", "/shots/shot-9.png"]);
  assert.deepEqual(resolveScreenshotPath(["snapshot"], "/work", "/shots", 1), ["snapshot"]);
});
