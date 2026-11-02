import { and, asc, eq, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { learners, lessons, lessonVersions, stepProgress, steps, worlds } from "../db/schema.ts";
import { ensureLesson, prefetchNext } from "../ai/service.ts";
import { listMedia } from "../media/service.ts";

const Lesson = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["predict", "learn", "watch", "practice"]),
  part: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("learn"), body: z.string() }),
      z.object({
        kind: z.literal("watch"),
        beforeFiles: z.record(z.string(), z.string()),
        hunks: z.array(z.object({ id: z.string(), file: z.string(), oldStart: z.number(), lines: z.array(z.string()) })),
      }),
      z.object({ kind: z.literal("practice"), instructions: z.string(), language: z.enum(["python", "javascript"]).default("javascript"), starterCode: z.string(), expectedOutput: z.string() }),
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
  // Short-lived signed URLs; see media/storage.ts.
  media: z.array(z.object({ stepId: z.string().nullable(), kind: z.enum(["narration", "image"]), url: z.string() })),
});

export const lessonsRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }))
    .output(Lesson)
    .query(async ({ ctx, input }) => {
      const { id } = input;
      // Visible = in a public course or one the caller owns; anything else is indistinguishable from missing.
      const [found] = await db
        .select({ lesson: lessons })
        .from(lessons)
        .innerJoin(worlds, eq(worlds.id, lessons.worldId))
        .innerJoin(learners, eq(learners.id, ctx.learnerId))
        .where(
          and(
            or(eq(lessons.id, id), eq(lessons.slug, id)),
            or(eq(lessons.status, "published"), and(eq(lessons.sourceKind, "ai"), eq(lessons.status, "draft"))),
            or(eq(worlds.visibility, "public"), eq(worlds.ownerId, learners.userId)),
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
      return {
        id: lesson.slug,
        title: lesson.title,
        kind: lesson.kind,
        part: version?.content ?? null,
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
