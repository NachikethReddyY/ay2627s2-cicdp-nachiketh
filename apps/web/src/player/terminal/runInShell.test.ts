import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CTRL_C,
  FINISH_TIMEOUT_MS,
  PROMPT_WAIT_MS,
  RunInShellError,
  STILL_RUNNING,
  runInShell,
  runTarget,
  watchMarker,
} from "./runInShell.ts";
import type { ShellState } from "./shellSocket.ts";
import { putFile } from "../runPython.ts";
import { createRunQueue } from "../live/runQueue.ts";
import { practiceActions } from "../live/practiceActions.ts";
import type { PracticeLanguage } from "../live/checkModel.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const neverExpires = () => new AbortController().signal;

function fakeShell({ ready = true, interruptAck = true, dropAfterInterrupt = false, log = [] as string[] } = {}) {
  const encoder = new TextEncoder();
  const outputs = new Set<(bytes: Uint8Array) => void>();
  const states = new Set<(state: ShellState) => void>();
  const files = new Map<string, string>();
  let screen = "";
  let open = true;
  let dropNext = false;
  let running: { source: string; rest: string[]; hangs: boolean; token: string } | null = null;
  const emit = (text: string) => {
    screen += text;
    for (const cb of [...outputs]) cb(encoder.encode(text));
  };
  const complete = (status: number) => {
    if (!running) return;
    const { token, source } = running;
    running = null;
    log.push(`exit ${source}`);
    emit(`\u001eLQ_RUN_${token}:${status}\u001f\n`);
  };
  const step = () => {
    const program = running;
    if (!program) return;
    if (program.rest.length) {
      emit(`${program.rest.shift()}\r\n`);
      setImmediate(step);
      return;
    }
    if (program.hangs) return;
    complete(0);
  };
  const socket = {
    whenReady: async (ms: number) => void log.push(`ready:${ms}`),
    send: (data: string) => {
      if (!open) return false;
      if (data === CTRL_C) {
        dropNext = dropAfterInterrupt;
        log.push(running ? `ctrl-c stops ${running.source}` : "ctrl-c");
        if (running) {
          emit("^C");
          if (interruptAck) complete(130);
        }
        return true;
      }
      if (dropNext) { data = data.slice(1); dropNext = false; }
      const readyToken = /LQ_READY_([a-f0-9]+)/.exec(data)?.[1];
      if (readyToken) {
        log.push("ready-probe");
        if (ready && data.replace(/^\r/, "").startsWith("printf ")) emit(`\u001eLQ_READY_${readyToken}\u001f\n`);
        emit(data.replace("\r", "\r\n"));
        return true;
      }
      const file = /solution\.\w+/.exec(data)?.[0] ?? "";
      const source = files.get(file) ?? "";
      const token = /LQ_RUN_([a-f0-9]+):/.exec(data)?.[1] ?? "";
      log.push(`command ${JSON.stringify(data)}`);
      emit(data.replace("\r", "\r\n"));
      if (source.includes("\u001b]777;learnquest-refresh\u0007")) emit("\u001b]777;learnquest-refresh\u0007");
      const words = source.split(" ");
      running = { source, rest: words.filter((word) => word !== "hang"), hangs: words.includes("hang"), token };
      setImmediate(step);
      return true;
    },
    onOutput: (cb: (bytes: Uint8Array) => void) => {
      outputs.add(cb);
      return () => outputs.delete(cb);
    },
    onState: (cb: (state: ShellState) => void) => {
      states.add(cb);
      return () => states.delete(cb);
    },
  };
  return {
    log,
    socket,
    screen: () => screen,
    listeners: () => outputs.size + states.size,
    completeRunning: () => complete(130),
    putFile: async (name: string, content: string) => {
      log.push(`put:${name}:${content}`);
      if (running && files.get(name) !== content) log.push(`overwritten while ${running.source} ran`);
      files.set(name, content);
    },
    drop: () => {
      open = false;
      for (const cb of [...states]) cb({ kind: "reconnecting", attempt: 1, inMs: 1000 });
    },
  };
}

