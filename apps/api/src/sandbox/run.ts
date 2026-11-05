import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { practiceCheck, type PracticeCheck } from "../parts/practice.ts";

// Live Python runs for practice lessons. Each run is a fresh, locked-down container, removed when the program ends or is stopped.
export const MAX_CODE = 4000;
const MAX_OUT = 8000;
const MAX_LINE = 200;
const LIMIT_S = 60; // wall-clock limit, long enough for a learner to type answers
const MAX_ACTIVE = 2; // live runs per learner
let rmTimeoutMs = 10_000; // bound on `docker rm -f`
/** Tests shorten the bound instead of waiting on it. */
export function setRmTimeoutForTests(ms: number): void {
  rmTimeoutMs = ms;
}
const KEEP_S = 60; // a finished run stays readable this long

type Spawn = typeof nodeSpawn;
type Run = {
  id: string;
  learner: string;
  child: ReturnType<Spawn>;
  spawn: Spawn;
  out: string;
  done: boolean;
  stopping: boolean;
  saving: boolean; // a checked run's completion is being saved; the program has already exited
  overflow: boolean; // stdout went past MAX_OUT and the rest was dropped
  error?: string;
  timer: NodeJS.Timeout;
  check?: PracticeCheck; // set for a Check run of a practice lesson
  passed?: boolean; // true once a checked run matched and its completion was saved
};
const runs = new Map<string, Run>();
const STOPPED = `Stopped: the code ran longer than ${LIMIT_S} seconds.`;

function finish(run: Run, error?: string) {
  if (run.done) return;
  run.done = true;
  run.error = error;
  clearTimeout(run.timer);
  setTimeout(() => runs.delete(run.id), KEEP_S * 1000).unref();
}

// Killing the local `docker run` client leaves the container running, so stopping removes it by name.
const containerName = (id: string) => `lq-run-${id}`;

/** Removes the run's container, then ends the run, so the learner's slot is freed only once it is gone. */
function terminate(run: Run, error?: string) {
  // A run that is saving its completion already exited cleanly; stopping it now must not change its verdict.
  if (run.stopping || run.saving) return;
  run.stopping = true;
  run.child.kill("SIGKILL");
  const rm = run.spawn("docker", ["rm", "-f", containerName(run.id)], { stdio: "ignore" });
  const end = () => finish(run, error);
  // A hung docker CLI would never close; give up after RM_TIMEOUT_MS so the slot is not held forever.
  const giveUp = setTimeout(() => { rm.kill("SIGKILL"); end(); }, rmTimeoutMs);
  giveUp.unref();
  const done = () => { clearTimeout(giveUp); end(); };
  rm.on("close", done);
  rm.on("error", done);
}

export type Language = "python" | "javascript";
const INTERPRETER: Record<Language, string[]> = {
  python: ["python3", "-I", "-u", "-c"],
  javascript: ["node", "-e"],
};

/**
 * Starts a program and returns its run id, or null when the learner already has too many live runs.
 * With `check`, a clean exit whose output matches is saved as the lesson's completion before the run ends.
 */
export function startRun(code: string, learner: string, language: Language, spawn: Spawn = nodeSpawn, check?: PracticeCheck): string | null {
  let active = 0;
  for (const r of runs.values()) if (r.learner === learner && !r.done) active++;
  if (active >= MAX_ACTIVE) return null;
  const id = randomUUID();
  const args = [
    "run", "--rm", "-i", "--name", containerName(id), "--network", "none",
    "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,exec,size=16m", "--user", "1001:1001",
    env.SANDBOX_IMAGE, "timeout", "-s", "KILL", String(LIMIT_S), ...INTERPRETER[language], code,
  ];
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  // Backstop in case the container hangs past the program's own limit.
  const run: Run = { id, learner, child, spawn, out: "", done: false, stopping: false, saving: false, overflow: false, timer: setTimeout(() => terminate(run, STOPPED), (LIMIT_S + 5) * 1000), check };
  runs.set(id, run);
  let err = "";
  child.stdout?.on("data", (d: Buffer) => {
    if (run.out.length < MAX_OUT) run.out += d.toString();
    else run.overflow = true;
  });
  child.stderr?.on("data", (d: Buffer) => { if (err.length < MAX_OUT) err += d.toString(); });
  child.stdin?.on("error", () => {}); // the program may exit before a late answer arrives
  child.on("error", () => finish(run, "Could not run the code"));
  child.on("close", (exit) => {
    if (run.stopping) return; // the container's removal ends the run
    if (exit === 0 && run.check) void judge(run, run.check);
    else if (exit === 0) finish(run);
    else if (exit === 124 || exit === 137) finish(run, STOPPED);
    else finish(run, err.trim() || "The code stopped with an error.");
  });
  return id;
}

