import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";

// Live Python runs for practice lessons. Each run is a fresh, locked-down container, removed when the program ends or is stopped.
export const MAX_CODE = 4000;
const MAX_OUT = 8000;
const MAX_LINE = 200;
const LIMIT_S = 60; // wall-clock limit, long enough for a learner to type answers
const MAX_ACTIVE = 2; // live runs per learner
const KEEP_S = 60; // a finished run stays readable this long

type Spawn = typeof nodeSpawn;
type Run = {
  id: string;
  learner: string;
  child: ReturnType<Spawn>;
  out: string;
  done: boolean;
  error?: string;
  timer: NodeJS.Timeout;
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

export type Language = "python" | "javascript";
const INTERPRETER: Record<Language, string[]> = {
  python: ["python3", "-I", "-u", "-c"],
  javascript: ["node", "-e"],
};

/** Starts a program and returns its run id, or null when the learner already has too many live runs. */
export function startRun(code: string, learner: string, language: Language, spawn: Spawn = nodeSpawn): string | null {
  let active = 0;
  for (const r of runs.values()) if (r.learner === learner && !r.done) active++;
  if (active >= MAX_ACTIVE) return null;
  const args = [
    "run", "--rm", "-i", "--network", "none",
    "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,exec,size=16m", "--user", "1001:1001",
    env.SANDBOX_IMAGE, "timeout", "-s", "KILL", String(LIMIT_S), ...INTERPRETER[language], code,
  ];
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  const id = randomUUID();
  // Backstop in case the container hangs past the program's own limit.
  const run: Run = { id, learner, child, out: "", done: false, timer: setTimeout(() => { finish(run, STOPPED); child.kill("SIGKILL"); }, (LIMIT_S + 5) * 1000) };
  runs.set(id, run);
  let err = "";
  child.stdout?.on("data", (d: Buffer) => { if (run.out.length < MAX_OUT) run.out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { if (err.length < MAX_OUT) err += d.toString(); });
  child.stdin?.on("error", () => {}); // the program may exit before a late answer arrives
  child.on("error", () => finish(run, "Could not run the code"));
  child.on("close", (exit) => {
    if (exit === 0) finish(run);
    else if (exit === 124 || exit === 137) finish(run, STOPPED);
    else finish(run, err.trim() || "The code stopped with an error.");
  });
  return id;
}

const own = (id: string, learner: string) => {
  const r = runs.get(id);
  return r && r.learner === learner ? r : undefined;
};

/** Output from `from` on, so the client only ever gets new text. */
export function runStatus(id: string, learner: string, from: number) {
  const r = own(id, learner);
  if (!r) return null;
  return { output: r.out.slice(from), next: r.out.length, done: r.done, error: r.error };
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
  if (!r.done) {
    finish(r);
    r.child.kill("SIGKILL");
  }
  return true;
}

export async function sandboxRunRoute(app: FastifyInstance) {
  const Start = z.object({ code: z.string().max(MAX_CODE), language: z.enum(["python", "javascript"]).default("python") });
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
    const id = startRun(body.data.code, learner, body.data.language);
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
