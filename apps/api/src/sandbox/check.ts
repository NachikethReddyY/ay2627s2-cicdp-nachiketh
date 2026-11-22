import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { practiceContentKey, practiceRevision, practiceTests, recordCompletion, recordPracticeAttempt } from "../parts/practice.ts";
import { PRACTICE_LANGUAGES, type Practice, type PracticeLanguage, type PracticeTest } from "../parts/practice-schema.ts";
import { atCapacity, reserveCheckSlot } from "./run.ts";
import { HARNESS_SOURCE, TEST_TIMEOUT_MS } from "./checkHarness.ts";

export const MAX_CHECK_CODE = 20_000;
const BUDGET_S = 32;
const CONTAINER_LIMIT_S = BUDGET_S + 3;

export type RawResult = { exit: number | null; timedOut: boolean; overflow: boolean; stdout: string; stderr: string };
export type Status = "pass" | "fail" | "timeout" | "error";

export function classify(raw: RawResult, expectedStdout: string): Status {
  if (raw.timedOut) return "timeout";
  if (raw.exit !== 0) return "error";
  if (raw.overflow) return "fail";
  return raw.stdout.trim() === expectedStdout.trim() ? "pass" : "fail";
}

export class CheckUnavailableError extends Error {}

type Spawn = typeof nodeSpawn;
let spawnImpl: Spawn = nodeSpawn;
export function setCheckSpawnForTests(s?: Spawn): void {
  spawnImpl = s ?? nodeSpawn;
}

const RawSchema = z.object({
  token: z.string(),
  results: z.array(z.object({ exit: z.number().int().nullable(), timedOut: z.boolean(), overflow: z.boolean(), stdout: z.string(), stderr: z.string() })),
});

export function runInContainer(code: string, language: PracticeLanguage, tests: PracticeTest[], spawn: Spawn = spawnImpl): Promise<RawResult[]> {
  const name = `lq-check-${randomUUID()}`;
  const token = randomUUID();
  const args = [
    "run", "--rm", "-i", "--name", name, "--network", "none",
    "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64",
    "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "KILL",
    "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,exec,size=16m", "--user", "0:0",
    env.SANDBOX_IMAGE, "timeout", "-s", "KILL", String(CONTAINER_LIMIT_S), "node", "-e", HARNESS_SOURCE,
  ];
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const cleanup = () => {
      try { child.kill("SIGKILL"); } catch { }
      const rm = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
      rm.on("error", () => {});
      setTimeout(() => { try { rm.kill("SIGKILL"); } catch { } }, 10_000).unref();
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(backstop);
      fn();
    };
    const backstop = setTimeout(() => settle(() => { cleanup(); reject(new CheckUnavailableError("budget exceeded")); }), BUDGET_S * 1000);
    backstop.unref();
    child.stdout?.on("data", (d: Buffer) => { if (out.length < 400_000) out += d.toString(); });
    child.stderr?.on("data", () => {});
    child.stdin?.on("error", () => {});
    child.on("error", () => settle(() => reject(new CheckUnavailableError("spawn failed"))));
    child.on("close", (code: number | null) =>
      settle(() => {
        const line = out.split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
        try {
          if (code !== 0) throw new Error("exit");
          const parsed = RawSchema.parse(JSON.parse(line ?? ""));
          if (parsed.token !== token) throw new Error("token");
          if (parsed.results.length !== tests.length) throw new Error("length");
          resolve(parsed.results);
        } catch {
          reject(new CheckUnavailableError("bad harness output"));
        }
      }),
    );
    child.stdin?.end(JSON.stringify({ token, language, code, tests: tests.map((t) => ({ stdin: t.stdin })) }));
  });
}

export type CheckResult = {
  id: string; name: string; stretch: boolean; visibility: "sample" | "hidden"; status: Status;
  stdin?: string; expectedStdout?: string; actualStdout?: string; error?: string;
};

export function score(tests: PracticeTest[], raws: RawResult[]) {
  const required = { passed: 0, total: 0 };
  const stretch = { passed: 0, total: 0 };
  const results: CheckResult[] = tests.map((t, i) => {
    const raw = raws[i];
    const status = classify(raw, t.expectedStdout);
    const bucket = t.stretch ? stretch : required;
    bucket.total++;
    if (status === "pass") bucket.passed++;
    const base: CheckResult = { id: t.id, name: t.name, stretch: t.stretch, visibility: t.visibility, status };
    if (t.visibility !== "sample") return base;
    const error =
      status === "timeout" ? `Timed out after ${TEST_TIMEOUT_MS / 1000} seconds.`
      : status === "error" ? raw.stderr.trim() || "The code stopped with an error."
      : raw.overflow ? "The output was too long."
      : undefined;
    return { ...base, stdin: t.stdin, expectedStdout: t.expectedStdout, actualStdout: raw.stdout, ...(error && { error }) };
  });
  return {
    results,
    required,
    stretch,
    points: required.passed + stretch.passed,
    maxPoints: tests.length,
    complete: required.passed === required.total,
  };
}

