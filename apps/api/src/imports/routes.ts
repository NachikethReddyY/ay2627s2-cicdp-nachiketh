import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { importJobs, lessons, lessonVersions } from "../db/schema.ts";
import { resolveLearnerId } from "../auth/guards.ts";
import { eventsAfter, isTerminal, startImport, subscribe, type JobEvent } from "./runner.ts";

const ImportBody = z.object({
  repo: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/, "repo must look like owner/name"),
  sha: z.string().regex(/^[0-9a-fA-F]{7,40}$/, "sha must be 7 to 40 hex characters"),
});
const Id = z.string().regex(/^[\w-]{1,64}$/);

const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ error: { code, message } });

// Import, job events and publish routes. Authors are any signed-in learner; ownership comes from import_jobs.created_by.
export async function importRoutes(api: FastifyInstance) {
  api.post("/lessons/import", async (req, reply) => {
    const me = await resolveLearnerId(req.headers);
    if (!me) return fail(reply, 401, "unauthorized", "Sign in required");
    const body = ImportBody.safeParse(req.body);
    if (!body.success) return fail(reply, 400, "bad_request", body.error.issues[0]?.message ?? "Invalid body");
    const repo = body.data.repo.toLowerCase();
    if (!env.IMPORT_REPO_ALLOWLIST.includes(repo)) return fail(reply, 400, "bad_request", "Repo is not on the import allow-list");
    const jobId = await startImport(me, { repo, sha: body.data.sha.toLowerCase() });
    return reply.status(202).send({ jobId });
  });

  // Unknown job and someone else's job both answer 404, so a job id never confirms that it exists.
  api.get<{ Params: { id: string }; Querystring: { after?: string } }>("/jobs/:id/events", async (req, reply) => {
    const me = await resolveLearnerId(req.headers);
    if (!me) return fail(reply, 401, "unauthorized", "Sign in required");
    const id = Id.safeParse(req.params.id);
    if (!id.success) return fail(reply, 404, "not_found", "Job not found");
    const [job] = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(eq(importJobs.id, id.data), eq(importJobs.createdBy, me)));
    if (!job) return fail(reply, 404, "not_found", "Job not found");

    const last = req.headers["last-event-id"] ?? req.query.after;
    const afterRaw = Number.parseInt(Array.isArray(last) ? (last[0] ?? "") : (last ?? ""), 10);
    let cursor = Number.isFinite(afterRaw) && afterRaw > 0 ? afterRaw : 0;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false;
    let done = false;
    let ping: NodeJS.Timeout | undefined;
    // Subscribe before replaying so an event written in between is buffered, then deduplicated by seq.
    const buffer: JobEvent[] = [];
    let replaying = true;
    const send = (e: JobEvent) => {
      if (closed || done || e.seq <= cursor) return;
      cursor = e.seq;
      res.write(`id: ${e.seq}\nevent: ${e.kind}\ndata: ${JSON.stringify(e.data)}\n\n`);
      if (isTerminal(e)) {
        done = true;
        finish();
      }
    };
    const unsubscribe = subscribe(job.id, (e) => (replaying ? buffer.push(e) : send(e)));
    function finish() {
      unsubscribe();
      clearInterval(ping);
      if (!closed) {
        closed = true;
        res.end();
      }
    }
    req.raw.on("close", () => {
      closed = true;
      clearInterval(ping);
      unsubscribe();
    });
    // Comment line keeps proxies from dropping an idle stream.
    ping = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, 15_000);
    try {
      for (const e of await eventsAfter(job.id, cursor)) send(e);
      replaying = false;
      for (const e of buffer.sort((a, b) => a.seq - b.seq)) send(e);
      // A cursor at or past the last event replays nothing; a finished job must still close the stream.
      if (!closed && !done) {
        const [row] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, job.id));
        if (row && (row.status === "succeeded" || row.status === "failed")) {
          done = true;
          finish();
        }
      }
    } catch (err) {
      req.log.error(err);
      finish();
    }
  });

  const setPublished = (publish: boolean) => async (req: { headers: Parameters<typeof resolveLearnerId>[0]; params: unknown }, reply: FastifyReply) => {
    const me = await resolveLearnerId(req.headers);
    if (!me) return fail(reply, 401, "unauthorized", "Sign in required");
    const id = Id.safeParse((req.params as { id: string }).id);
    if (!id.success) return fail(reply, 404, "not_found", "Lesson not found");
    const result = await db.transaction(async (tx) => {
      // Only the creator of the import job that produced the lesson may change it; others see 404.
      const [owned] = await tx
        .select({ id: lessons.id, versionId: lessons.currentVersionId, status: lessons.status, sourceKind: lessons.sourceKind })
        .from(lessons)
        .innerJoin(importJobs, and(eq(importJobs.lessonId, lessons.id), eq(importJobs.createdBy, me)))
        .where(eq(lessons.id, id.data))
        .limit(1)
        .for("update", { of: lessons });
      if (!owned) return "missing" as const;
      if (owned.sourceKind !== "repo" || owned.status === "archived") return "not-allowed" as const;
      if (publish) {
        if (!owned.versionId) return "no-version" as const;
        await tx.update(lessons).set({ status: "published" }).where(eq(lessons.id, owned.id));
        await tx
          .update(lessonVersions)
          .set({ publishedAt: sql`coalesce(${lessonVersions.publishedAt}, now())` })
          .where(eq(lessonVersions.id, owned.versionId));
      } else {
        await tx.update(lessons).set({ status: "draft" }).where(eq(lessons.id, owned.id));
      }
      return "ok" as const;
    });
    if (result === "missing") return fail(reply, 404, "not_found", "Lesson not found");
    if (result === "not-allowed") return fail(reply, 409, "conflict", "Only imported, non-archived lessons can be published or unpublished");
    if (result === "no-version") return fail(reply, 409, "conflict", "Lesson has no version to publish");
    return { id: id.data, status: publish ? ("published" as const) : ("draft" as const) };
  };
  api.post("/lessons/:id/publish", setPublished(true));
  api.post("/lessons/:id/unpublish", setPublished(false));
}
