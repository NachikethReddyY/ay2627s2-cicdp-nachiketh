import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clock, FetchLike } from "../src/wait.ts";
import { waitForHttp } from "../src/wait.ts";

function fakeClock(): Clock & { time: number } {
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.time += ms;
    },
  };
  return clock;
}

test("succeeds once the endpoint turns healthy", async () => {
  const clock = fakeClock();
  let calls = 0;
  const fetch: FetchLike = async () => {
    calls += 1;
    if (calls < 3) throw new Error("ECONNREFUSED");
    return { status: 200, ok: true };
  };
  const result = await waitForHttp({ url: "http://x", timeoutMs: 10_000, intervalMs: 500, fetch, clock });
  assert.deepEqual(result, { ok: true, attempts: 3 });
  assert.equal(clock.time, 1000);
});

test("gives up at the deadline and reports the last error", async () => {
  const clock = fakeClock();
  const fetch: FetchLike = async () => ({ status: 503, ok: false });
  const result = await waitForHttp({ url: "http://x", timeoutMs: 2000, intervalMs: 500, fetch, clock });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.lastError, "status 503");
  assert.ok(clock.time <= 2000);
});

test("a custom accept treats redirects as healthy", async () => {
  const fetch: FetchLike = async () => ({ status: 302, ok: false });
  const result = await waitForHttp({ url: "http://x", timeoutMs: 1000, intervalMs: 100, fetch, clock: fakeClock(), accept: (s) => s < 400 });
  assert.equal(result.ok, true);
});