// Same rule the player used before: the program's output, without the typed answers, matches once trimmed.
async function judge(run: Run, check: PracticeCheck) {
  run.passed = false;
  // Output cut off at MAX_OUT was not seen in full, so it cannot be judged a match.
  if (run.overflow || run.out.trim() !== check.expected.trim()) return finish(run);
  run.saving = true;
  clearTimeout(run.timer); // the program has exited, so the backstop has nothing left to stop
  try {
    await check.record();
    run.passed = true;
    finish(run);
  } catch {
    finish(run, "Could not save your result. Check again.");
  }
}

const own = (id: string, learner: string) => {
  const r = runs.get(id);
  return r && r.learner === learner ? r : undefined;
};

/** Output from `from` on, so the client only ever gets new text. */
export function runStatus(id: string, learner: string, from: number) {
  const r = own(id, learner);
  if (!r) return null;
  // `passed` is only sent for a checked run, once it has ended.
  const passed = r.check && r.done ? r.passed === true && !r.error : undefined;
  return { output: r.out.slice(from), next: r.out.length, done: r.done, error: r.error, ...(passed !== undefined && { passed }) };
}

export function sendRunInput(id: string, learner: string, line: string): boolean {
  const r = own(id, learner);
  if (!r || r.done) return false;
  r.child.stdin?.write(`${line}\n`);
  return true;
}

export function stopRun(id: string, learner: string): boolean {
  const r = own(id, learner);
  if (!r) return false;
  if (!r.done) terminate(r);
  return true;
}

export async function sandboxRunRoute(app: FastifyInstance) {
  const Start = z.object({
    code: z.string().max(MAX_CODE),
    language: z.enum(["python", "javascript"]).default("python"),
    lessonId: z.string().regex(/^[\w-]{1,64}$/).optional(), // a Check run: the server judges it against this lesson
  });
  const Line = z.object({ line: z.string().max(MAX_LINE) });
  const Id = z.uuid();
  const From = z.object({ from: z.coerce.number().int().min(0).default(0) });
  const fail = (code: string, message: string) => ({ error: { code, message } });

  // Every route answers the same way for a disabled sandbox or a signed-out learner.
  const learnerFor = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!env.SANDBOX_ENABLED) { reply.status(503).send(fail("unavailable", "Sandbox is disabled")); return null; }
    const learner = await resolveLearnerId(req.headers);
    if (!learner) { reply.status(401).send(fail("unauthorized", "Sign in required")); return null; }
    return learner;
  };

  app.post("/sandbox/run", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    const body = Start.safeParse(req.body);
    if (!body.success) return reply.status(400).send(fail("bad_request", "Code is too long"));
    let check: PracticeCheck | undefined;
    if (body.data.lessonId) {
      const found = await practiceCheck(learner, body.data.lessonId);
      if (!found) return reply.status(404).send(fail("not_found", "Practice lesson not found"));
      check = found;
    }
    const id = startRun(body.data.code, learner, body.data.language, nodeSpawn, check);
    if (!id) return reply.status(429).send(fail("busy", "Finish your running programs first"));
    return { id };
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string } }>("/sandbox/run/:id", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    const id = Id.safeParse(req.params.id);
    const from = From.safeParse(req.query);
    if (!id.success || !from.success) return reply.status(400).send(fail("bad_request", "Unknown run"));
    const status = runStatus(id.data, learner, from.data.from);
    return status ?? reply.status(404).send(fail("not_found", "Unknown run"));
  });

  app.post<{ Params: { id: string } }>("/sandbox/run/:id/input", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    const id = Id.safeParse(req.params.id);
    const line = Line.safeParse(req.body);
    if (!id.success || !line.success) return reply.status(400).send(fail("bad_request", "Answer is too long"));
    return sendRunInput(id.data, learner, line.data.line) ? { ok: true } : reply.status(409).send(fail("finished", "The program has finished"));
  });

  app.delete<{ Params: { id: string } }>("/sandbox/run/:id", async (req, reply) => {
    const learner = await learnerFor(req, reply);
    if (!learner) return reply;
    const id = Id.safeParse(req.params.id);
    return id.success && stopRun(id.data, learner) ? { ok: true } : reply.status(404).send(fail("not_found", "Unknown run"));
  });
}
