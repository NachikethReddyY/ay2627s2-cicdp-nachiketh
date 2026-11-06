import { test } from "node:test";
import assert from "node:assert/strict";
import { RunInShellError, runInShell, runTarget } from "./runInShell.ts";
import { ShellNotReadyError } from "./shellSocket.ts";
import { putFile } from "../runPython.ts";

const harness = (over: Partial<Parameters<typeof runInShell>[0]> = {}) => {
  const log: string[] = [];
  const o = {
    language: "python" as const,
    code: "print(1)",
    panel: { open: () => void log.push("open") },
    socket: {
      whenReady: async (ms: number) => void log.push(`ready:${ms}`),
      send: (d: string) => (log.push(`send:${JSON.stringify(d)}`), true),
    },
    putFile: async (n: string, c: string) => void log.push(`put:${n}:${c}`),
    refreshTree: () => void log.push("tree"),
    sleep: async (ms: number) => void log.push(`sleep:${ms}`),
    ...over,
  };
  return { o, log };
};

test("open, ready, PUT, Ctrl-C, settle, command, refresh, in that order", async () => {
  const { o, log } = harness();
  await runInShell(o);
  assert.deepEqual(log, [
    "open",
    "ready:15000",
    "put:solution.py:print(1)",
    'send:"\\u0003"',
    "sleep:100",
    'send:"cd ~ && python3 solution.py\\r"',
    "tree",
  ]);
});

test("file name and command per language", () => {
  assert.deepEqual(runTarget("python"), { file: "solution.py", command: "cd ~ && python3 solution.py\r" });
  assert.deepEqual(runTarget("javascript"), { file: "solution.js", command: "cd ~ && node solution.js\r" });
});

test("a failed PUT types nothing", async () => {
  const { o, log } = harness({
    putFile: async () => {
      throw new Error("Open the terminal first");
    },
  });
  await assert.rejects(
    runInShell(o),
    (e: RunInShellError) =>
      e.kind === "copy" && /Could not copy your code to the sandbox: Open the terminal first/.test(e.message),
  );
  assert.ok(!log.some((l) => l.startsWith("send:")));
});

test("a sandbox that is not ready in 15 s, or is off, types nothing and writes nothing", async () => {
  // Review Focus 2
  for (const [why, kind] of [
    ["timeout", "starting"],
    ["disabled", "disabled"],
    ["exited", "unavailable"],
  ] as const) {
    const { o, log } = harness({
      socket: {
        whenReady: async () => {
          throw new ShellNotReadyError(why);
        },
        send: () => (log.push("send"), true),
      },
    });
    await assert.rejects(runInShell(o), (e: RunInShellError) => e.kind === kind);
    assert.ok(!log.some((l) => l.startsWith("put:") || l === "send"));
  }
});

test("a socket that drops during the PUT or the pause fails the Run and types nothing more", async () => {
  for (const dropAt of ["put", "pause"] as const) {
    let open = true;
    const { o, log } = harness({
      putFile: async () => {
        if (dropAt === "put") open = false;
      },
      sleep: async () => {
        if (dropAt === "pause") open = false;
      },
    });
    o.socket.send = (d: string) => {
      if (!open) return false;
      log.push(`send:${JSON.stringify(d)}`);
      return true;
    };
    await assert.rejects(runInShell(o), (e: RunInShellError) => e.kind === "unavailable");
    assert.ok(!log.includes('send:"cd ~ && python3 solution.py\\r"'));
    assert.ok(!log.includes("tree"));
  }
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
