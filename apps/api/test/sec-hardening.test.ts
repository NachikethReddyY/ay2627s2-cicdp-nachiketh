// Startup and request-id hardening, plus the shell container's docker flags. Needs the test database only for buildApp.
import "./helpers.ts"; // points DATABASE_URL at the test database before env.ts loads
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildApp } from "../src/app.ts";
import { parseEnv, startupWarnings } from "../src/env.ts";
import { dockerBackend, ensureNetwork, shellRunArgs } from "../src/sandbox/docker.ts";
import { SandboxBusyError } from "../src/sandbox/backend.ts";

const base = { DATABASE_URL: "postgres://x:x@localhost:5432/x", BETTER_AUTH_SECRET: "x".repeat(32) };
const prodAi = { ...base, NODE_ENV: "production", ANTHROPIC_API_KEY: "sk-test" };
const messages = (r: ReturnType<typeof parseEnv>) => (r.success ? [] : r.error.issues.map((i) => i.message));

test("production with AI on refuses to start without a spend cap", () => {
  const r = parseEnv(prodAi);
  assert.equal(r.success, false);
  assert.match(messages(r).join(), /AI_DAILY_BUDGET_USD.*AI_MONTHLY_BUDGET_USD.*AI_BUDGET_UNLIMITED=true/);
  assert.equal(parseEnv({ ...prodAi, ENGINE_TOKEN: "t".repeat(32), ANTHROPIC_API_KEY: undefined }).success, false, "the engine path counts as AI");
});

test("a budget, an explicit opt-out, AI off, or a non-production env all start", () => {
  assert.equal(parseEnv({ ...prodAi, AI_DAILY_BUDGET_USD: "5" }).success, true);
  assert.equal(parseEnv({ ...prodAi, AI_MONTHLY_BUDGET_USD: "50" }).success, true);
  assert.equal(parseEnv({ ...prodAi, AI_BUDGET_UNLIMITED: "true" }).success, true);
  assert.equal(parseEnv({ ...base, NODE_ENV: "production" }).success, true);
  assert.equal(parseEnv({ ...prodAi, NODE_ENV: "test" }).success, true);
});

test("production warns when TRUSTED_PROXY is unset", () => {
  assert.match(startupWarnings({ NODE_ENV: "production", TRUSTED_PROXY: undefined }).join(), /TRUSTED_PROXY is unset/);
  assert.deepEqual(startupWarnings({ NODE_ENV: "production", TRUSTED_PROXY: "10.0.0.0/8" }), []);
  assert.deepEqual(startupWarnings({ NODE_ENV: "development", TRUSTED_PROXY: undefined }), []);
});

test("shell containers join the sandbox network, with the runtime only when set", () => {
  const args = shellRunArgs("lq-sbx-x", { image: "img", network: "lq-sbx" });
  assert.equal(args[args.indexOf("--network") + 1], "lq-sbx");
  assert.equal(args.includes("--runtime"), false);
  for (const f of ["--read-only", "--cap-drop", "no-new-privileges", "--pids-limit"]) assert.ok(args.includes(f), f);
  const gv = shellRunArgs("lq-sbx-x", { image: "img", network: "n", runtime: "runsc" });
  assert.equal(gv[gv.indexOf("--runtime") + 1], "runsc");
  assert.ok(gv.indexOf("--runtime") < gv.indexOf("img"), "flags come before the image");
});

test("the sandbox network is created on demand, and a concurrent create is not an error", async () => {
  const calls: string[][] = [];
  const fake = (inspect: boolean, create: "ok" | "exists" | "fail") => async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[1] === "inspect") return inspect ? { stdout: "[]" } : Promise.reject(new Error("No such network"));
    if (create === "ok") return { stdout: "id" };
    const err = Object.assign(new Error("Command failed"), { stderr: create === "exists" ? "Error response from daemon: network with name lq-sbx already exists" : "permission denied" });
    throw err;
  };
  await ensureNetwork("lq-sbx", fake(true, "fail"));
  assert.equal(calls.length, 1, "an existing network is left alone");
  calls.length = 0;
  await ensureNetwork("lq-sbx", fake(false, "ok"));
  assert.deepEqual(calls[1], ["network", "create", "--driver", "bridge", "-o", "com.docker.network.bridge.enable_icc=false", "lq-sbx"]);
  await ensureNetwork("lq-sbx", fake(false, "exists"));
  await assert.rejects(ensureNetwork("lq-sbx", fake(false, "fail")), /Command failed/);
});

test("a closed terminal's idle container still counts against the server-wide shell cap", async () => {
  const cmds: string[] = [];
  let stopped!: () => void;
  const stop = new Promise<void>((r) => (stopped = r));
  // No container exists yet (inspect fails), the network exists, and every other docker call succeeds.
  const exec = async (_cmd: string, args: string[]) => {
    cmds.push(args.join(" "));
    if (args[0] === "inspect") throw new Error("no such container");
    if (args[0] === "stop") stopped();
    return { stdout: "" };
  };
  const spawn = (() => {
    const exits: ((e: { exitCode: number }) => void)[] = [];
    return { write() {}, resize() {}, kill: () => exits.forEach((cb) => cb({ exitCode: 0 })), onData() {}, onExit: (cb: (e: { exitCode: number }) => void) => exits.push(cb) };
  }) as never;
  const backend = dockerBackend({ image: "img", idleMs: 30, network: "lq-sbx", exec, spawn, maxContainers: () => 1 });

  const a = await backend.openShell("learner-a", { cols: 80, rows: 24 });
  a.kill(); // the terminal closes, but its container stays up until the idle stop
  await assert.rejects(backend.openShell("learner-b", { cols: 80, rows: 24 }), SandboxBusyError);
  // learner-a reconnecting reuses its own container, so it is never refused.
  (await backend.openShell("learner-a", { cols: 80, rows: 24 })).kill();

  await stop; // the idle stop frees the slot
  await new Promise((r) => setTimeout(r, 10));
  (await backend.openShell("learner-b", { cols: 80, rows: 24 })).kill();
  assert.ok(cmds.some((c) => c.startsWith("stop")));
});

test("the server exits cleanly on SIGTERM", { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, ["src/server.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NODE_ENV: "development", PORT: String(40_000 + Math.floor(Math.random() * 20_000)), DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise<void>((res, rej) => {
    child.stdout!.on("data", (d) => {
      out += d;
      if (out.includes("Server listening")) res();
    });
    child.stderr!.on("data", (d) => (out += d));
    child.on("exit", () => rej(new Error(`exited early: ${out}`)));
  });
  child.kill("SIGTERM");
  const code = await new Promise<number | null>((res) => child.on("exit", (c) => res(c)));
  assert.equal(code, 0, out);
  assert.match(out, /SIGTERM: shutting down/);
});

// Last: closing the app ends the shared pool.
test("a client x-request-id is kept only when it is a short plain token", async () => {
  const app = buildApp();
  app.get("/rid", async (req) => ({ id: req.id }));
  try {
    const id = async (v?: string) =>
      (await app.inject({ method: "GET", url: "/rid", headers: v === undefined ? {} : { "x-request-id": v } })).json().id as string;
    assert.equal(await id("abc-123_XYZ"), "abc-123_XYZ");
    const uuid = /^[0-9a-f-]{36}$/;
    for (const bad of ["a b", "x".repeat(65), "a\nlevel=error", "", "ä"]) assert.match(await id(bad), uuid, JSON.stringify(bad));
    assert.match(await id(), uuid);
  } finally {
    await app.close();
  }
});
