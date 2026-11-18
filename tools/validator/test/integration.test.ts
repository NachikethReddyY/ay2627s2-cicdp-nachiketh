import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const enabled = process.env.VALIDATOR_INTEGRATION === "1";
const cli = join(fileURLToPath(new URL("../src/cli.ts", import.meta.url)));

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 300_000 });
}

test("up, smoke and down against a real stack", { skip: !enabled, timeout: 600_000 }, () => {
  try {
    const up = run("up");
    assert.equal(up.status, 0, up.stderr);
    const summary = JSON.parse(up.stdout) as { webUrl: string; apiUrl: string; learner: { email: string } };
    assert.equal(summary.webUrl, "http://localhost:5173");
    assert.equal(summary.learner.email, "agent@validator.local");
    const smoke = run("smoke");
    assert.equal(smoke.status, 0, smoke.stdout);
    assert.doesNotMatch(smoke.stdout, /FAIL/);
    const again = run("up");
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stderr, /reusing/);
  } finally {
    const down = run("down");
    assert.equal(down.status, 0, down.stderr);
  }
  assert.equal(run("status", "--json").status, 1);
});
