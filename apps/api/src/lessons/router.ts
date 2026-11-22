import { and, asc, eq, sql } from "drizzle-orm";
import { lessonRef, playableLesson, visibleWorld } from "../access.ts";
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
import { malformedScrim, publicScrimMedia, publicScrimSegments, scrimGateStates, scrimStepState, servedGateIds } from "./scrim.ts";
import { loadScrimGates } from "./scrim-gates.ts";
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

const ScrimMore = z.object({
  from: z.number().int().min(0).max(20),
  segments: z.array(z.object({
    text: z.string(),
    durationMs: z.number(),
    edit: z.object({ code: z.string(), run: z.boolean() }).optional(),
    gate: z.string().optional(),
  })),
  nextOffset: z.number().int(),
  complete: z.boolean(),
  media: z.array(z.object({ stepId: z.string().nullable(), segment: z.number().nullable(), kind: z.literal("narration"), url: z.string() })),
});

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
        started: z.boolean(),
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

const write = protectedProcedure
  .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }))
  .output(z.object({ ok: z.literal(true) }))
  .mutation(async ({ ctx, input }) => {
    const [found] = await db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(worlds, eq(worlds.id, lessons.worldId))
      .innerJoin(learners, eq(learners.id, ctx.learnerId))
      .where(and(lessonRef(input.id, lessons), eq(lessons.sourceKind, "ai"), visibleWorld(learners.userId, worlds)));
    if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
    await ensureLesson(found.id, ctx.learnerId);
    return { ok: true as const };
  });

export const lessonsRouter = router({
  write,
  get: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/) }))
    .output(Lesson)
    .query(async ({ ctx, input }) => {
      const { id } = input;
      const [found] = await db
        .select({ lesson: lessons })
        .from(lessons)
        .innerJoin(worlds, eq(worlds.id, lessons.worldId))
        .innerJoin(learners, eq(learners.id, ctx.learnerId))
        .where(
          and(
            lessonRef(id, lessons),
            playableLesson(lessons),
            visibleWorld(learners.userId, worlds),
          ),
        );
      let lesson = found?.lesson;
      if (lesson && !lesson.currentVersionId && lesson.sourceKind === "ai") {
        await ensureLesson(lesson.id, ctx.learnerId);
        [lesson] = await db.select().from(lessons).where(eq(lessons.id, lesson.id));
      }
      if (!lesson?.currentVersionId || (lesson.status !== "published" && !(lesson.status === "draft" && lesson.sourceKind === "ai"))) {
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
      const served = new Set<string>();
      switch (content?.kind) {
        case "practice":
          part = publicPractice(content);
          break;
        case "scrim": {
          const scrim = parseScrim(content);
          if (!scrim) throw malformedScrim();
          const gates = scrimGateStates(scrim, rows);
          const visible = publicScrimSegments(scrim, gates);
          for (const id of servedGateIds(visible.segments)) served.add(id);
          part = {
            kind: "scrim",
            language: scrim.language,
            segments: visible.segments,
            lab: publicPractice(scrim.lab),
            started: rows.some((row) => row.state !== null),
          };
          break;
        }
        case "learn":
        case "game-practice": {
          const doc = content.doc && publicDoc(await resolveDocImages(content.doc, { lessonVersionId: lesson.currentVersionId, learnerId: ctx.learnerId }));
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
      const servedRows = part?.kind === "scrim" ? rows.filter((row) => served.has(row.id)) : rows;
      return {
        id: lesson.slug,
        title: lesson.title,
        kind: lesson.kind,
        part,
        steps: servedRows.map((r) => ({
          id: r.id,
          idx: r.idx,
          title: r.pub.title,
          hintCount: r.hintCount,
          state: lesson.kind === "scrim" ? scrimStepState(r.state) : (r.state ?? "predicting"),
        })),
        media: await listMedia(lesson.currentVersionId).then((media) => {
          if (lesson.kind !== "scrim" || part?.kind !== "scrim") return media;
          const revealedStepIds = new Set(servedRows.filter((row) => row.state === "revealed").map((row) => row.id));
          return publicScrimMedia(media, { from: 0, to: part.segments.length, revealedStepIds });
        }),
      };
    }),
  scrimMore: protectedProcedure
    .input(z.object({ id: z.string().regex(/^[\w-]{1,64}$/), from: z.number().int().min(0).max(20) }))
    .output(ScrimMore)
    .query(async ({ ctx, input }) => {
      const [lesson] = await db
        .select({ lesson: lessons })
        .from(lessons)
        .innerJoin(worlds, eq(worlds.id, lessons.worldId))
        .innerJoin(learners, eq(learners.id, ctx.learnerId))
        .where(and(lessonRef(input.id, lessons), playableLesson(lessons), visibleWorld(learners.userId, worlds)));
      const found = lesson?.lesson;
      if (!found?.currentVersionId || found.kind !== "scrim" || (found.status !== "published" && !(found.status === "draft" && found.sourceKind === "ai"))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scrim lesson not found" });
      }
      const { scrim, gates } = await loadScrimGates(found.currentVersionId, ctx.learnerId);
      const visible = publicScrimSegments(scrim, gates, input.from);
      if (input.from > visible.nextOffset) throw new TRPCError({ code: "CONFLICT", message: "Scrim segment is still gated" });
      const media = await listMedia(found.currentVersionId);
      return {
        from: input.from,
        ...visible,
        media: publicScrimMedia(media, { from: input.from, to: visible.nextOffset, revealedStepIds: new Set() }),
      };
    }),
});
