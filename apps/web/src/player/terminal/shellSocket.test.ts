import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_MS, ShellNotReadyError, backoffMs, createShellSocket, normalizeWsOrigin, shellUrl } from "./shellSocket.ts";

const location = { protocol: "http:", host: "localhost:5173" };
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// A real Response body parse (res.json()) finishes on a later macrotask than a few microtask turns, so wait on
// real setImmediate (never the mocked setTimeout) until `done` holds, with a bounded number of turns.
const settleUntil = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise<void>((r) => setImmediate(r));
};

class FakeWS {
  static all: FakeWS[] = [];
  static get last() {
    return FakeWS.all[FakeWS.all.length - 1];
  }
  static get count() {
    return FakeWS.all.length;
  }
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.all.push(this);
  }
  send(d: string | Uint8Array) {
    this.sent.push(d);
  }
  // Called by the socket under test.
  close(code?: number) {
    this.closedWith = code;
  }
  open() {
    this.onopen?.();
  }
  msg(data: unknown) {
    this.onmessage?.({ data });
  }
  // The server side ends the connection. The brief names this helper close(code); the socket under test also
  // calls close(), so the test helper is named `drop`.
  drop(code: number) {
    this.onclose?.({ code });
  }
}

const make = (probe: () => Promise<number> = async () => 404) =>
  createShellSocket({ WebSocket: FakeWS as unknown as new (url: string) => WebSocket, location, probe });

const reset = () => {
  FakeWS.all = [];
};

test("URL, binary keystrokes and resize frames", () => {
  reset();
  assert.equal(shellUrl({ protocol: "https:", host: "x.dev" }, 100, 30), "wss://x.dev/api/sandbox/shell?tab=practice&cols=100&rows=30");
  assert.equal(shellUrl({ protocol: "http:", host: "localhost:5173" }, 80, 24), "ws://localhost:5173/api/sandbox/shell?tab=practice&cols=80&rows=24");
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  assert.equal(FakeWS.last.binaryType, "arraybuffer");
  s.send("ls\r");
  s.resize(120, 40);
  assert.deepEqual(new TextDecoder().decode(FakeWS.last.sent[0] as Uint8Array), "ls\r");
  assert.deepEqual(JSON.parse(FakeWS.last.sent[1] as string), { type: "resize", cols: 120, rows: 40 });
  s.dispose();
});

test("sendBytes passes bytes >= 128 through unchanged as a binary frame", () => {
  reset();
  const s = make();
  const bytes = new Uint8Array([0x1b, 0x5b, 0x4d, 0xff, 0xc3, 0xa9, 0x80]);
  assert.equal(s.sendBytes(bytes), false);
  s.connect(80, 24);
  assert.equal(s.sendBytes(bytes), false);
  FakeWS.last.open();
  assert.equal(s.sendBytes(bytes), true);
  const sent = FakeWS.last.sent[0] as Uint8Array;
  assert.ok(sent instanceof Uint8Array);
  assert.deepEqual([...sent], [...bytes]);
  s.dispose();
});

test("nothing connects until connect() is called", () => {
  reset();
  const s = make();
  assert.equal(FakeWS.count, 0);
  assert.equal(s.state().kind, "idle");
});

test("send is dropped unless the socket is open", () => {
  reset();
  const s = make();
  assert.equal(s.send("x"), false);
  s.connect(80, 24);
  assert.equal(s.send("y"), false);
  assert.deepEqual(FakeWS.last.sent, []);
  s.dispose();
});

