import { signUp } from "./helpers.ts";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { setBackend, type ShellHandle } from "../src/sandbox/backend.ts";
import { _resetForTests, mintTicket, redactUrl, redeemTicket, TICKET_MAX_PENDING, TICKET_MAX_PER_LEARNER, TICKET_TTL_MS } from "../src/sandbox/ticket.ts";

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
    const off = await post({ cookie, origin: env.PUBLIC_ORIGIN });
    assert.equal(off.statusCode, 503);
    assert.equal(off.json().error.code, "unavailable", "disabled is distinguishable from a full store");
  } finally {
    env.SANDBOX_ENABLED = true;
  }
  const ok = await post({ cookie, origin: env.PUBLIC_ORIGIN });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ok.json().expiresInMs, 30_000);
});

test("minting stops at the pending cap and resumes once expired tickets are swept", async () => {
  _resetForTests();
  const cookie = await signUp(app);
  const past = Date.now() - TICKET_TTL_MS - 1000;
  for (let i = 0; i < TICKET_MAX_PENDING; i++) mintTicket(`filler-${i}`);
  const full = await post({ cookie, origin: env.PUBLIC_ORIGIN });
  assert.equal(full.statusCode, 503);
  assert.deepEqual(full.json(), { error: { code: "busy", message: "Try again shortly" } });

  _resetForTests();
  for (let i = 0; i < TICKET_MAX_PENDING; i++) mintTicket(`filler-${i}`, past);
  assert.equal((await post({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 200, "expired entries are swept first");
  _resetForTests();
});

test("a learner keeps at most four live tickets; the oldest are revoked", () => {
  _resetForTests();
  const ts = Array.from({ length: TICKET_MAX_PER_LEARNER + 2 }, () => mintTicket("a"));
  const other = mintTicket("b");
  assert.equal(redeemTicket(ts[0]!), null);
  assert.equal(redeemTicket(ts[1]!), null);
  for (const t of ts.slice(2)) assert.equal(redeemTicket(t), "a");
  assert.equal(redeemTicket(other), "b");
});

test("logged URLs lose the shell query and any ticket value", () => {
  assert.equal(redactUrl("/api/sandbox/shell?ticket=SECRET&tab=1"), "/api/sandbox/shell");
  assert.equal(redactUrl("/api/sandbox/shell?ticket=A&ticket=B"), "/api/sandbox/shell");
  assert.equal(redactUrl("/api/sandbox/shell?%74icket=SECRET"), "/api/sandbox/shell");
  assert.equal(redactUrl("/api/other?ticket=A&x=1&ticket=B&%74icket=C"), "/api/other?ticket=[redacted]&x=1&ticket=[redacted]&%74icket=[redacted]");
  assert.equal(redactUrl("/api/other?x=1"), "/api/other?x=1");
  assert.equal(redactUrl("/api/other"), "/api/other");
});

test("the 21st mint within a minute is rate limited", async () => {
  _resetForTests();
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