async function saveBest(tx: Db, learnerId: string, lessonId: string, points: number, maxPoints: number, complete: boolean) {
  const {
    rows: [row],
  } = await tx.execute<{ best_points: number; max_points: number }>(sql`
    INSERT INTO check_results (learner_id, lesson_id, best_points, max_points, complete)
    VALUES (${learnerId}, ${lessonId}, ${points}, ${maxPoints}, ${complete})
    ON CONFLICT (learner_id, lesson_id) DO UPDATE SET
      best_points = GREATEST(check_results.best_points, EXCLUDED.best_points),
      max_points = CASE WHEN EXCLUDED.best_points > check_results.best_points THEN EXCLUDED.max_points ELSE check_results.max_points END,
      complete = check_results.complete OR EXCLUDED.complete,
      updated_at = now()
    RETURNING best_points, max_points`);
  return { points: row.best_points, maxPoints: row.max_points };
}

const active = new Set<string>();

export async function verifyReferenceSolution(practice: Practice | null, learnerId?: string): Promise<"valid" | "invalid" | "unavailable"> {
  if (!practice?.referenceSolution) return "invalid";
  if (!env.SANDBOX_ENABLED || (learnerId && active.has(learnerId))) return "unavailable";
  const release = reserveCheckSlot();
  if (!release) return "unavailable";
  if (learnerId) active.add(learnerId);
  try {
    const results = await runInContainer(practice.referenceSolution, practice.language, practice.tests);
    return score(practice.tests, results).points === practice.tests.length ? "valid" : "invalid";
  } catch (error) {
    if (!(error instanceof CheckUnavailableError)) throw error;
    return "unavailable";
  } finally {
    if (learnerId) active.delete(learnerId);
    release();
  }
}

export async function sandboxCheckRoute(app: FastifyInstance) {
  const Body = z.object({
    code: z.string().max(MAX_CHECK_CODE).refine((code) => code.trim().length > 0),
    language: z.enum(PRACTICE_LANGUAGES),
    lessonId: z.string().regex(/^[\w-]{1,64}$/),
    versionId: z.string().uuid().optional(),
    revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  });
  const fail = (code: string, message: string) => ({ error: { code, message } });

  app.post("/sandbox/check", async (req, reply) => {
    if (!env.SANDBOX_ENABLED) return reply.status(503).send(fail("unavailable", "Sandbox is disabled"));
    const learner = await resolveLearnerId(req.headers);
    if (!learner) return reply.status(401).send(fail("unauthorized", "Sign in required"));
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.status(400).send(fail("bad_request", "Invalid check request"));
    const found = await practiceTests(learner, body.data.lessonId);
    if (!found) return reply.status(404).send(fail("not_found", "Practice lesson not found"));
    if ((body.data.versionId && body.data.versionId !== found.versionId) ||
        (body.data.revision && body.data.revision !== practiceRevision(found.versionId, found.practice)))
      return reply.status(409).send(fail("lesson_updated", "Reload the lesson before submitting again"));
    if (found.practice.referenceSolution && body.data.language !== found.practice.language)
      return reply.status(400).send(fail("bad_request", "Submit code in the lesson’s language"));
    if (atCapacity()) return reply.status(503).send(fail("busy", "The sandbox is busy, try again soon"));
    if (active.has(learner)) return reply.status(429).send(fail("busy", "Wait for your running check to finish"));
    const release = reserveCheckSlot();
    if (!release) return reply.status(503).send(fail("busy", "The sandbox is busy, try again soon"));
    active.add(learner);
    try {
      const { tests } = found.practice;
      const raws = await runInContainer(body.data.code, body.data.language, tests);
      const scored = score(tests, raws);
      const contentKey = practiceContentKey(found.practice);
      const persisted = await withTx(async (tx) => {
        const current = await practiceTests(learner, found.lessonId, tx);
        if (!current || current.versionId !== found.versionId || practiceContentKey(current.practice) !== contentKey) return null;
        const attemptCount = await recordPracticeAttempt(tx, learner, found.versionId, contentKey);
        if (scored.complete) await recordCompletion(learner, found.lessonId, tx);
        const best = await saveBest(tx, learner, found.lessonId, scored.points, scored.maxPoints, scored.complete);
        return { ...scored, best, attemptCount };
      });
      if (!persisted) return reply.status(409).send(fail("lesson_updated", "Reload the lesson before submitting again"));
      return persisted;
    } catch (e) {
      if (!(e instanceof CheckUnavailableError)) req.log.error(e);
      return reply.status(503).send(fail("check_failed", "Could not check the code"));
    } finally {
      active.delete(learner);
      release();
    }
  });
}
