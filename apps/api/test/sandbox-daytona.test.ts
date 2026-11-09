import "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { daytonaBackend, learnerHash, type DaytonaClient, type DaytonaSandbox } from "../src/sandbox/daytona.ts";
import { SandboxBusyError, SandboxNotRunningError, LIST_MAX_ENTRIES } from "../src/sandbox/backend.ts";

function fake(opts: { hangLogs?: boolean; failDeletes?: number; createDelay?: number;  existing?: Partial<DaytonaSandbox>[]; exitCode?: number; mktemp?: { exitCode?: number; result?: string }; logs?: [string, string]; home?: string | undefined; files?: Array<{ name: string; isDir: boolean; size: number; mode: string }>; listStatus?: number; listError?: Error; details?: { isDir: boolean; mode?: string } | "fail"; deleteFails?: boolean } = {}) {
  const log = { created: [] as Record<string, unknown>[], ptyOptions: [] as Array<{ cwd?: string; envs?: Record<string, string> }>, deleted: 0, started: 0, waited: 0, failedDeletes: 0, reqs: [] as Record<string, unknown>[],  listed: [] as unknown[], input: [] as string[], uploaded: [] as string[], fsOps: [] as string[], homeCalls: 0, listedPaths: [] as string[], cmds: [] as string[], execs: [] as string[], ptyInput: [] as string[], resized: [] as number[][] };
  const createdFolders = new Set<string>();
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
        log.ptyOptions.push({ cwd: o.cwd, envs: o.envs });
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
      executeCommand: async (c) => {
        log.execs.push(c);
        if (c === "mktemp -d") return { exitCode: 0, result: "/tmp/tmp.Ab3dEf9x\n", ...opts.mktemp };
        return { exitCode: 0, result: "" };
      },
      executeSessionCommand: async (_s, req) => (log.cmds.push(req.command), log.reqs.push(req), { cmdId: "c1" }),
      getSessionCommandLogs: async (_s, _c, out, err) => {
        if (opts.hangLogs) return new Promise(() => {});
        out(opts.logs?.[0] ?? "hi\n");
        err(opts.logs?.[1] ?? "");
      },
      getSessionCommand: async () => ({ exitCode: opts.exitCode ?? 0 }),
      sendSessionCommandInput: async (_s, _c, d) => void log.input.push(d),
    },
    getUserHomeDir: async () => (log.homeCalls++, "home" in opts ? opts.home : "/home/daytona"),
    fs: {
      createFolder: async (p, mode) => { log.fsOps.push(`mkdir ${p} ${mode}`); createdFolders.add(p); },
      uploadFile: async (_f, p) => (log.fsOps.push(`upload ${p}`), void log.uploaded.push(p)),
      deleteFile: async (p) => {
        if (opts.deleteFails) throw new Error("delete refused");
        log.fsOps.push(`delete ${p}`);
      },
      getFileDetails: async (p) => {
        if (createdFolders.has(p)) return { isDir: true, mode: "drwxr-xr-x" };
        if (opts.details === "fail") throw new Error("no details");
        if (!opts.details) throw Object.assign(new Error("not found"), { statusCode: 404 });
        return opts.details;
      },
      listFiles: async (p) => {
        log.listedPaths.push(p);
        if (opts.listError) throw opts.listError;
        if (opts.listStatus) throw Object.assign(new Error("status"), { statusCode: opts.listStatus });
        return opts.files ?? [];
      },
    },
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

test("writeWorkspaceFile creates missing parent folders before uploading", async () => {
  const f = fake({ existing: [{ state: "started" }] });
  await daytonaBackend({ client: f.client }).writeWorkspaceFile!("learner-1", "task-tracker/src/app.js", "console.log('ok')\n");
  assert.deepEqual(f.log.fsOps, [
    "mkdir /home/daytona/task-tracker 755",
    "mkdir /home/daytona/task-tracker/src 755",
    "upload /home/daytona/task-tracker/src/app.js",
  ]);
});

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
  assert.deepEqual(f.log.ptyOptions[0], {
    cwd: "/home/daytona/task-tracker",
    envs: { TERM: "xterm-256color", ZDOTDIR: "/home/daytona/.learnquest-zsh" },
  });
  assert.ok(f.log.uploaded.includes("/home/daytona/.learnquest-zsh/.zshrc"));
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
  assert.deepEqual(f.log.uploaded, ["/tmp/tmp.Ab3dEf9x/main.py"]);
  assert.equal(f.log.cmds[0], "timeout -s KILL 60 python3 -I -u '/tmp/tmp.Ab3dEf9x/main.py'");
  assert.deepEqual(f.log.input, ["early answer\n"]);
  assert.equal(f.log.deleted, 1);
});

