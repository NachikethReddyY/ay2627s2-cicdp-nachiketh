import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { isAdmin, resolveLearnerId } from "../auth/guards.ts";
import { db } from "../db/client.ts";
import { feedbackReports as reports } from "../db/schema.ts";
import { storage } from "../media/storage.ts";
import { captureFeedback } from "./analytics.ts";
import { bodyLimit, reportId, submission } from "./input.ts";
import { normalizeScreenshot, screenshotType } from "./screenshot.ts";

const unavailable = "Feedback is temporarily unavailable. Please try again.";
const noStore = "private, no-store";
const conflict = { error: { message: "This submission has changed. Review your feedback and submit again." } };
const storageTimeout = () => AbortSignal.timeout(8_000);

function findSubmission(id: string) {
  return db.select({ hash: reports.submissionHash, received: reports.received }).from(reports).where(eq(reports.id, id));
}

export async function feedbackRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false, cache: 10_000 });

  app.post("/feedback", {
    bodyLimit,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const parsed = submission.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: "Check the required fields, reply email, and screenshot size." } });
    }

    const { id, name, email, category, details } = parsed.data;
    const { location, screenshot } = category === "bug" ? parsed.data : { location: null, screenshot: undefined };
    const hash = createHash("sha256").update(JSON.stringify([name, email, category, location, details, screenshot])).digest("hex");
    const screenshotKey = screenshot ? `feedback/${id}.webp` : null;
    try {
      const [existing] = await findSubmission(id);
      if (existing && existing.hash !== hash) return reply.code(409).send(conflict);
      if (existing?.received) return { id };

      const store = storage;
      if (screenshot && !store) {
        return reply.code(503).send({ error: { message: "Screenshot uploads are unavailable. Try again or remove the screenshot and submit." } });
      }
      const image = screenshot ? await normalizeScreenshot(screenshot) : undefined;
      if (screenshot && !image) {
        return reply.code(422).send({ error: { message: "Choose a valid PNG, JPEG, or WebP screenshot up to 2 MB and 12 megapixels." } });
      }

      const [inserted] = await db.insert(reports)
        .values({ id, name, email, category, details, location, screenshotKey, submissionHash: hash, received: !screenshot })
        .onConflictDoNothing()
        .returning({ received: reports.received });
      if (!inserted) {
        const [reserved] = await findSubmission(id);
        if (reserved?.hash !== hash) return reply.code(409).send(conflict);
        if (reserved.received) return { id };
      }

      if (image && screenshotKey && store) {
        await store.put(screenshotKey, image, screenshotType, { cacheControl: noStore, signal: storageTimeout() });
        const [completed] = await db.update(reports).set({ received: true, createdAt: new Date() })
          .where(and(eq(reports.id, id), eq(reports.received, false))).returning({ id: reports.id });
        if (!completed) return { id };
      }

      await captureFeedback(id, category).catch(() => req.log.warn("feedback analytics failed"));
      return reply.code(201).send({ id });
    } catch {
      req.log.warn("feedback submission failed");
      return reply.code(503).send({ error: { message: unavailable } });
    }
  });

  app.get<{ Params: { id: string } }>("/admin/feedback/:id/screenshot", async (req, reply) => {
    reply.header("Cache-Control", noStore);
    const learner = await resolveLearnerId(req.headers);
    if (!learner) return reply.code(401).send({ error: { message: "Sign in required." } });
    if (!await isAdmin(learner)) return reply.code(403).send({ error: { message: "Admins only." } });

    const id = reportId.safeParse(req.params.id);
    const notFound = { error: { message: "Screenshot not found." } };
    if (!id.success) return reply.code(404).send(notFound);
    const [report] = await db.select({ key: reports.screenshotKey }).from(reports)
      .where(and(eq(reports.id, id.data), eq(reports.received, true)));
    if (!report?.key) return reply.code(404).send(notFound);

    try {
      const bytes = await storage?.get(report.key, storageTimeout());
      if (!bytes) return reply.code(503).send({ error: { message: unavailable } });
      return reply.type(screenshotType).send(Buffer.from(bytes));
    } catch {
      req.log.warn("feedback screenshot read failed");
      return reply.code(503).send({ error: { message: unavailable } });
    }
  });
}
