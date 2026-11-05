import "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { daytonaBackend, learnerHash, type DaytonaClient, type DaytonaSandbox } from "../src/sandbox/daytona.ts";
import { SandboxBusyError } from "../src/sandbox/backend.ts";

function fake(opts: { hangLogs?: boolean; failDeletes?: number; createDelay?: number;  existing?: Partial<DaytonaSandbox>[]; exitCode?: number; logs?: [string, string] } = {}) {
  const log = { created: [] as Record<string, unknown>[], deleted: 0, started: 0, waited: 0, failedDeletes: 0, reqs: [] as Record<string, unknown>[],  listed: [] as unknown[], input: [] as string[], uploaded: [] as string[], cmds: [] as string[], ptyInput: [] as string[], resized: [] as number[][] };
  let onData: (d: Uint8Array) => void = () => {};
  let endPty: (r: { exitCode?: number }) => void = () => {};
  const mk = (extra: Partial<DaytonaSandbox> = {}): DaytonaSandbox => ({
    id: "sbx1",
    state: "started",
    start: async () => void log.started++,
    waitUntilStarted: async () => void log.waited++,
    waitUntilStopped: async () => {},
    setAutostopInterval: async () => {},
    process: {
      createPty: async (o) => {
        onData = (d) => void o.onData(d);
        return {
          sendInput: async (d) => void log.ptyInput.push(Buffer.from(d).toString()),
          resize: async (c, r) => void log.resized.push([c, r]),
          kill: async () => {},
          disconnect: async () => {},
          waitForConnection: async () => {},
          wait: () => new Promise((res) => (endPty = res)),
        };
      },
      createSession: async () => {},
      executeSessionCommand: async (_s, req) => (log.cmds.push(req.command), log.reqs.push(req), { cmdId: "c1" }),
      getSessionCommandLogs: async (_s, _c, out, err) => {
        if (opts.hangLogs) return new Promise(() => {});
        out(opts.logs?.[0] ?? "hi\n");
        err(opts.logs?.[1] ?? "");
      },
      getSessionCommand: async () => ({ exitCode: opts.exitCode ?? 0 }),
      sendSessionCommandInput: async (_s, _c, d) => void log.input.push(d),
    },
    fs: { uploadFile: async (_f, p) => void log.uploaded.push(p) },
    ...extra,
  });
  const client: DaytonaClient = {
    create: async (p) => {
      log.created.push(p);
      if (opts.createDelay) await new Promise((r) => setTimeout(r, opts.createDelay));
      return mk();
    },
    list: async function* (q) {
      log.listed.push(q);
      for (const e of opts.existing ?? []) yield mk(e);
    },
    delete: async () => {
      if (log.failedDeletes < (opts.failDeletes ?? 0)) { log.failedDeletes++; throw new Error("boom"); }
      log.deleted++;
    },
  };
  return { client, log, emit: (s: string) => onData(Buffer.from(s)), end: (code: number) => endPty({ exitCode: code }) };
}

test("openShell creates a labelled sandbox with auto-stop and opens a PTY", async () => {
  const f = fake();
  const b = daytonaBackend({ client: f.client, snapshot: "lq-snap", autoStopMinutes: 7 });
  const shell = await b.openShell("learner-1", { cols: 100, rows: 30 });
  assert.equal(f.log.created.length, 1);
  assert.deepEqual(f.log.created[0], {
    snapshot: "lq-snap",
    labels: { app: "learnquest", role: "shell", learner: learnerHash("learner-1") },
    autoStopInterval: 7,
  });
  const got: string[] = [];
  shell.onData((d) => got.push(Buffer.from(d).toString()));
  f.emit("$ ");
  shell.write("ls\n");
  shell.resize(120, 40);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got, ["$ "]);
  assert.deepEqual(f.log.ptyInput, ["ls\n"]);
  assert.deepEqual(f.log.resized, [[120, 40]]);
  const exits: number[] = [];
  shell.onExit((c) => exits.push(c));
  f.end(3);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(exits, [3]);
});

test("openShell reuses the learner's sandbox and starts it when stopped", async () => {
  const f = fake({ existing: [{ id: "old", state: "stopped" }] });
  await daytonaBackend({ client: f.client }).openShell("learner-1", { cols: 80, rows: 24 });
  assert.equal(f.log.created.length, 0);
  assert.equal(f.log.started, 1);
});

test("output before onData is attached is not lost", async () => {
  const f = fake();
  const shell = await daytonaBackend({ client: f.client }).openShell("l", { cols: 80, rows: 24 });
  f.emit("early");
  const got: string[] = [];
  shell.onData((d) => got.push(Buffer.from(d).toString()));
  assert.deepEqual(got, ["early"]);
});

