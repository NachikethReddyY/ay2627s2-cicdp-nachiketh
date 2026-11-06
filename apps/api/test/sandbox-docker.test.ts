// No database: this file only needs the env.ts variables below.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { dockerBackend, containerName } = await import("../src/sandbox/docker.ts");
const { SandboxNotRunningError } = await import("../src/sandbox/backend.ts");

type Script = { code: number | null; stdout?: string; stderr?: string };
type Call = { args: string[]; stdin: string; killed: boolean };

// A scripted stand-in for the child `docker exec` process: it emits the scripted stdout, then closes with the scripted code.
// A null code never closes by itself, so only kill() ends it (the cap path).
function fakeChildren() {
  const calls: Call[] = [];
  const scripts: Script[] = [];
  const spawnChild = ((_cmd: string, args: string[]) => {
    const script = scripts.shift() ?? { code: 0, stdout: "" };
    const call: Call = { args, stdin: "", killed: false };
    calls.push(call);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: Writable; kill: () => boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        call.stdin += chunk.toString();
        cb();
      },
    });
    let closed = false;
    const close = (code: number | null) => {
      if (closed) return;
      closed = true;
      child.emit("close", code);
    };
    child.kill = () => {
      call.killed = true;
      setImmediate(() => close(null));
      return true;
    };
    setImmediate(() => {
      if (script.stdout) child.stdout.emit("data", Buffer.from(script.stdout));
      if (script.stderr) child.stderr.emit("data", Buffer.from(script.stderr));
      if (script.code !== null) close(script.code);
    });
    return child;
  }) as never;
  return { calls, spawnChild, next: (s: Script) => void scripts.push(s) };
}

let b: ReturnType<typeof dockerBackend>;
let child: ReturnType<typeof fakeChildren>;
let cmds: string[];
let inspectState: string;

beforeEach(async () => {
  cmds = [];
  inspectState = "missing"; // no container yet, so openShell runs one
  child = fakeChildren();
  const exec = async (_cmd: string, args: string[]) => {
    cmds.push(args.join(" "));
    if (args[0] === "inspect") {
      if (inspectState === "missing") throw new Error("no such container");
      return { stdout: `${inspectState}\n` };
    }
    return { stdout: "" };
  };
  const spawn = (() => ({ write() {}, resize() {}, kill() {}, onData() {}, onExit() {} })) as never;
  b = dockerBackend({ image: "img", idleMs: 60_000, network: "lq-sbx", exec, spawn, spawnChild: child.spawnChild, maxContainers: () => 5 });
  await b.openShell("learner-a", { cols: 80, rows: 24 }); // starts the container and puts it in `live`
  inspectState = "true";
});

test("writeFile passes argv exactly and the content only on stdin", async () => {
  await b.writeFile!("learner-a", "solution.py", "print('$(rm -rf ~)')\n");
  assert.deepEqual(child.calls[0]!.args, ["exec", "-i", "-u", "1001", containerName("learner-a"),
    "sh", "-c", 'cat > "$1"', "sh", "/home/learner/solution.py"]);
  assert.equal(child.calls[0]!.stdin, "print('$(rm -rf ~)')\n");
  assert.ok(!child.calls[0]!.args.some((a) => a.includes("rm -rf")));
});

test("listDir runs find as uid 1001 and parses names with spaces, tabs, newlines and non-ASCII", async () => {
  child.next({ code: 0, stdout: "d\t4096\tmy dir\0f\t12\ta\tb.py\0f\t3\tline\nbreak\0l\t7\tlink\0p\t0\tfifo\0f\t5\tnaïve.py\0" });
  const r = await b.listDir!("learner-a", "proj");
  assert.deepEqual(child.calls.at(-1)!.args, ["exec", "-u", "1001", containerName("learner-a"),
    "find", "-P", "/home/learner/proj", "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\\t%s\\t%f\\0"]);
  assert.deepEqual(r!.entries, [
    { name: "my dir", type: "dir", size: 4096 }, { name: "a\tb.py", type: "file", size: 12 },
    { name: "line\nbreak", type: "file", size: 3 }, { name: "link", type: "link", size: 7 },
    { name: "fifo", type: "other", size: 0 }, { name: "naïve.py", type: "file", size: 5 }]);
  assert.equal(r!.truncated, false);
});

test("home lists /home/learner itself", async () => {
  child.next({ code: 0, stdout: "" });
  await b.listDir!("learner-a", "");
  assert.ok(child.calls.at(-1)!.args.includes("/home/learner"));
});

test("a missing or non-directory path is null, not an error", async () => {
  child.next({ code: 1, stdout: "", stderr: "find: '/home/learner/gone': No such file or directory" });
  assert.equal(await b.listDir!("learner-a", "gone"), null);
});

test("output past 200 records or 64 KiB is truncated and the process is killed", async () => {
  child.next({ code: 0, stdout: Array.from({ length: 300 }, (_, i) => `f\t1\tn${i}\0`).join("") });
  const r = await b.listDir!("learner-a", "");
  assert.equal(r!.entries.length, 200);
  assert.equal(r!.truncated, true);
  child.next({ code: null, stdout: "f\t1\t" + "x".repeat(70 * 1024) });
  assert.equal((await b.listDir!("learner-a", ""))!.truncated, true);
  assert.equal(child.calls.at(-1)!.killed, true);
});

test("both methods throw SandboxNotRunningError and never start a container", async () => {
  await assert.rejects(b.writeFile!("learner-z", "solution.py", "x"), SandboxNotRunningError); // not in live
  inspectState = "false";
  await assert.rejects(b.listDir!("learner-a", ""), SandboxNotRunningError); // live but stopped
  assert.equal(cmds.filter((c) => c.startsWith("run ") || c.startsWith("start ")).length, 1, "only the initial openShell started a container");
});