test("backoff is 1, 2, 4, 8, 15, 15 s while active", (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.deepEqual(BACKOFF_MS, [1000, 2000, 4000, 8000, 15000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffMs), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  FakeWS.last.drop(1006);
  for (let n = 0; n < 6; n++) {
    const st = s.state();
    assert.equal(st.kind, "reconnecting");
    assert.equal((st as { inMs: number }).inMs, backoffMs(n));
    assert.equal((st as { attempt: number }).attempt, n + 1);
    const before = FakeWS.count;
    t.mock.timers.tick(backoffMs(n) - 1);
    assert.equal(FakeWS.count, before, "not before the delay");
    t.mock.timers.tick(1);
    assert.equal(FakeWS.count, before + 1, "exactly one new socket");
    assert.equal(s.state().kind, "connecting");
    // The server accepts the upgrade and then drops us before any output: the delay keeps growing.
    FakeWS.last.open();
    FakeWS.last.drop(1006);
  }
  s.dispose();
});

test("backoff restarts after a connection produced output", (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  FakeWS.last.drop(1006);
  t.mock.timers.tick(1000);
  FakeWS.last.open();
  FakeWS.last.drop(1006);
  assert.equal((s.state() as { inMs: number }).inMs, 2000);
  t.mock.timers.tick(2000);
  FakeWS.last.open();
  FakeWS.last.msg(bytes("$ "));
  FakeWS.last.drop(1006);
  assert.equal((s.state() as { inMs: number }).inMs, 1000);
  s.dispose();
});

test("no retry on 4029, 4503 or 4000; the server's message is kept", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [code, reason] of [
    [4029, "too_many_tabs"],
    [4503, "busy"],
    [4000, "replaced"],
  ] as const) {
    reset();
    const s = make();
    s.connect(80, 24);
    FakeWS.last.open();
    FakeWS.last.msg(JSON.stringify({ type: "error", message: "At most 2 terminals at once" }));
    FakeWS.last.drop(code);
    const st = s.state() as { kind: string; reason: string; message: string };
    assert.equal(st.kind, "closed");
    assert.equal(st.reason, reason);
    assert.equal(st.message, "At most 2 terminals at once");
    t.mock.timers.tick(60_000);
    assert.equal(FakeWS.count, 1, "no new socket");
    s.dispose();
  }
});

test("a refused handshake probes the files endpoint: 503 disabled, 401 signed out, 404 retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [status, reason] of [
    [503, "disabled"],
    [401, "signed_out"],
  ] as const) {
    reset();
    let probed = 0;
    const s = make(async () => {
      probed++;
      return status;
    });
    s.connect(80, 24);
    FakeWS.last.drop(1006); // closed without ever opening
    await flush();
    assert.equal(probed, 1);
    const st = s.state() as { kind: string; reason: string };
    assert.equal(st.kind, "closed");
    assert.equal(st.reason, reason);
    t.mock.timers.tick(60_000);
    assert.equal(FakeWS.count, 1);
    s.dispose();
  }
  reset();
  const s = make(async () => 404);
  s.connect(80, 24);
  FakeWS.last.drop(1006);
  await flush();
  assert.equal(s.state().kind, "reconnecting");
  t.mock.timers.tick(1000);
  assert.equal(FakeWS.count, 2);
  s.dispose();
  // A probe that cannot reach the server at all also retries.
  reset();
  const s2 = make(async () => {
    throw new Error("offline");
  });
  s2.connect(80, 24);
  FakeWS.last.drop(1006);
  await flush();
  assert.equal(s2.state().kind, "reconnecting");
  s2.dispose();
});

test("whenReady waits for the current connection's first output, including after a drop", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  FakeWS.last.msg(bytes("$ "));
  await s.whenReady(15_000);
  FakeWS.last.drop(1006); // drop after open: reconnecting
  let done = false;
  const p = s.whenReady(15_000).then(() => (done = true));
  t.mock.timers.tick(1000);
  FakeWS.last.open();
  await flush();
  assert.equal(done, false, "open is not ready");
  FakeWS.last.msg(bytes("$ "));
  await p;
  assert.equal(done, true);
  s.dispose();
});

