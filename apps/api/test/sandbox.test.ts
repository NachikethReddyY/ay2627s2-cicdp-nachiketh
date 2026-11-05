import { signUp } from "./helpers.ts";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { getBackend, setBackend, type ShellHandle } from "../src/sandbox/backend.ts";

const app = buildApp();
env.SANDBOX_ENABLED = true;
before(() => app.listen({ port: 0, host: "127.0.0.1" }));
after(() => {
  setBackend(null);
  return app.close();
});

function fakeBackend() {
  const calls = { open: [] as { learnerId: string; cols: number; rows: number }[], written: [] as string[], resized: [] as number[][], killed: 0 };
  const exits: ((code: number) => void)[] = [];
  setBackend({
    // Every call gets its own shell, like a real `docker exec` per tab.
    openShell: async (learnerId, size) => {
      calls.open.push({ learnerId, ...size });
      let emit: (d: Uint8Array) => void = () => {};
      const shell: ShellHandle = {
        write: (d) => {
          calls.written.push(Buffer.from(d).toString());
          emit(Buffer.from(`echo:${Buffer.from(d)}`));
        },
        resize: (c, r) => calls.resized.push([c, r]),
        kill: () => void calls.killed++,
        onData: (cb) => (emit = cb),
        onExit: (cb) => exits.push(cb),
      };
      return shell;
    },
  });
  return { calls, exit: (code: number, i = 0) => exits[i]!(code) };
}

// Node's built-in WebSocket client; undici accepts a headers option, which the browser API does not.
type Frame = { data: string | Buffer; bin: boolean };
async function connect(cookie: string, tab?: string, origin = env.PUBLIC_ORIGIN) {
  const { port } = app.server.address() as AddressInfo;
  const sock = new WebSocket(`ws://127.0.0.1:${port}/api/sandbox/shell?cols=100&rows=30${tab === undefined ? "" : `&tab=${tab}`}`, {
    headers: { cookie, origin },
  } as never);
  sock.binaryType = "arraybuffer";
  const frames: Frame[] = [];
  const waiting: ((f: Frame) => void)[] = [];
  sock.onmessage = (e) => {
    const f = { data: typeof e.data === "string" ? e.data : Buffer.from(e.data as ArrayBuffer), bin: typeof e.data !== "string" };
    (waiting.shift() ?? ((x: Frame) => frames.push(x)))(f);
  };
  const closed = new Promise<number>((res) => (sock.onclose = (e) => res(e.code)));
  await new Promise<void>((res, rej) => {
    sock.onopen = () => res();
    sock.onerror = () => rej(new Error("handshake refused"));
  });
  const next = () => new Promise<Frame>((res) => (frames.length ? res(frames.shift()!) : waiting.push(res)));
  return { sock, next, closed };
}