test("concurrent first connects share one sandbox", async () => {
  const f = fake();
  const b = daytonaBackend({ client: f.client });
  await Promise.all([b.openShell("l", { cols: 80, rows: 24 }), b.openShell("l", { cols: 80, rows: 24 })]);
  assert.equal(f.log.created.length, 1);
});

test("the shell cap refuses with SandboxBusyError and frees on kill", async () => {
  const f = fake();
  const b = daytonaBackend({ client: f.client, maxShells: () => 1 });
  const s = await b.openShell("a", { cols: 80, rows: 24 });
  await assert.rejects(b.openShell("b", { cols: 80, rows: 24 }), SandboxBusyError);
  s.kill();
  await b.openShell("b", { cols: 80, rows: 24 });
});

test("runCode runs in a network-blocked ephemeral sandbox, streams output and deletes it", async () => {
  const f = fake({ exitCode: 0, logs: ["out\n", "warn\n"] });
  const run = daytonaBackend({ client: f.client, snapshot: "s" }).runCode!("l", "python", "print(1)", { timeoutS: 60 });
  const out: string[] = [];
  const err: string[] = [];
  run.onStdout((d) => out.push(d));
  run.onStderr((d) => err.push(d));
  run.writeLine("early answer");
  const code = await new Promise((res) => run.onExit((c) => res(c)));
  assert.equal(code, 0);
  assert.deepEqual(out, ["out\n"]);
  assert.deepEqual(err, ["warn\n"]);
  assert.equal(f.log.created[0]!.networkBlockAll, true);
  assert.equal(f.log.created[0]!.ephemeral, true);
  assert.deepEqual(f.log.uploaded, ["/tmp/main.py"]);
  assert.equal(f.log.cmds[0], "timeout -s KILL 60 python3 -I -u /tmp/main.py");
  assert.deepEqual(f.log.input, ["early answer\n"]);
  assert.equal(f.log.deleted, 1);
});

test("runCode kill deletes the sandbox and reports no exit code", async () => {
  const f = fake();
  const run = daytonaBackend({ client: f.client }).runCode!("l", "javascript", "x", { timeoutS: 5 });
  const exit = new Promise<number | null>((res) => run.onExit((c) => res(c)));
  await run.kill();
  assert.equal(await exit, null);
  assert.ok(f.log.deleted >= 1);
});

test("runCode reports a failed start", async () => {
  const f = fake();
  f.client.create = async () => { throw new Error("quota"); };
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  const r = await new Promise<[number | null, string | undefined]>((res) => run.onExit((c, e) => res([c, e])));
  assert.deepEqual(r, [null, "Could not run the code"]);
});

test("a run killed while its sandbox is still being created deletes it", async () => {
  const f = fake({ createDelay: 30 });
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  await run.kill();
  assert.equal(f.log.deleted, 1);
  assert.equal(f.log.cmds.length, 0);
});

test("a second kill waits for the same delete and deletes once", async () => {
  const f = fake();
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  await Promise.all([run.kill(), run.kill()]);
  assert.equal(f.log.deleted, 1);
});

test("runCode suppresses input echo so typed answers stay out of the output", async () => {
  const f = fake();
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  await new Promise((res) => run.onExit(res));
  assert.equal(f.log.reqs[0]!.suppressInputEcho, true);
});

test("a stopped shell sandbox is started; a broken one is replaced; a starting one is waited on", async () => {
  const broken = fake({ existing: [{ state: "error" }] });
  await daytonaBackend({ client: broken.client }).openShell("l", { cols: 80, rows: 24 });
  assert.equal(broken.log.deleted, 1);
  assert.equal(broken.log.created.length, 1);
  const starting = fake({ existing: [{ state: "starting" }] });
  await daytonaBackend({ client: starting.client }).openShell("l", { cols: 80, rows: 24 });
  assert.equal(starting.log.waited, 1);
  assert.equal(starting.log.started, 0);
});

test("killing a program that is still running (blocked on input) deletes the sandbox without waiting for it", async () => {
  const f = fake({ hangLogs: true });
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "input()", { timeoutS: 60 });
  await new Promise<void>((res) => run.onStart(res));
  await run.kill();
  assert.equal(f.log.deleted, 1);
});

test("a failed sandbox delete is retried", async () => {
  const f = fake({ failDeletes: 2 });
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  await new Promise((res) => run.onExit(res));
  assert.equal(f.log.deleted, 1);
});