test("whenReady rejects on timeout, on a terminal close and when exited", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const why = (p: Promise<void>) =>
    p.then(
      () => "resolved",
      (e) => {
        assert.ok(e instanceof ShellNotReadyError);
        return e.why;
      },
    );

  reset();
  const a = make();
  a.connect(80, 24);
  FakeWS.last.open();
  const timed = why(a.whenReady(5000));
  t.mock.timers.tick(5000);
  assert.equal(await timed, "timeout");
  a.dispose();

  reset();
  const b = make(async () => 503);
  b.connect(80, 24);
  const closed = why(b.whenReady(15_000));
  FakeWS.last.drop(1006);
  assert.equal(await closed, "disabled");
  assert.equal(await why(b.whenReady(15_000)), "disabled", "already closed rejects immediately");
  b.dispose();

  reset();
  const c = make();
  c.connect(80, 24);
  FakeWS.last.open();
  const exited = why(c.whenReady(15_000));
  FakeWS.last.msg(JSON.stringify({ type: "exit", code: 0 }));
  assert.equal(await exited, "exited");
  assert.equal(await why(c.whenReady(15_000)), "exited", "already exited rejects immediately");
  c.dispose();
});

test("exit frame then Enter reconnects", (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  FakeWS.last.msg(JSON.stringify({ type: "exit", code: 3 }));
  assert.deepEqual(s.state(), { kind: "exited", code: 3 });
  FakeWS.last.drop(1000); // the server closes after the exit frame; that must not schedule a retry
  t.mock.timers.tick(60_000);
  assert.equal(FakeWS.count, 1);
  s.send("x");
  assert.equal(FakeWS.count, 1, "other keys do not reconnect");
  s.send("\r");
  assert.equal(FakeWS.count, 2);
  assert.equal(s.state().kind, "connecting");
  s.dispose();
});

test("inactive panel pauses retries and resumes on setActive(true)", (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  s.setActive(false);
  FakeWS.last.drop(1006);
  assert.equal(s.state().kind, "paused");
  t.mock.timers.tick(60_000);
  assert.equal(FakeWS.count, 1);
  s.setActive(true);
  assert.equal(s.state().kind, "connecting");
  assert.equal(FakeWS.count, 2);
  s.dispose();
});

test("going inactive while a retry is waiting cancels it", (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  s.connect(80, 24);
  FakeWS.last.open();
  FakeWS.last.drop(1006);
  assert.equal(s.state().kind, "reconnecting");
  s.setActive(false);
  assert.equal(s.state().kind, "paused");
  t.mock.timers.tick(60_000);
  assert.equal(FakeWS.count, 1);
  s.dispose();
});

test("output and state listeners, and dispose", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = make();
  const out: string[] = [];
  const states: string[] = [];
  const off = s.onOutput((b) => out.push(new TextDecoder().decode(b)));
  s.onState((st) => states.push(st.kind));
  s.connect(80, 24);
  const w = FakeWS.last;
  w.open();
  w.msg(bytes("hi"));
  assert.deepEqual(out, ["hi"]);
  off();
  w.msg(bytes("again"));
  assert.deepEqual(out, ["hi"]);
  assert.deepEqual(states, ["connecting", "open", "open"]);
  const waiting = s.whenReady(15_000); // already ready
  await waiting;
  s.dispose();
  assert.equal(w.closedWith, 1000);

  const s2 = make();
  s2.connect(80, 24);
  const pending = s2.whenReady(15_000);
  s2.dispose();
  await assert.rejects(pending, ShellNotReadyError);
});

// ---- direct connection with a single-use ticket (production: browser -> API host) ----

const ORIGIN = "wss://learnquest-api.onrender.com";
const makeTicket = (fetchTicket: () => Promise<string>, wsOrigin: string | undefined = ORIGIN) =>
  createShellSocket({
    WebSocket: FakeWS as unknown as new (url: string) => WebSocket,
    location,
    probe: async () => 404,
    wsOrigin,
    fetchTicket,
  });
const statusErr = (status: number, code?: string) =>
  Object.assign(new Error(`HTTP ${status}`), { name: "ApiError", status, code });

