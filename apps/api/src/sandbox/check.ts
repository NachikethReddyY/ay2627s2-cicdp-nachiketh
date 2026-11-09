import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { practiceTests, recordCompletion } from "../parts/practice.ts";
import { PRACTICE_LANGUAGES, type PracticeLanguage, type PracticeTest } from "../parts/practice-schema.ts";
import { atCapacity, reserveCheckSlot } from "./run.ts";
import { HARNESS_SOURCE, TEST_TIMEOUT_MS } from "./checkHarness.ts";

// Multi-test Check of a practice lesson: one locked-down container runs the learner's code once per test.
export const MAX_CHECK_CODE = 20_000;
const BUDGET_S = 32; // host backstop for the whole container; the harness stops starting tests at 24 s
const CONTAINER_LIMIT_S = BUDGET_S + 3; // in-container kill, in case the host's `docker rm` is slow

export type RawResult = { exit: number | null; timedOut: boolean; overflow: boolean; stdout: string; stderr: string };
export type Status = "pass" | "fail" | "timeout" | "error";

/** Pass = clean exit and matching trimmed stdout; a killed test is a timeout; any other non-zero exit is an error. */
export function classify(raw: RawResult, expectedStdout: string): Status {
  if (raw.timedOut) return "timeout";
  if (raw.exit !== 0) return "error";
  // Output cut off at the cap was not seen in full, so it cannot be judged a match.
  if (raw.overflow) return "fail";
  return raw.stdout.trim() === expectedStdout.trim() ? "pass" : "fail";
}

export class CheckUnavailableError extends Error {}

type Spawn = typeof nodeSpawn;
let spawnImpl: Spawn = nodeSpawn;
/** Tests swap in a fake `docker`; pass nothing to restore the real one. */
export function setCheckSpawnForTests(s?: Spawn): void {
  spawnImpl = s ?? nodeSpawn;
}

const RawSchema = z.object({
  token: z.string(),
  results: z.array(z.object({ exit: z.number().int().nullable(), timedOut: z.boolean(), overflow: z.boolean(), stdout: z.string(), stderr: z.string() })),
});

/** Runs the code against every test in one container. Throws CheckUnavailableError unless the harness reports on every test. */
export function runInContainer(code: string, language: PracticeLanguage, tests: PracticeTest[], spawn: Spawn = spawnImpl): Promise<RawResult[]> {
  const name = `lq-check-${randomUUID()}`;
  const token = randomUUID(); // sent on stdin only (argv and env are visible to the learner) and must come back in the result
  const args = [
    "run", "--rm", "-i", "--name", name, "--network", "none",
    "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64",
    // The harness runs as root so the learner (uid 1001, started through setpriv) is a different uid and cannot
    // open /proc/<harness pid>/fd or read its memory: that is what stops a forged result line and a read of the
    // hidden test stdin. Root keeps only SETUID and SETGID (to drop to 1001) and KILL (to stop a timed-out learner
    // process it does not own); the learner itself gets an empty capability set. no-new-privileges still applies.
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
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      const rm = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
      rm.on("error", () => {});
      setTimeout(() => { try { rm.kill("SIGKILL"); } catch { /* done */ } }, 10_000).unref();
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
        // The LAST line only, from a container that exited cleanly, carrying this check's token. Anything else
        // (missing, malformed, wrong length, wrong token, killed harness) is a harness failure, never a pass.
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

/** Scores raw results. Hidden tests carry only id, name, stretch, visibility and status. */
export function score(tests: PracticeTest[], raws: RawResult[]) {
  const required = { passed: 0, total: 0 };
  const stretch = { passed: 0, total: 0 };
  const results: CheckResult[] = tests.map((t, i) => {
    const raw = raws[i]!;
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

/** Keeps the greater best_points (and its max); complete never goes back to false. */
async function saveBest(learnerId: string, lessonId: string, points: number, maxPoints: number, complete: boolean) {
  const {
    rows: [row],
  } = await db.execute<{ best_points: number; max_points: number }>(sql`
    INSERT INTO check_results (learner_id, lesson_id, best_points, max_points, complete)
    VALUES (${learnerId}, ${lessonId}, ${points}, ${maxPoints}, ${complete})
    ON CONFLICT (learner_id, lesson_id) DO UPDATE SET
      best_points = GREATEST(check_results.best_points, EXCLUDED.best_points),
      max_points = CASE WHEN EXCLUDED.best_points > check_results.best_points THEN EXCLUDED.max_points ELSE check_results.max_points END,
      complete = check_results.complete OR EXCLUDED.complete,
      updated_at = now()
    RETURNING best_points, max_points`);
  return { points: row!.best_points, maxPoints: row!.max_points };
}

const active = new Set<string>(); // learners with a check in flight: one at a time each

export async function sandboxCheckRoute(app: FastifyInstance) {
  const Body = z.object({
    code: z.string().max(MAX_CHECK_CODE),
    language: z.enum(PRACTICE_LANGUAGES),
    lessonId: z.string().regex(/^[\w-]{1,64}$/),
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
    if (atCapacity()) return reply.status(503).send(fail("busy", "The sandbox is busy, try again soon"));
    if (active.has(learner)) return reply.status(429).send(fail("busy", "Wait for your running check to finish"));
    const release = reserveCheckSlot(); // counts against SANDBOX_MAX_RUNS together with ordinary runs
    if (!release) return reply.status(503).send(fail("busy", "The sandbox is busy, try again soon"));
    active.add(learner);
    try {
      const { tests } = found.practice;
      const raws = await runInContainer(body.data.code, body.data.language, tests);
      const scored = score(tests, raws);
      if (scored.complete) await recordCompletion(learner, found.lessonId);
      const best = await saveBest(learner, found.lessonId, scored.points, scored.maxPoints, scored.complete);
      return { ...scored, best };
    } catch (e) {
      if (!(e instanceof CheckUnavailableError)) req.log.error(e);
      return reply.status(503).send(fail("check_failed", "Could not check the code"));
    } finally {
      active.delete(learner);
      release();
    }
  });
}
