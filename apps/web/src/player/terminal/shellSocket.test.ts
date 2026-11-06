import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_MS, ShellNotReadyError, backoffMs, createShellSocket, shellUrl } from "./shellSocket.ts";

const location = { protocol: "http:", host: "localhost:5173" };
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
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

test("nothing connects until connect() is called", () => {
  reset();
  const s = make();
  assert.equal(FakeWS.count, 0);
  assert.equal(s.state().kind, "idle");
});

test("send is dropped unless the socket is open", () => {
  reset();
  const s = make();
  s.send("x");
  s.connect(80, 24);
  s.send("y");
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