test("runCode uses a private mktemp directory, not a fixed /tmp name, and removes it after the run", async () => {
  for (const [language, name] of [["python", "main.py"], ["javascript", "main.js"], ["typescript", "main.ts"]] as const) {
    const f = fake({ mktemp: { result: "/tmp/tmp.Zq81\n" } });
    const run = daytonaBackend({ client: f.client }).runCode!("l", language, "x", { timeoutS: 5 });
    await new Promise((res) => run.onExit(res));
    assert.deepEqual(f.log.uploaded, [`/tmp/tmp.Zq81/${name}`]);
    assert.notEqual(f.log.uploaded[0], `/tmp/${name}`);
    assert.ok(f.log.cmds[0]!.endsWith(` '/tmp/tmp.Zq81/${name}'`));
    assert.equal(f.log.execs[0], "mktemp -d");
    assert.equal(f.log.execs.at(-1), "rm -rf -- '/tmp/tmp.Zq81'");
  }
});

test("a failing or empty mktemp fails the run and never falls back to /tmp", async () => {
  for (const mktemp of [{ exitCode: 1, result: "" }, { exitCode: 0, result: "  \n" }, { exitCode: 0, result: "relative" }]) {
    const f = fake({ mktemp });
    const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
    const r = await new Promise<[number | null, string | undefined]>((res) => run.onExit((c, e) => res([c, e])));
    assert.deepEqual(r, [null, "Could not run the code"]);
    assert.deepEqual(f.log.uploaded, []);
    assert.equal(f.log.cmds.length, 0);
    assert.equal(f.log.deleted, 1);
  }
});