test("shellUrl with a wsOrigin and ticket targets the API host and encodes the ticket", () => {
  assert.equal(
    shellUrl(location, 100, 30, { wsOrigin: ORIGIN, ticket: "a b/c+d" }),
    `${ORIGIN}/api/sandbox/shell?tab=practice&cols=100&rows=30&ticket=a%20b%2Fc%2Bd`,
  );
  assert.equal(shellUrl(location, 80, 24, {}), shellUrl(location, 80, 24));
  assert.equal(shellUrl(location, 80, 24, { wsOrigin: ORIGIN }), shellUrl(location, 80, 24));
});

test("with a wsOrigin the ticket is fetched once and the socket opens against the API host", async () => {
  reset();
  let calls = 0;
  const s = makeTicket(async () => {
    calls++;
    return "tk";
  });
  s.connect(80, 24);
  assert.equal(s.state().kind, "connecting");
  assert.equal(FakeWS.count, 0, "no socket before the ticket arrives");
  await flush();
  assert.equal(calls, 1);
  assert.equal(FakeWS.count, 1);
  assert.ok(FakeWS.last.url.startsWith(`${ORIGIN}/api/sandbox/shell?`));
  assert.ok(FakeWS.last.url.includes("ticket=tk"));
  FakeWS.last.open();
  assert.equal(s.state().kind, "open");
  s.dispose();
});

test("every reconnect fetches a fresh ticket", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let n = 0;
  const s = makeTicket(async () => `tk${++n}`);
  s.connect(80, 24);
  await flush();
  FakeWS.last.open();
  FakeWS.last.msg(bytes("$ "));
  FakeWS.last.drop(1006);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(n, 2);
  assert.equal(FakeWS.count, 2);
  assert.ok(FakeWS.last.url.includes("ticket=tk2"));
  assert.ok(!FakeWS.last.url.includes("ticket=tk1"));
  s.dispose();
});

test("ticket failures: 503 disabled, 401 signed out, anything else retries with backoff", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [status, reason, code] of [
    [503, "disabled", "unavailable"],
    [401, "signed_out", undefined],
  ] as const) {
    reset();
    let calls = 0;
    const s = makeTicket(async () => {
      calls++;
      throw statusErr(status, code);
    });
    s.connect(80, 24);
    await flush();
    const st = s.state() as { kind: string; reason: string };
    assert.equal(st.kind, "closed");
    assert.equal(st.reason, reason);
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(FakeWS.count, 0);
    assert.equal(calls, 1, "no retry");
    s.dispose();
  }
  for (const err of [new Error("offline"), statusErr(429), statusErr(503, "busy"), statusErr(503)]) {
    reset();
    let calls = 0;
    const s = makeTicket(async () => {
      calls++;
      if (calls === 1) throw err;
      return "tk";
    });
    s.connect(80, 24);
    await flush();
    const st = s.state() as { kind: string; inMs: number };
    assert.equal(st.kind, "reconnecting");
    assert.equal(st.inMs, 1000);
    assert.equal(FakeWS.count, 0);
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(calls, 2);
    assert.equal(FakeWS.count, 1);
    s.dispose();
  }
});

test("the default ticket fetch keeps the server error code; a 503 with a bad body retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const real = globalThis.fetch;
  try {
    for (const [body, expectClosed] of [
      [JSON.stringify({ error: { code: "unavailable", message: "x" } }), true],
      [JSON.stringify({ error: { code: "busy", message: "x" } }), false],
      ["<html>bad gateway</html>", false],
    ] as const) {
      reset();
      globalThis.fetch = (async () => new Response(body, { status: 503 })) as typeof fetch;
      const s = createShellSocket({
        WebSocket: FakeWS as unknown as new (url: string) => WebSocket,
        location,
        probe: async () => 404,
        wsOrigin: ORIGIN,
      });
      s.connect(80, 24);
      await settleUntil(() => s.state().kind !== "connecting");
      const st = s.state() as { kind: string; inMs?: number };
      assert.equal(st.kind, expectClosed ? "closed" : "reconnecting");
      if (!expectClosed) assert.equal(st.inMs, 1000);
      s.dispose();
    }
  } finally {
    globalThis.fetch = real;
  }
});