const harness = (shell = fakeShell(), over: Partial<Parameters<typeof runInShell>[0]> = {}) => ({
  language: "python" as const,
  code: "1",
  panel: { open: () => void shell.log.push("open") },
  socket: shell.socket,
  putFile: shell.putFile,
  refreshTree: () => void shell.log.push("tree"),
  deadline: neverExpires,
  ...over,
});

const command = /cd ~ && python3 solution\.py/;

test("a run waits for a fresh shell acknowledgement before copying, then finishes after the shell wrapper", async () => {
  const shell = fakeShell();
  const end = await runInShell(harness(shell, { code: "a1 a2" }));
  assert.equal(end, "finished");
  assert.deepEqual(shell.log.slice(0, 5), ["open", "ready:15000", "ctrl-c", "ready-probe", "put:solution.py:a1 a2"]);
  assert.match(shell.log[5], command);
  assert.deepEqual(shell.log.slice(6), ["tree", "exit a1 a2"]);
  assert.equal(shell.listeners(), 0);
});

test("a shell that drops the first byte after Ctrl+C still receives the readiness command", async () => {
  const shell = fakeShell({ dropAfterInterrupt: true });
  assert.equal(await runInShell(harness(shell)), "finished");
  assert.ok(shell.log.includes("put:solution.py:1"));
});

test("the wrapper acknowledges completion in both supported shell languages", () => {
  assert.deepEqual(runTarget("python"), { file: "solution.py", command: "cd ~ && python3 solution.py" });
  assert.deepEqual(runTarget("javascript"), { file: "solution.js", command: "cd ~ && node solution.js" });
});

test("queued runs do not overwrite shared code until the earlier wrapped process exits", async () => {
  const shell = fakeShell();
  const run = createRunQueue(async (code: string) => void (await runInShell(harness(shell, { code }))));
  await Promise.all([run("a1 a2 a3"), run("b1 b2")]);
  assert.equal(shell.log.includes("overwritten while a1 a2 a3 ran"), false);
  assert.ok(shell.log.indexOf("exit a1 a2 a3") < shell.log.indexOf("put:solution.py:b1 b2"));
  assert.match(shell.screen(), /a1\r\na2\r\na3\r\n[\s\S]*b1\r\nb2\r\n/);
});

test("the unique acknowledgement ignores a program that prints the legacy OSC prompt marker", async () => {
  const shell = fakeShell();
  const staticMarker = "\u001b]777;learnquest-refresh\u0007";
  const end = await runInShell(harness(shell, { code: `${staticMarker} output` }));
  assert.equal(end, "finished");
  assert.ok(shell.log.includes("exit \u001b]777;learnquest-refresh\u0007 output"));
});

test("a timed out run sends Ctrl+C and keeps the queue until the shell confirms process completion", async () => {
  assert.equal(FINISH_TIMEOUT_MS, 60_000);
  assert.match(STILL_RUNNING, /Ctrl\+C was sent/);
  const shell = fakeShell({ interruptAck: false });
  const finishes: AbortController[] = [];
  const deadline = (ms: number) => {
    if (ms !== FINISH_TIMEOUT_MS) return neverExpires();
    const controller = new AbortController();
    finishes.push(controller);
    return controller.signal;
  };
  const ends: string[] = [];
  let timeouts = 0;
  const run = createRunQueue(async (code: string) => void ends.push(await runInShell(harness(shell, { code, deadline, onTimeout: () => { timeouts++; } }))));
  const first = run("a1 hang");
  const second = run("b1");
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(!shell.log.includes("put:solution.py:b1"));
  finishes[0].abort();
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(shell.log.includes("ctrl-c stops a1 hang"));
  assert.ok(!shell.log.includes("put:solution.py:b1"), "Ctrl+C does not release the queue without a shell acknowledgement");
  shell.completeRunning();
  await Promise.all([first, second]);
  assert.deepEqual(ends, ["timeout", "finished"]);
  assert.equal(timeouts, 1);
  assert.ok(shell.log.indexOf("ctrl-c stops a1 hang") < shell.log.indexOf("put:solution.py:b1"));
});

