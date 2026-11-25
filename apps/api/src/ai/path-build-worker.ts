import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client.ts";
import { pathBuildJobs } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { EngineError } from "../engine-client/client.ts";
import { CurriculumRefused } from "./curriculum.ts";
import { LESSON_WRITE_CONCURRENCY, persistCurriculum, planPath, writePlannedLesson } from "./service.ts";

const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 45;
const HEARTBEAT_MS = 10_000;
const POLL_MS = 1_000;

type Job = { id: string; pathId: string; learnerId: string; lessonId: string | null; topic: string | null; checkpoint: unknown; attempts: number };

const claimLock = sql`SELECT pg_advisory_xact_lock(hashtext('path_build_claim'))`;

async function claimJobs(token: string, localCapacity = LESSON_WRITE_CONCURRENCY) {
  return withTx(async (tx) => {
    await tx.execute(claimLock);
    await tx.execute(sql`
      UPDATE path_build_jobs SET state = 'failed', lease_until = NULL, lease_token = NULL
      WHERE state = 'writing' AND lease_until <= clock_timestamp() AND attempts >= ${MAX_ATTEMPTS}`);
    const { rows: [active] } = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM path_build_jobs WHERE state = 'writing' AND lease_until > clock_timestamp()`);
    const capacity = Math.max(0, Math.min(localCapacity, LESSON_WRITE_CONCURRENCY - active.total));
    const { rows } = await tx.execute<Job>(sql`
      WITH candidates AS (
        SELECT id FROM path_build_jobs
        WHERE (state = 'pending' AND available_at <= clock_timestamp())
          OR (state = 'writing' AND lease_until <= clock_timestamp())
        ORDER BY available_at, id LIMIT ${capacity} FOR UPDATE SKIP LOCKED
      )
      UPDATE path_build_jobs j
      SET state = 'writing', attempts = j.attempts + 1,
        lease_until = clock_timestamp() + make_interval(secs => ${LEASE_SECONDS}), lease_token = ${token}
      FROM candidates WHERE j.id = candidates.id
      RETURNING j.id, j.path_id AS "pathId", j.learner_id AS "learnerId",
        j.lesson_id AS "lessonId", j.topic, j.checkpoint, j.attempts`);
    return rows;
  });
}

async function runJob(job: Job, token: string) {
  const owned = and(eq(pathBuildJobs.id, job.id), eq(pathBuildJobs.leaseToken, token), sql`${pathBuildJobs.leaseUntil} > clock_timestamp()`);
  const heartbeat = setInterval(() => {
    void withTx(async (tx) => {
      await tx.execute(claimLock);
      await tx.update(pathBuildJobs).set({ leaseUntil: sql`clock_timestamp() + make_interval(secs => ${LEASE_SECONDS})` }).where(owned);
    }).catch(() => console.error("Could not renew path build lease"));
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let attempts = job.attempts;
  try {
    const plan = job.topic ? await planPath(job.topic, job.learnerId, job.checkpoint, async (checkpoint) => {
      const [updated] = await db.update(pathBuildJobs).set({ checkpoint, attempts: 0 }).where(owned).returning({ id: pathBuildJobs.id });
      if (!updated) throw new Error("Path build lease expired");
      attempts = 0;
    }) : null;
    if (job.lessonId) await writePlannedLesson(job.lessonId, job.learnerId, { id: job.id, token });
    await withTx(async (tx) => {
      const [claimed] = await tx.select({ id: pathBuildJobs.id }).from(pathBuildJobs).where(owned).for("update");
      if (!claimed) return;
      if (plan) await persistCurriculum(tx, job.pathId, job.learnerId, plan);
      await tx.update(pathBuildJobs).set({ state: "ready", leaseUntil: null, leaseToken: null, checkpoint: null }).where(eq(pathBuildJobs.id, job.id));
    });
  } catch (error) {
    const paused = error instanceof TRPCError && (error.code === "TOO_MANY_REQUESTS" || error.code === "PRECONDITION_FAILED");
    const refused = error instanceof CurriculumRefused;
    const terminal = refused || paused || attempts >= MAX_ATTEMPTS;
    const cooldown = error instanceof EngineError && error.status === 429
      ? Math.max(60, Math.min(error.retryAfterSeconds ?? 0, 900)) : null;
    await withTx(async (tx) => {
      if (cooldown !== null) await tx.execute(claimLock);
      const [updated] = await tx.update(pathBuildJobs).set({
        state: refused ? "refused" : terminal ? "failed" : "pending",
        availableAt: sql`now() + make_interval(secs => ${cooldown ?? 15 * Math.max(1, attempts)})`,
        leaseUntil: null,
        leaseToken: null,
      }).where(owned).returning({ availableAt: pathBuildJobs.availableAt });
      if (cooldown !== null && updated) {
        await tx.execute(sql`
          UPDATE path_build_jobs SET available_at = ${updated.availableAt.toISOString()}
          WHERE state = 'pending' AND available_at < ${updated.availableAt.toISOString()}`);
      }
    });
    console.error(JSON.stringify({
      event: "path_build_failed",
      stage: job.lessonId ? "lesson" : "planning",
      jobId: job.id,
      attemptsSinceProgress: attempts,
      terminal,
      engineStatus: error instanceof EngineError ? error.status : undefined,
      code: error instanceof TRPCError ? error.code : undefined,
    }));
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runPathBuildBatch() {
  const token = randomUUID();
  const jobs = await claimJobs(token);
  await Promise.all(jobs.map((job) => runJob(job, token)));
  return jobs.length;
}

export function startPathBuildWorker() {
  let claiming: Promise<void> | undefined;
  const running = new Set<Promise<void>>();
  let stopped = false;
  const poll = () => {
    if (stopped || claiming || running.size >= LESSON_WRITE_CONCURRENCY) return;
    const token = randomUUID();
    claiming = claimJobs(token, LESSON_WRITE_CONCURRENCY - running.size).then((jobs) => {
      for (const job of jobs) {
        const task = runJob(job, token)
          .catch(() => console.error("Could not record path build result"))
          .finally(() => { running.delete(task); });
        running.add(task);
      }
    }).catch(() => console.error("Could not claim path build jobs"))
      .finally(() => { claiming = undefined; });
  };
  const timer = setInterval(poll, POLL_MS);
  timer.unref();
  poll();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await claiming;
    await Promise.all(running);
  };
}