test("rejects an upgrade without a session, from a bad origin, or when disabled", async () => {
  const cookie = await signUp(app);
  const get = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/api/sandbox/shell", headers });

  assert.equal((await get({ origin: env.PUBLIC_ORIGIN })).statusCode, 401);
  assert.equal((await get({ cookie, origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await get({ cookie })).statusCode, 403, "a missing Origin is refused too");
  env.SANDBOX_ENABLED = false;
  try {
    assert.equal((await get({ cookie, origin: env.PUBLIC_ORIGIN })).statusCode, 503);
  } finally {
    env.SANDBOX_ENABLED = true;
  }
});

test("an unauthenticated client never gets a socket", async () => {
  fakeBackend();
  await assert.rejects(connect(""), /handshake refused/);
});

test("relays input and output as binary, applies resize, reports exit", async () => {
  const cookie = await signUp(app);
  const fake = fakeBackend();
  const { sock, next, closed } = await connect(cookie);

  sock.send(Buffer.from("ls\n"));
  const reply = await next();
  assert.equal(reply.bin, true);
  assert.equal(reply.data.toString(), "echo:ls\n");
  assert.deepEqual(fake.calls.written, ["ls\n"]);
  assert.deepEqual({ cols: fake.calls.open[0]!.cols, rows: fake.calls.open[0]!.rows }, { cols: 100, rows: 30 });

  sock.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  sock.send(JSON.stringify({ type: "resize", cols: -1, rows: "x" }));
  sock.send("not json");
  // Messages are handled in order, so once this echo returns the control frames have been applied.
  sock.send(Buffer.from("x"));
  await next();
  assert.deepEqual(fake.calls.resized, [[120, 40], [100, 30]]);

  fake.exit(3);
  const msg = await next();
  assert.equal(msg.bin, false);
  assert.deepEqual(JSON.parse(msg.data as string), { type: "exit", code: 3 });
  await closed;
  await new Promise((r) => setTimeout(r, 50)); // server-side close handler runs after the client sees it
  assert.equal(fake.calls.killed, 1, "the shell is killed once the socket closes");
});

test("a second connection replaces the first", async () => {
  const cookie = await signUp(app);
  fakeBackend();
  const first = await connect(cookie);
  const second = await connect(cookie);
  assert.equal(await first.closed, 4000);
  assert.equal(second.sock.readyState, WebSocket.OPEN);
  second.sock.close();
  await second.closed;
});

test("tabs run side by side and each gets its own output", async () => {
  const cookie = await signUp(app);
  const fake = fakeBackend();
  const a = await connect(cookie, "a");
  const b = await connect(cookie, "b");

  a.sock.send(Buffer.from("1"));
  b.sock.send(Buffer.from("2"));
  assert.equal((await a.next()).data.toString(), "echo:1");
  assert.equal((await b.next()).data.toString(), "echo:2");
  a.sock.send(Buffer.from("3"));
  assert.equal((await a.next()).data.toString(), "echo:3", "tab b's output never reaches tab a");
  assert.equal(fake.calls.open.length, 2);
  assert.equal(b.sock.readyState, WebSocket.OPEN);

  a.sock.close();
  b.sock.close();
  await Promise.all([a.closed, b.closed]);
});

test("the same tab replaces only its own old connection", async () => {
  const cookie = await signUp(app);
  const fake = fakeBackend();
  const a = await connect(cookie, "a");
  const b = await connect(cookie, "b");
  const a2 = await connect(cookie, "a");

  assert.equal(await a.closed, 4000);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fake.calls.killed, 1, "only the replaced tab's shell is killed");
  assert.equal(b.sock.readyState, WebSocket.OPEN);
  assert.equal(a2.sock.readyState, WebSocket.OPEN);
  b.sock.send(Buffer.from("x"));
  assert.equal((await b.next()).data.toString(), "echo:x");

  a2.sock.close();
  b.sock.close();
  await Promise.all([a2.closed, b.closed]);
});

test("an invalid tab id is refused with 400 before the upgrade", async () => {
  const cookie = await signUp(app);
  fakeBackend();
  const get = (tab: string) =>
    app.inject({ method: "GET", url: `/api/sandbox/shell?tab=${tab}`, headers: { cookie, origin: env.PUBLIC_ORIGIN } });

  for (const tab of ["", "a%20b", "a.b", "a:b", "x".repeat(65), "a&tab=b"]) {
    assert.equal((await get(tab)).statusCode, 400, `tab=${tab}`);
  }
  await assert.rejects(connect(cookie, "bad.tab"), /handshake refused/);
});

test("a learner can open only SANDBOX_MAX_TABS terminals; reconnecting a tab does not count", async () => {
  const cookie = await signUp(app);
  const fake = fakeBackend();
  const max = env.SANDBOX_MAX_TABS;
  env.SANDBOX_MAX_TABS = 2;
  try {
    const a = await connect(cookie, "a");
    const b = await connect(cookie, "b");
    const c = await connect(cookie, "c");
    assert.deepEqual(JSON.parse((await c.next()).data as string), { type: "error", message: "At most 2 terminals at once" });
    assert.equal(await c.closed, 4029);
    const a2 = await connect(cookie, "a");
    assert.equal(await a.closed, 4000, "the same tab still takes over");
    assert.equal(a2.sock.readyState, WebSocket.OPEN);
    // Another learner has their own allowance.
    const other = await connect(await signUp(app, "tabs-other@example.com"), "a");
    assert.equal(other.sock.readyState, WebSocket.OPEN);
    assert.equal(fake.calls.open.length, 4, "the refused tab never started a shell");
    for (const s of [a2, b, other]) s.sock.close();
    await Promise.all([a2.closed, b.closed, other.closed]);
  } finally {
    env.SANDBOX_MAX_TABS = max;
  }
});

test("the server refuses new shells past SANDBOX_MAX_SHELLS", async () => {
  fakeBackend();
  await new Promise((r) => setTimeout(r, 50)); // earlier tests' server-side close handlers have run
  const max = env.SANDBOX_MAX_SHELLS;
  env.SANDBOX_MAX_SHELLS = 1;
  try {
    const first = await connect(await signUp(app));
    const second = await connect(await signUp(app, "shells-second@example.com"));
    assert.equal(JSON.parse((await second.next()).data as string).type, "error");
    assert.equal(await second.closed, 4503);
    first.sock.close();
    await first.closed;
  } finally {
    env.SANDBOX_MAX_SHELLS = max;
  }
});

test("a frame over 64 KiB closes the socket", async () => {
  const cookie = await signUp(app);
  const fake = fakeBackend();
  const { sock, closed } = await connect(cookie);
  sock.send(Buffer.alloc(64 * 1024 + 1));
  assert.equal(await closed, 1009, "message too big");
  assert.deepEqual(fake.calls.written, []);
});

test("concurrent first getBackend calls share one backend", async () => {
  setBackend(null);
  const [a, b] = await Promise.all([getBackend(), getBackend()]);
  assert.equal(a, b);
  setBackend(null);
});