test("dispose while the ticket is pending never constructs a socket", async () => {
  reset();
  let release: (v: string) => void = () => {};
  const s = makeTicket(() => new Promise<string>((r) => (release = r)));
  s.connect(80, 24);
  s.dispose();
  release("tk");
  await flush();
  assert.equal(FakeWS.count, 0);
});

test("a WebSocket constructor that throws schedules a retry instead of hanging", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  class ThrowingWS {
    constructor() {
      throw new SyntaxError("bad url");
    }
  }
  const s = createShellSocket({
    WebSocket: ThrowingWS as unknown as new (url: string) => WebSocket,
    location,
    probe: async () => 404,
    wsOrigin: "learnquest-api.onrender.com",
    fetchTicket: async () => "tk",
  });
  s.connect(80, 24);
  await flush();
  const st = s.state() as { kind: string; inMs: number };
  assert.equal(st.kind, "reconnecting");
  assert.equal(st.inMs, 1000);
  await new Promise<void>((r) => setImmediate(r));
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
  s.dispose();
});

test("wsOrigin is normalised: trimmed, no trailing slash, http(s) mapped to ws(s)", () => {
  assert.equal(normalizeWsOrigin("  wss://a.dev/// "), "wss://a.dev");
  assert.equal(normalizeWsOrigin("https://a.dev/"), "wss://a.dev");
  assert.equal(normalizeWsOrigin("HTTP://a.dev:8080"), "ws://a.dev:8080");
  assert.equal(normalizeWsOrigin("   "), undefined);
  assert.equal(normalizeWsOrigin(undefined), undefined);
});

test("an injected https origin connects over wss", async () => {
  reset();
  const s = makeTicket(async () => "tk", "https://api.dev/");
  s.connect(80, 24);
  await flush();
  assert.ok(FakeWS.last.url.startsWith("wss://api.dev/api/sandbox/shell?"));
  s.dispose();
});

test("without a wsOrigin the ticket is never fetched", async () => {
  reset();
  let calls = 0;
  const s = makeTicket(async () => {
    calls++;
    return "tk";
  }, "");
  s.connect(80, 24);
  assert.equal(FakeWS.count, 1, "synchronous same-origin connect");
  assert.equal(FakeWS.last.url, "ws://localhost:5173/api/sandbox/shell?tab=practice&cols=80&rows=24");
  await flush();
  assert.equal(calls, 0);
  const e = createShellSocket({
    WebSocket: FakeWS as unknown as new (url: string) => WebSocket,
    location,
    probe: async () => 404,
    wsOrigin: undefined,
    fetchTicket: async () => {
      calls++;
      return "tk";
    },
  });
  e.connect(80, 24);
  assert.equal(FakeWS.count, 2, "an undefined origin is also same-origin");
  assert.equal(calls, 0);
  s.dispose();
  e.dispose();
});

test("connect() without a size reuses the last known size, including one set by resize", () => {
  reset();
  const s = make(async () => 404);
  s.connect(100, 30);
  FakeWS.last.drop(4029);
  s.resize(120, 40);
  s.connect();
  assert.ok(FakeWS.last.url.includes("cols=120&rows=40"), FakeWS.last.url);
  s.dispose();
});

test("a resize between connect and open is sent on open; an unchanged size sends nothing extra", () => {
  reset();
  const s = make();
  s.connect(80, 24);
  s.resize(100, 30); // not open yet, so the frame cannot go out now
  assert.equal(FakeWS.last.sent.length, 0);
  FakeWS.last.open();
  assert.equal(FakeWS.last.sent.length, 1);
  assert.deepEqual(JSON.parse(FakeWS.last.sent[0] as string), { type: "resize", cols: 100, rows: 30 });
  s.dispose();

  reset();
  const u = make();
  u.connect(80, 24);
  FakeWS.last.open();
  assert.equal(FakeWS.last.sent.length, 0);
  u.dispose();
});
