import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { userOfLearner, visibleWorld } from "../access.ts";
import { db, type Db } from "../db/client.ts";
import { reviewSchedule, type StepPublic, type StepSecret } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { gradeCloze } from "../grading/cloze.ts";
import { gradeMcq } from "../grading/mcq.ts";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { catchUpMastery } from "./mastery.ts";
import { recordLessonObservation } from "./observation.ts";
import { REVIEW_DAYS } from "./review-schedule.ts";
import { Slug, listed } from "./shared.ts";

type ReviewRow = {
  concept_id: string;
  concept_slug: string;
  concept_name: string;
  stage: number;
  due_at: string;
  step_id: string;
  version_id: string;
  title: string;
  slug: string;
  public: StepPublic;
  secret: StepSecret;
};

export async function dueReview(learnerId: string, course: { slug: string } | { id: string }, tx = db) {
  const ref = "id" in course ? sql`w.id = ${course.id}` : sql`w.slug = ${course.slug}`;
  const { rows: [review] } = await tx.execute<ReviewRow>(sql`
    SELECT c.id AS concept_id, c.slug AS concept_slug, c.name AS concept_name, rs.stage, rs.due_at::text AS due_at,
      s.id AS step_id, v.id AS version_id, l.title, l.slug, s.public, s.secret
    FROM review_schedule rs JOIN concepts c ON c.id = rs.concept_id
    JOIN lessons l ON (l.world_id = c.world_id OR c.world_id IS NULL)
    JOIN worlds w ON w.id = l.world_id
    JOIN lesson_versions v ON v.id = l.current_version_id
    JOIN steps s ON s.lesson_version_id = v.id AND s.idx >= 0
    JOIN step_progress sp ON sp.learner_id = rs.learner_id AND sp.step_id = s.id AND sp.state = 'revealed'
    JOIN attempts a ON a.learner_id = rs.learner_id AND a.step_id = s.id AND a.observed AND a.kind <> 'skip'
    WHERE rs.learner_id = ${learnerId} AND rs.due_at <= now() AND ${ref}
      AND ${listed} AND ${visibleWorld(userOfLearner(learnerId))}
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(s.secret->'concepts') = 'array' THEN s.secret->'concepts' ELSE '[]'::jsonb END
        ) tag WHERE lower(btrim(tag)) = c.slug
      )
    ORDER BY rs.due_at, c.slug, (a.correct IS TRUE AND a.hints_used = 0), s.idx, s.id LIMIT 1`);
  return review;
}

const tokenFor = (row: ReviewRow) => `${row.concept_id}:${row.step_id}:${row.due_at}`;
const noReview = () => new TRPCError({ code: "CONFLICT", message: "This review is no longer due." });
const Answer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mcq"), choice: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("cloze"), text: z.string().trim().min(1).max(200) }),
]);

async function submit(tx: Db, learnerId: string, input: { slug: string; token: string; answer: z.infer<typeof Answer> }) {
  await tx.execute(sql`SELECT 1 FROM learners WHERE id = ${learnerId} FOR NO KEY UPDATE`);
  const row = await dueReview(learnerId, input, tx);
  if (!row || tokenFor(row) !== input.token) throw noReview();
  const { answer } = input;
  if (answer.kind !== row.public.kind || (answer.kind === "mcq" && answer.choice >= (row.public.options?.length ?? 0)))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid prediction" });
  const correct = answer.kind === "mcq"
    ? gradeMcq(answer.choice, Number(row.secret.answer))
    : gradeCloze(answer.text, String(row.secret.answer), row.secret.accepted ?? []);
  const stage = correct ? Math.min(row.stage + 1, REVIEW_DAYS.length - 1) : 0;
  const delay = REVIEW_DAYS[stage];
  const inserted = await recordLessonObservation(tx, {
    learnerId,
    lessonVersionId: row.version_id,
    activityKey: `review:${input.token}`,
    kind: answer.kind,
    optionCount: row.public.options?.length,
    conceptSlugs: [row.concept_slug],
    correct,
  });
  if (!inserted) throw noReview();
  await tx.update(reviewSchedule).set({ stage, dueAt: sql`now() + ${delay} * interval '1 day'` })
    .where(and(eq(reviewSchedule.learnerId, learnerId), eq(reviewSchedule.conceptId, row.concept_id)));
  const solution = row.public.kind === "mcq" ? row.public.options?.[Number(row.secret.answer)] ?? "" : String(row.secret.answer);
  return { correct, solution };
}

export const reviewRouter = router({
  get: protectedProcedure.input(Slug).query(async ({ ctx, input }) => {
    const row = await dueReview(ctx.learnerId, input);
    if (!row) return null;
    return {
      token: tokenFor(row),
      name: row.concept_name,
      title: row.public.title,
      prompt: row.public.prompt,
      kind: row.public.kind,
      options: row.public.options,
      beforeFiles: row.secret.beforeFiles,
    };
  }),
  submit: protectedProcedure.input(Slug.extend({ token: z.string().max(250), answer: Answer }))
    .mutation(async ({ ctx, input }) => {
      const result = await withTx((tx) => submit(tx, ctx.learnerId, input));
      await catchUpMastery(ctx.learnerId);
      return result;
    }),
});