test("a Bash-style shell without prompt hooks still finishes promptly", async () => {
  const shell = fakeShell();
  assert.equal(await runInShell(harness(shell)), "finished");
  assert.ok(shell.log.includes("ready-probe"));
  assert.ok(shell.log.some((line) => command.test(line)));
});

test("a marker split across output chunks is recognized once", async () => {
  const outputs: ((bytes: Uint8Array) => void)[] = [];
  const prompts = watchMarker({ onOutput: (cb) => (outputs.push(cb), () => true), onState: () => () => true });
  const marker = "\u001eLQ_RUN_unique-token:0\u001f";
  const bytes = new TextEncoder().encode(`done\r\n${marker}`);
  const first = prompts.next(neverExpires(), marker);
  outputs[0](bytes.slice(0, 10));
  await tick();
  let firstEnded = false;
  void first.then(() => { firstEnded = true; });
  await tick();
  assert.equal(firstEnded, false);
  outputs[0](bytes.slice(10));
  assert.equal(await first, "matched");
  const expired = new AbortController();
  expired.abort();
  assert.equal(await prompts.next(expired.signal, marker), "timeout");
  prompts.stop();
});

test("an already expired deadline ends the wait at once", async () => {
  const expired = new AbortController();
  expired.abort();
  const prompts = watchMarker({ onOutput: () => () => true, onState: () => () => true });
  assert.equal(await prompts.next(expired.signal, "marker"), "timeout");
});

test("a failed PUT does not send the run command", async () => {
  const shell = fakeShell();
  await assert.rejects(
    runInShell(harness(shell, { putFile: async () => { throw new Error("Open the terminal first"); } })),
    (error: RunInShellError) => error.kind === "copy" && /Could not copy your code/.test(error.message),
  );
  assert.ok(!shell.log.some((line) => command.test(line)));
});

test("the shell must acknowledge readiness before any shared file is copied", async () => {
  const shell = fakeShell({ ready: false });
  const deadlines = new Map<number, AbortController>([[PROMPT_WAIT_MS, new AbortController()]]);
  deadlines.get(PROMPT_WAIT_MS)?.abort();
  await assert.rejects(
    runInShell(harness(shell, { deadline: (ms) => deadlines.get(ms)?.signal ?? neverExpires() })),
    (error: RunInShellError) => error.kind === "unavailable",
  );
  assert.ok(!shell.log.some((line) => line.startsWith("put:")));
  assert.ok(!shell.log.some((line) => command.test(line)));
});

test("a dropped socket while the process runs rejects and removes marker listeners", async () => {
  const shell = fakeShell();
  const running = runInShell(harness(shell, { code: "a1 hang" }));
  for (let i = 0; i < 5; i++) await tick();
  shell.drop();
  await assert.rejects(running, (error: RunInShellError) => error.kind === "unavailable");
  assert.equal(shell.listeners(), 0);
});

test("authored scrim JavaScript and Python use the shell so output remains in terminal history", () => {
  for (const language of ["python", "javascript"] as const) {
    assert.equal(practiceActions({ language, code: "c", lessonId: "l", sandboxEnabled: true, authored: true }).run.via, "shell");
  }
  assert.equal(practiceActions({ language: "typescript", code: "c", lessonId: "l", sandboxEnabled: true, authored: true }).run.via, "oneshot");
  const language: PracticeLanguage = "python";
  assert.equal(practiceActions({ language, code: "c", lessonId: "l", sandboxEnabled: true, authored: false }).run.via, "shell");
});

test("Run never sends a lessonId", async () => {
  const bodies: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await putFile("solution.py", "print(1)");
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(bodies.map((body) => JSON.parse(body)), [{ content: "print(1)" }]);
});
