import { test } from "node:test";
import assert from "node:assert/strict";
import { bin } from "./bin.ts";

test("a system binary resolves to an absolute path in a trusted directory", () => {
  assert.match(bin("git"), /^\/(usr\/bin|bin|usr\/local\/bin|opt\/homebrew\/bin|usr\/sbin|sbin)\/git$/);
});

test("an environment override wins", () => {
  process.env.ZZTOOL_BIN = "/custom/zztool";
  assert.equal(bin("zztool"), "/custom/zztool");
  delete process.env.ZZTOOL_BIN;
});

test("a missing binary fails with the fix in the message", () => {
  assert.throws(() => bin("definitely-not-installed-xyz"), /DEFINITELY-NOT-INSTALLED-XYZ_BIN/);
});