test("a failing directory cleanup does not fail the run", async () => {
  const f = fake();
  const orig = f.client.create;
  f.client.create = async (p) => {
    const s = await orig(p);
    const exec = s.process.executeCommand;
    s.process.executeCommand = async (c, ...a) => { if (c.startsWith("rm ")) throw new Error("rm failed"); return exec(c, ...a); };
    return s;
  };
  const run = daytonaBackend({ client: f.client }).runCode!("l", "python", "x", { timeoutS: 5 });
  assert.equal(await new Promise((res) => run.onExit((c) => res(c))), 0);
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

test("writeFile removes a symlink or non-regular file before uploading, and leaves regular or missing files alone", async () => {
  const run = async (o: Parameters<typeof fake>[0]) => {
    const f = fake({ ...o, existing: [{ state: "started" }] });
    const b = daytonaBackend({ client: f.client });
    await b.writeFile!("learner-1", "solution.py", "x");
    return f.log.fsOps;
  };
  const p = "/home/daytona/solution.py";
  assert.deepEqual(await run({ details: { isDir: false, mode: "Lrwxrwxrwx" } }), [`delete ${p}`, `upload ${p}`]);
  assert.deepEqual(await run({ details: { isDir: true, mode: "drwxr-xr-x" } }), [`delete ${p}`, `upload ${p}`]);
  assert.deepEqual(await run({ details: { isDir: false, mode: "-rw-r--r--" } }), [`upload ${p}`]);
  assert.deepEqual(await run({}), [`upload ${p}`], "404 means nothing to clean up");
  const f = fake({ details: { isDir: false, mode: "Lrwxrwxrwx" }, deleteFails: true, existing: [{ state: "started" }] });
  const b = daytonaBackend({ client: f.client });
  await assert.rejects(b.writeFile!("learner-1", "solution.py", "x"), /delete refused/);
  assert.deepEqual(f.log.fsOps, [], "no upload after a failed delete");
});

test("writeFile uploads to <home>/solution.py and never creates a sandbox", async () => {
  const f = fake({ existing: [{ state: "started" }], home: "/home/daytona" });
  const b = daytonaBackend({ client: f.client });
  await b.writeFile!("learner-1", "solution.py", "print(1)");
  await b.writeFile!("learner-1", "solution.js", "1");
  assert.deepEqual(f.log.uploaded, ["/home/daytona/solution.py", "/home/daytona/solution.js"]);
  assert.equal(f.log.created.length, 0);
  assert.equal(f.log.homeCalls, 1, "home is cached per sandbox id");
});

test("no sandbox, or one that is not started, is SandboxNotRunningError and nothing is created or started", async () => {
  for (const existing of [[], [{ state: "stopped" }], [{ state: "starting" }]]) {
    const f = fake({ existing });
    const b = daytonaBackend({ client: f.client });
    await assert.rejects(b.writeFile!("learner-1", "solution.py", "x"), SandboxNotRunningError);
    await assert.rejects(b.listDir!("learner-1", ""), SandboxNotRunningError);
    assert.equal(f.log.created.length + f.log.started, 0);
  }
});

test("listDir maps FileInfo, falls back to /home/learner, and returns null on 404", async () => {
  const f = fake({ existing: [{ state: "started" }], home: undefined,
    files: [{ name: "d", isDir: true, size: 0, mode: "drwxr-xr-x" }, { name: "a.py", isDir: false, size: 3, mode: "-rw-r--r--" },
            { name: "l", isDir: false, size: 1, mode: "Lrwxrwxrwx" }] });
  const b = daytonaBackend({ client: f.client });
  assert.deepEqual((await b.listDir!("learner-1", "proj"))!.entries,
    [{ name: "d", type: "dir", size: 0 }, { name: "a.py", type: "file", size: 3 }, { name: "l", type: "link", size: 1 }]);
  assert.equal(f.log.listedPaths.at(-1), "/home/learner/proj");
  const g = fake({ existing: [{ state: "started" }], listStatus: 404 });
  assert.equal(await daytonaBackend({ client: g.client }).listDir!("learner-1", "gone"), null);
});

test("listDir caps at LIST_MAX_ENTRIES and flags truncation; other failures throw", async () => {
  const many = Array.from({ length: LIST_MAX_ENTRIES + 5 }, (_, i) => ({ name: `f${i}`, isDir: false, size: 1, mode: "-rw-r--r--" }));
  const f = fake({ existing: [{ state: "started" }], files: many });
  const r = await daytonaBackend({ client: f.client }).listDir!("learner-1", "");
  assert.equal(r!.entries.length, LIST_MAX_ENTRIES);
  assert.equal(r!.truncated, true);
  assert.equal(f.log.listedPaths.at(-1), "/home/daytona");
  const g = fake({ existing: [{ state: "started" }], listStatus: 500 });
  await assert.rejects(daytonaBackend({ client: g.client }).listDir!("learner-1", ""), /status/);
});

test("listDir on a file path is null; a real failure rethrows the original error", async () => {
  const file = fake({ existing: [{ state: "started" }], listStatus: 500, details: { isDir: false } });
  assert.equal(await daytonaBackend({ client: file.client }).listDir!("learner-1", "a.py"), null);
  for (const details of ["fail", { isDir: true }] as const) {
    const f = fake({ existing: [{ state: "started" }], listStatus: 500, details });
    await assert.rejects(daytonaBackend({ client: f.client }).listDir!("learner-1", "x"), /^Error: status$/);
  }
});

test("file methods look the sandbox up by the hashed learner label", async () => {
  const f = fake({ existing: [{ state: "started" }] });
  const b = daytonaBackend({ client: f.client });
  await b.writeFile!("learner-1", "solution.py", "x");
  await b.listDir!("learner-1", "");
  const labels = { app: "learnquest", role: "shell", learner: learnerHash("learner-1") };
  assert.deepEqual(f.log.listed, [{ labels }, { labels }]);
});
