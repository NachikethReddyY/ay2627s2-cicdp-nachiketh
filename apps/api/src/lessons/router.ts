import { and, asc, eq, or, sql } from "drizzle-orm";
import { lessonRef, visibleWorld } from "../access.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { learners, lessons, lessonVersions, stepProgress, steps, worlds } from "../db/schema.ts";
import { ensureLesson, prefetchNext } from "../ai/service.ts";
import { resolveDocImages } from "../media/imagegen.ts";
import { listMedia } from "../media/service.ts";
import { PRACTICE_LANGUAGES, parsePractice } from "../parts/practice-schema.ts";
import { parseScrim } from "../parts/scrim-schema.ts";
import { publicDoc } from "@learnquest/ui-catalog";

const PracticeTestSummary = z.object({ id: z.string(), name: z.string(), stretch: z.boolean() });
const PublicPractice = z.object({
  kind: z.literal("practice"),
  instructions: z.string(),
  language: z.enum(PRACTICE_LANGUAGES).default("javascript"),
  starterCode: z.string(),
  tests: z.array(z.discriminatedUnion("visibility", [
    PracticeTestSummary.extend({ visibility: z.literal("sample"), stdin: z.string(), expectedStdout: z.string() }),
    PracticeTestSummary.extend({ visibility: z.literal("hidden") }),
  ])),
});

function publicPractice(content: unknown): z.output<typeof PublicPractice> {
  const practice = parsePractice(content);
  if (!practice) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Practice lesson is malformed" });
  return {
    kind: "practice",
    instructions: practice.instructions,
    language: practice.language,
    starterCode: practice.starterCode,
    tests: practice.tests.map((t) =>
      t.visibility === "sample"
        ? { id: t.id, name: t.name, visibility: t.visibility, stretch: t.stretch, stdin: t.stdin, expectedStdout: t.expectedStdout }
        : { id: t.id, name: t.name, visibility: t.visibility, stretch: t.stretch },
    ),
  };
}

const malformedScrim = () => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scrim lesson is malformed" });

const Lesson = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["predict", "learn", "watch", "practice", "game-practice", "scrim"]),
  part: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("learn"), body: z.string(), doc: z.unknown().optional() }),
      z.object({
        kind: z.literal("watch"),
        beforeFiles: z.record(z.string(), z.string()),
        hunks: z.array(z.object({ id: z.string(), file: z.string(), oldStart: z.number(), lines: z.array(z.string()) })),
      }),
      z.object({
        kind: z.literal("scrim"),
        language: z.enum(PRACTICE_LANGUAGES),
        segments: z.array(z.object({
          text: z.string(),
          durationMs: z.number(),
          edit: z.object({ code: z.string(), run: z.boolean() }).optional(),
          gate: z.string().optional(),
        })),
        lab: PublicPractice,
      }),
      PublicPractice,
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
  media: z.array(z.object({ stepId: z.string().nullable(), segment: z.number().nullable(), kind: z.literal("narration"), url: z.string() })),
});

export const lessonsRouter = router({
  get: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }))
    .output(Lesson)
    .query(async ({ ctx, input }) => {
      const { id } = input;
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
      const content = version?.content;
      if ((lesson.kind === "scrim") !== (content?.kind === "scrim")) throw malformedScrim();
      let part: z.output<typeof Lesson>["part"] = null;
      switch (content?.kind) {
        case "practice":
          part = publicPractice(content);
          break;
        case "scrim": {
          const scrim = parseScrim(content);
          if (!scrim) throw malformedScrim();
          part = {
            kind: "scrim",
            language: scrim.language,
            segments: scrim.segments.map(({ text, durationMs, edit, gate }) => {
              const step = gate === undefined ? undefined : rows.find((row) => row.idx === gate);
              if (gate !== undefined && step?.pub.kind !== "mcq") throw malformedScrim();
              return {
                text,
                durationMs,
                ...(edit && { edit: { code: edit.code, run: edit.run } }),
                ...(step && { gate: step.id }),
              };
            }),
            lab: publicPractice(scrim.lab),
          };
          break;
        }
        case "learn":
        case "game-practice": {
          const doc = content.doc && publicDoc(await resolveDocImages(content.doc, { lessonVersionId: lesson.currentVersionId, learnerId: ctx.learnerId, tier: found.tier }));
          part = content.kind === "learn"
            ? { kind: "learn", body: content.body, doc }
            : { kind: "game-practice", intro: content.intro, doc };
          break;
        }
        case "watch":
          part = {
            kind: "watch",
            beforeFiles: content.beforeFiles,
            hunks: content.hunks.map(({ id, file, oldStart, lines }) => ({ id, file, oldStart, lines })),
          };
          break;
        case undefined:
          break;
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
        media: await listMedia(lesson.currentVersionId),
      };
    }),
});
