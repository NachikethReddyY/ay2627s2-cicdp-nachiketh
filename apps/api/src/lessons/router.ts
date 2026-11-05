import { and, asc, eq, or, sql } from "drizzle-orm";
import { lessonRef, visibleWorld } from "../access.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { learners, lessons, lessonVersions, stepProgress, steps, worlds } from "../db/schema.ts";
import { ensureLesson, prefetchNext } from "../ai/service.ts";
import { tiers } from "../config/tiers.ts";
import { resolveDocImages } from "../media/imagegen.ts";
import { listMedia } from "../media/service.ts";

const Lesson = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["predict", "learn", "watch", "practice", "game-practice"]),
  part: z
    .discriminatedUnion("kind", [
      // doc is a catalog-validated visual document; the client re-parses it before rendering.
      z.object({ kind: z.literal("learn"), body: z.string(), doc: z.unknown().optional() }),
      z.object({
        kind: z.literal("watch"),
        beforeFiles: z.record(z.string(), z.string()),
        hunks: z.array(z.object({ id: z.string(), file: z.string(), oldStart: z.number(), lines: z.array(z.string()) })),
      }),
      z.object({ kind: z.literal("practice"), instructions: z.string(), language: z.enum(["python", "javascript"]).default("javascript"), starterCode: z.string() }),
      z.object({ kind: z.literal("game-practice"), intro: z.string(), doc: z.unknown() }),
    ])
    .nullable(),
  steps: z.array(
    z.object({
      id: z.string(),
      idx: z.number(),
      title: z.string(),
      hintCount: z.number(),
      state: z.enum(["predicting", "hinting", "revealed", "skipped"]),
    }),
  ),
  // Narration only, as short-lived signed URLs (media/storage.ts). Image URLs are inline in part.doc.
  media: z.array(z.object({ stepId: z.string().nullable(), kind: z.literal("narration"), url: z.string() })),
});

export const lessonsRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }))
    .output(Lesson)
    .query(async ({ ctx, input }) => {
      const { id } = input;
      // Visible = in a public course or one the caller owns; anything else is indistinguishable from missing.
      const [found] = await db
        .select({ lesson: lessons, tier: learners.tier })
        .from(lessons)
        .innerJoin(worlds, eq(worlds.id, lessons.worldId))
        .innerJoin(learners, eq(learners.id, ctx.learnerId))
        .where(
          and(
            lessonRef(id, lessons),
            or(eq(lessons.status, "published"), and(eq(lessons.sourceKind, "ai"), eq(lessons.status, "draft"))),
            visibleWorld(learners.userId, worlds),
          ),
        );
      let lesson = found?.lesson;
      // AI lessons are written the first time they are played; this call waits for it.
      if (lesson && !lesson.currentVersionId && lesson.sourceKind === "ai") {
        await ensureLesson(lesson.id, ctx.learnerId);
        [lesson] = await db.select().from(lessons).where(eq(lessons.id, lesson.id));
      }
      if (!lesson?.currentVersionId || lesson.status !== "published") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }
      const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, lesson.currentVersionId));
      if (lesson.sourceKind === "ai") prefetchNext(lesson, ctx.learnerId);
      const rows = await db
        .select({ id: steps.id, idx: steps.idx, pub: steps.public, hintCount: sql<number>`jsonb_array_length(${steps.secret}->'hints')`, state: stepProgress.state })
        .from(steps)
        .leftJoin(
          stepProgress,
          and(eq(stepProgress.stepId, steps.id), eq(stepProgress.learnerId, ctx.learnerId)),
        )
        .where(eq(steps.lessonVersionId, lesson.currentVersionId))
        .orderBy(asc(steps.idx));
      const media = await listMedia(lesson.currentVersionId);
      // Generated images are resolved per read: the prompt is stripped here and never reaches the learner.
      let part = version?.content ?? null;
      // Never send a practice lesson's expected output: the sandbox Check compares stdout to it server-side (parts/practice.ts).
      if (part?.kind === "practice") {
        const { expectedOutput: _hidden, ...visible } = part;
        part = visible as typeof part;
      }
      if (part && (part.kind === "learn" || part.kind === "game-practice") && part.doc) {
        const doc = await resolveDocImages(part.doc, { lessonVersionId: lesson.currentVersionId, learnerId: ctx.learnerId, tier: found!.tier as keyof typeof tiers });
        part = { ...part, doc } as typeof part; // resolveDocImages keeps the catalog shape; its return type is unknown
      }
      return {
        id: lesson.slug,
        title: lesson.title,
        kind: lesson.kind,
        part,
        steps: rows.map((r) => ({
          id: r.id,
          idx: r.idx,
          title: r.pub.title,
          hintCount: r.hintCount,
          state: r.state ?? "predicting",
        })),
        media,
      };
    }),
});
