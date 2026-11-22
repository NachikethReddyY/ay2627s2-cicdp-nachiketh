import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CTRL_C,
  FINISH_TIMEOUT_MS,
  PROMPT_MARKER,
  PROMPT_WAIT_MS,
  RunInShellError,
  STILL_RUNNING,
  runInShell,
  runTarget,
  watchPrompts,
} from "./runInShell.ts";
import { ShellNotReadyError, type ShellState } from "./shellSocket.ts";
import { putFile } from "../runPython.ts";
import { createRunGate, createRunQueue } from "../live/runQueue.ts";
import { practiceActions } from "../live/practiceActions.ts";
import type { PracticeLanguage } from "../live/checkModel.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const neverExpires = () => new AbortController().signal;

function fakeShell({ prompts = true, log = [] as string[] } = {}) {
  const encoder = new TextEncoder();
  const outputs = new Set<(bytes: Uint8Array) => void>();
  const states = new Set<(state: ShellState) => void>();
  const files = new Map<string, string>();
  let screen = "";
  let open = true;
  let running: { file: string; source: string; rest: string[]; hangs: boolean } | null = null;
  const emit = (text: string) => {
    screen += text;
    for (const cb of [...outputs]) cb(encoder.encode(text));
  };
  const prompt = () => emit(prompts ? `\r\n${PROMPT_MARKER}~ $ ` : "\r\n~ $ ");
  const step = () => {
    const program = running;
    if (!program) return;
    if (files.get(program.file) !== program.source) log.push(`overwritten while ${program.source} ran`);
    const line = program.rest.shift();
    if (line !== undefined) {
      emit(`${line}\r\n`);
      setImmediate(step);
      return;
    }
    if (program.hangs) return;
    running = null;
    log.push(`exit ${program.source}`);
    prompt();
  };
  const socket = {
    whenReady: async (ms: number) => void log.push(`ready:${ms}`),
    send: (data: string) => {
      if (!open) return false;
      if (data === CTRL_C) {
        log.push(running ? `ctrl-c stops ${running.source}` : "ctrl-c");
        if (running) emit("^C");
        running = null;
        setImmediate(prompt);
        return true;
      }
      const file = /solution\.\w+/.exec(data)?.[0] ?? "";
      const source = files.get(file) ?? "";
      log.push(`command ${JSON.stringify(data)}`);
      emit(data.replace("\r", "\r\n"));
      const words = source.split(" ");
      running = { file, source, rest: words.filter((w) => w !== "hang"), hangs: words.includes("hang") };
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
    putFile: async (name: string, content: string) => {
      log.push(`put:${name}:${content}`);
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

const command = 'command "cd ~ && python3 solution.py\\r"';

test("open, ready, PUT, Ctrl-C, wait for the prompt, command, refresh, then finish on the next prompt", async () => {
  const shell = fakeShell();
  const end = await runInShell(harness(shell, { code: "a1 a2" }));
  assert.equal(end, "finished");
  assert.deepEqual(shell.log, ["open", "ready:15000", "put:solution.py:a1 a2", "ctrl-c", command, "tree", "exit a1 a2"]);
  assert.equal(shell.listeners(), 0, "the run stops watching the shell once it ends");
});

test("file name and command per language", () => {
  assert.deepEqual(runTarget("python"), { file: "solution.py", command: "cd ~ && python3 solution.py\r" });
  assert.deepEqual(runTarget("javascript"), { file: "solution.js", command: "cd ~ && node solution.js\r" });
});

test("queued shell runs write and press Ctrl-C only after the previous program prints everything and exits", async () => {
  const shell = fakeShell();
  const run = createRunQueue(async (code: string) => void (await runInShell(harness(shell, { code }))));
  await Promise.all([run("a1 a2 a3"), run("b1 b2")]);
  const steps = shell.log.filter((l) => !["open", "ready:15000", "tree"].includes(l));
  assert.deepEqual(steps, [
    "put:solution.py:a1 a2 a3", "ctrl-c", command, "exit a1 a2 a3",
    "put:solution.py:b1 b2", "ctrl-c", command, "exit b1 b2",
  ]);
  assert.match(shell.screen(), /a1\r\na2\r\na3\r\n[\s\S]*b1\r\nb2\r\n/);
  assert.doesNotMatch(shell.screen(), /\^C/);
});

test("the fake shell catches the overlap when two runs are not queued", async () => {
  const shell = fakeShell();
  await Promise.all([runInShell(harness(shell, { code: "a1 a2 a3" })), runInShell(harness(shell, { code: "b1 b2" }))]);
  assert.equal(shell.log.includes("exit a1 a2 a3"), false, "the first program never ran its own code to the end");
});

test("a run that never finishes frees the queue after 60 seconds, and the next run stops it first", async () => {
  assert.equal(FINISH_TIMEOUT_MS, 60_000);
  assert.match(STILL_RUNNING, /still running after 60 seconds/);
  const shell = fakeShell();
  const finishes: AbortController[] = [];
  const deadline = (ms: number) => {
    if (ms !== FINISH_TIMEOUT_MS) return neverExpires();
    const c = new AbortController();
    finishes.push(c);
    return c.signal;
  };
  const ends: string[] = [];
  const run = createRunQueue(async (code: string) => void ends.push(await runInShell(harness(shell, { code, deadline }))));
  const first = run("a1 hang");
  const second = run("b1");
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(!shell.log.includes("put:solution.py:b1"), "the next run waits while the program is still running");
  finishes[0].abort();
  await Promise.all([first, second]);
  assert.deepEqual(ends, ["timeout", "finished"]);
  const afterTimeout = shell.log.slice(shell.log.indexOf("put:solution.py:b1"));
  assert.deepEqual(afterTimeout.filter((l) => l !== "tree"), ["put:solution.py:b1", "ctrl-c stops a1 hang", command, "exit b1"]);
});

test("a shell that never prints the prompt marker still runs, after the prompt wait, and ends on the timeout", async () => {
  const shell = fakeShell({ prompts: false });
  const waits = new Map<number, AbortController>([[PROMPT_WAIT_MS, new AbortController()], [FINISH_TIMEOUT_MS, new AbortController()]]);
  const running = runInShell(harness(shell, { deadline: (ms) => waits.get(ms)?.signal ?? neverExpires() }));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(!shell.log.includes(command), "the command waits for the prompt after Ctrl-C");
  waits.get(PROMPT_WAIT_MS)?.abort();
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(shell.log.includes(command));
  waits.get(FINISH_TIMEOUT_MS)?.abort();
  assert.equal(await running, "timeout");
});

test("the prompt marker counts once even when it arrives split across output chunks", async () => {
  const outputs: ((bytes: Uint8Array) => void)[] = [];
  const prompts = watchPrompts({ onOutput: (cb) => (outputs.push(cb), () => true), onState: () => () => true });
  const bytes = new TextEncoder().encode(`done\r\n${PROMPT_MARKER}~ $ `);
  const at = 6 + 3;
  const first = prompts.next(neverExpires());
  outputs[0](bytes.slice(0, at));
  await tick();
  let firstEnded = false;
  void first.then(() => { firstEnded = true; });
  await tick();
  assert.equal(firstEnded, false, "half a marker is not a prompt");
  outputs[0](bytes.slice(at));
  assert.equal(await first, "finished");
  const second = prompts.next(neverExpires());
  outputs[0](new TextEncoder().encode("more output"));
  let secondEnded = false;
  void second.then(() => { secondEnded = true; });
  await tick();
  assert.equal(secondEnded, false, "the old marker is not counted again");
  prompts.stop();
});

test("a deadline that has already passed ends the wait at once", async () => {
  const expired = new AbortController();
  expired.abort();
  const prompts = watchPrompts({ onOutput: () => () => true, onState: () => () => true });
  assert.equal(await prompts.next(expired.signal), "timeout");
});

test("a failed PUT types nothing", async () => {
  const shell = fakeShell();
  const failing = harness(shell, {
    putFile: async () => {
      throw new Error("Open the terminal first");
    },
  });
  await assert.rejects(
    runInShell(failing),
    (e: RunInShellError) =>
      e.kind === "copy" && /Could not copy your code to the sandbox: Open the terminal first/.test(e.message),
  );
  assert.ok(!shell.log.some((l) => l.startsWith("ctrl-c") || l.startsWith("command")));
});

test("a sandbox that is not ready in 15 s, or is off, types nothing and writes nothing", async () => {
  for (const [why, kind] of [
    ["timeout", "starting"],
    ["disabled", "disabled"],
    ["exited", "unavailable"],
  ] as const) {
    const shell = fakeShell();
    shell.socket.whenReady = async () => {
      throw new ShellNotReadyError(why);
    };
    await assert.rejects(runInShell(harness(shell)), (e: RunInShellError) => e.kind === kind);
    assert.ok(!shell.log.some((l) => l.startsWith("put:") || l.startsWith("ctrl-c") || l.startsWith("command")));
  }
});

test("a socket that drops during the PUT or while waiting for the prompt fails the Run and types nothing more", async () => {
  for (const dropAt of ["put", "prompt"] as const) {
    const shell = fakeShell({ prompts: dropAt !== "prompt" });
    const running = runInShell(harness(shell, {
      putFile: async (name, content) => {
        await shell.putFile(name, content);
        if (dropAt === "put") shell.drop();
      },
    }));
    if (dropAt === "prompt") {
      await tick();
      shell.drop();
    }
    await assert.rejects(running, (e: RunInShellError) => e.kind === "unavailable");
    assert.ok(!shell.log.includes(command));
    assert.ok(!shell.log.includes("tree"));
  }
});

test("a socket that drops while the program runs fails the Run instead of waiting out the timeout", async () => {
  const shell = fakeShell();
  const running = runInShell(harness(shell, { code: "a1 hang" }));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(shell.log.includes(command));
  shell.drop();
  await assert.rejects(running, (e: RunInShellError) => e.kind === "unavailable" && /before your program finished/.test(e.message));
  assert.equal(shell.listeners(), 0);
});

test("scrim runs take the one-shot path in every language, and a manual Run in the shell waits behind them", async () => {
  for (const language of ["python", "javascript", "typescript"] as const) {
    assert.equal(practiceActions({ language, code: "c", lessonId: "l", sandboxEnabled: true, authored: true }).run.via, "oneshot");
  }
  const shell = fakeShell();
  const gate = createRunGate();
  const order: string[] = [];
  const language: PracticeLanguage = "python";
  const run = createRunQueue(async ({ code, authored }: { code: string; authored: boolean }) => {
    const action = practiceActions({ language, code, lessonId: "l", sandboxEnabled: true, authored }).run;
    if (action.via === "oneshot") {
      order.push(`one-shot start ${code}`);
      await gate.wait();
      order.push(`one-shot end ${code}`);
      return;
    }
    order.push(`shell start ${code}`);
    await runInShell(harness(shell, { code }));
    order.push(`shell end ${code}`);
  });
  const authored = run({ code: "a1", authored: true });
  const manual = run({ code: "m1 m2", authored: false });
  const later = run({ code: "a2", authored: true });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(order, ["one-shot start a1"]);
  assert.ok(!shell.log.some((l) => l.startsWith("put:") || l.startsWith("ctrl-c")), "the manual Run has not touched the shell yet");
  gate.release();
  await authored;
  await manual;
  for (let i = 0; i < 5; i++) await tick();
  gate.release();
  await later;
  assert.deepEqual(order, ["one-shot start a1", "one-shot end a1", "shell start m1 m2", "shell end m1 m2", "one-shot start a2", "one-shot end a2"]);
  assert.ok(shell.log.includes("exit m1 m2"));
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
  assert.deepEqual(bodies.map((b) => JSON.parse(b)), [{ content: "print(1)" }]);
});
