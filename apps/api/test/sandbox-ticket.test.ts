import { signUp } from "./helpers.ts";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { setBackend, type ShellHandle } from "../src/sandbox/backend.ts";
import { mintTicket, redeemTicket, TICKET_MAX_PENDING, TICKET_TTL_MS } from "../src/sandbox/ticket.ts";

const app = buildApp();
env.SANDBOX_ENABLED = true;
before(() => app.listen({ port: 0, host: "127.0.0.1" }));
after(() => {
  setBackend(null);
  return app.close();
});

const post = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/api/sandbox/shell-ticket", headers });
const mint = async (cookie: string) => (await post({ cookie, origin: env.PUBLIC_ORIGIN })).json().ticket as string;

test("a ticket redeems once, for the learner it was minted for", () => {
  const t = mintTicket("learner-a");
  assert.equal(redeemTicket(t), "learner-a");
  assert.equal(redeemTicket(t), null);
});

test("an expired or unknown ticket does not redeem", () => {
  const now = Date.now();
  const t = mintTicket("learner-a", now);
  assert.equal(redeemTicket(t, now + TICKET_TTL_MS + 1), null);
  assert.equal(redeemTicket(t, now), null, "the expired attempt still consumed it");
  assert.equal(redeemTicket("garbage"), null);
});

test("the mint route rejects anonymous, disabled and cross-origin callers", async () => {
  const cookie = await signUp(app);
  assert.equal((await post({ origin: env.PUBLIC_ORIGIN })).statusCode, 401);
  assert.equal((await post({ cookie, origin: "https://evil.example" })).statusCode, 403);
  env.SANDBOX_ENABLED = false;
  try {
    assert.equal((await post({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 503);
  } finally {
    env.SANDBOX_ENABLED = true;
  }
  const ok = await post({ cookie, origin: env.PUBLIC_ORIGIN });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ok.json().expiresInMs, 30_000);
});

test("minting stops at the pending cap and resumes once expired tickets are swept", async () => {
  const cookie = await signUp(app);
  const past = Date.now() - TICKET_TTL_MS - 1000;
  const live: string[] = [];
  // Tickets from earlier tests are still pending, so fill up to the cap rather than by a fixed count.
  for (;;) {
    try {
      live.push(mintTicket("filler"));
    } catch {
      break;
    }
  }
  assert.ok(live.length <= TICKET_MAX_PENDING && live.length > TICKET_MAX_PENDING - 10);
  assert.equal((await post({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 429);
  for (const t of live) redeemTicket(t);

  const stale: string[] = [];
  for (;;) {
    try {
      stale.push(mintTicket("filler", past));
    } catch {
      break;
    }
  }
  assert.equal((await post({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 200, "expired entries are swept first");
  for (const t of stale) redeemTicket(t);
});

test("the 21st mint within a minute is rate limited", async () => {
  const cookie = await signUp(app);
  for (let i = 0; i < 20; i++) assert.equal((await post({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 200);
  const res = await post({ cookie, origin: env.PUBLIC_ORIGIN });
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { error: { code: "rate_limited", message: "Slow down" } });
});

test("the shell socket accepts a ticket without a cookie, once, and never falls back to the cookie", async () => {
  const opened: string[] = [];
  setBackend({
    openShell: async (learnerId) => {
      opened.push(learnerId);
      return { write() {}, resize() {}, kill() {}, onData() {}, onExit() {} } as ShellHandle;
    },
  });
  const { port } = app.server.address() as AddressInfo;
  const open = (query: string, headers: Record<string, string>) =>
    new Promise<"open" | "refused">((res) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/api/sandbox/shell${query}`, { headers } as never);
      sock.onopen = () => (sock.close(), res("open"));
      sock.onerror = () => res("refused");
    });
  const httpStatus = async (query: string, headers: Record<string, string>) =>
    (await app.inject({ method: "GET", url: `/api/sandbox/shell${query}`, headers })).statusCode;
  const origin = env.PUBLIC_ORIGIN;

  const a = await signUp(app, "a@example.com");
  const b = await signUp(app, "b@example.com");
  const t = await mint(a);
  assert.equal(await open(`?ticket=${t}`, { origin }), "open");
  assert.equal(await open(`?ticket=${t}`, { origin }), "refused", "single use");
  assert.equal(await httpStatus(`?ticket=${t}`, { origin }), 401);
  assert.equal(await httpStatus("?ticket=bogus", { origin, cookie: b }), 401, "no cookie fallback");
  assert.equal(await httpStatus(`?ticket=${await mint(a)}`, { origin: "https://evil.example" }), 403, "origin still enforced");

  // The ticket opens the minting learner's shell, the same one their cookie opens.
  assert.equal(await open("", { origin, cookie: a }), "open");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(opened.length, 2);
  assert.equal(opened[0], opened[1]);
  assert.equal(await open(`?ticket=${await mint(b)}`, { origin }), "open");
  await new Promise((r) => setTimeout(r, 50));
  assert.notEqual(opened[2], opened[0]);
});
