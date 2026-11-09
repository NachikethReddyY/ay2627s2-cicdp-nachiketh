import { EventEmitter } from "node:events";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { importJobEvents, importJobs } from "../db/schema.ts";
import { defaultIngest, type IngestFn } from "./ingest.ts";

export type JobEvent = { seq: number; kind: string; data: unknown };
/** A status event with one of these statuses is the last event of a job. */
export const isTerminal = (e: JobEvent) =>
  e.kind === "status" && ["succeeded", "failed"].includes((e.data as { status?: string } | null)?.status ?? "");

let ingest: IngestFn = defaultIngest;
/** Swap the ingest implementation (tests, and WP6 when it lands). */
export function setIngest(fn: IngestFn) {
  ingest = fn;
}

// Live fan-out of events to open SSE streams. In-process only: this works while a single API process is the only writer.
// A second API instance or a separate worker would need LISTEN/NOTIFY or pg-boss; streams there would only see replayed rows.
const bus = new EventEmitter();
bus.setMaxListeners(0);
const channel = (jobId: string) => `job:${jobId}`;

export function subscribe(jobId: string, fn: (e: JobEvent) => void) {
  bus.on(channel(jobId), fn);
  return () => {
    bus.off(channel(jobId), fn);
  };
}

export async function eventsAfter(jobId: string, after: number): Promise<JobEvent[]> {
  return db
    .select({ seq: importJobEvents.seq, kind: importJobEvents.kind, data: importJobEvents.data })
    .from(importJobEvents)
    .where(and(eq(importJobEvents.jobId, jobId), gt(importJobEvents.seq, after)))
    .orderBy(asc(importJobEvents.seq));
}

// Callers of one job write sequentially, so seq stays gap-free; the unique (job_id, seq) index backs that up.
async function record(jobId: string, kind: string, data: unknown): Promise<void> {
  const [row] = await db
    .insert(importJobEvents)
    .values({
      jobId,
      kind,
      data: data ?? null,
      seq: sql`(SELECT coalesce(max(seq), 0) + 1 FROM import_job_events WHERE job_id = ${jobId})`,
    })
    .returning({ seq: importJobEvents.seq });
  bus.emit(channel(jobId), { seq: row!.seq, kind, data: data ?? null } satisfies JobEvent);
}

const running = new Set<Promise<void>>();
/** Resolves when every started import has finished (tests, graceful shutdown). */
export async function importsIdle() {
  while (running.size) await Promise.allSettled([...running]);
}

async function setStatus(
  jobId: string,
  status: "running" | "succeeded" | "failed",
  extra: { lessonId?: string; error?: string } = {},
) {
  await db.update(importJobs).set({ status, updatedAt: new Date(), ...extra }).where(eq(importJobs.id, jobId));
  await record(jobId, "status", { status, ...extra });
}

async function run(jobId: string, input: { repo: string; sha: string }) {
  try {
    await setStatus(jobId, "running");
    let chain: Promise<void> = Promise.resolve();
    const emit = (kind: string, data: unknown) => {
      chain = chain.then(() => record(jobId, kind, data)).catch(() => undefined);
    };
    const { lessonId } = await ingest(input, emit);
    await chain;
    await setStatus(jobId, "succeeded", { lessonId });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await setStatus(jobId, "failed", { error }).catch(() => undefined);
  }
}

/** Inserts the job as queued and starts the ingest without waiting for it. */
export async function startImport(createdBy: string, input: { repo: string; sha: string }): Promise<string> {
  const [job] = await db.insert(importJobs).values({ createdBy, ...input }).returning({ id: importJobs.id });
  const jobId = job!.id;
  await record(jobId, "status", { status: "queued" });
  const p = new Promise<void>((resolve) => setImmediate(resolve)).then(() => run(jobId, input));
  running.add(p);
  void p.finally(() => running.delete(p));
  return jobId;
}
