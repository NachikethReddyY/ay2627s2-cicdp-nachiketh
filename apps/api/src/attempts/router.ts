import { and, count, eq } from "drizzle-orm";
import { visibleWorld } from "../access.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { attempts, hintEvents, learners, lessons, lessonVersions, stepProgress, steps, worlds } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { gradeCloze } from "../grading/cloze.ts";
import { gradeMcq } from "../grading/mcq.ts";
import { applyObservations, resolveConcepts } from "../progress/mastery.ts";
import { fresh, next, type Action, type Progress } from "./machine.ts";

const Id = z.object({ id: z.string().regex(/^[\w-]{1,64}$/) });
const State = z.enum(["predicting", "hinting", "revealed", "skipped"]);
const Hint = z.object({ rung: z.number(), text: z.string(), eliminate: z.number().optional() });
const Body = z.discriminatedUnion("kind", [
  // Upper bound is checked against the step's real option count in `attempt`.
  z.object({ kind: z.literal("mcq"), choice: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal("cloze"), text: z.string().max(200) }),
]);

const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Step not found" });

// Loads the published step or throws NOT_FOUND.
async function mustStep(id: string, learnerId: string) {
  const step = await loadStep(id, learnerId);
  if (!step) throw notFound();
  return step;
}

async function loadStep(id: string, learnerId: string) {
  const [row] = await db
    .select({ id: steps.id, idx: steps.idx, pub: steps.public, secret: steps.secret, source: lessons.source, lessonConcepts: lessons.concepts })
    .from(steps)
    .innerJoin(lessonVersions, eq(lessonVersions.id, steps.lessonVersionId))
    .innerJoin(lessons, eq(lessons.id, lessonVersions.lessonId))
    .innerJoin(worlds, eq(worlds.id, lessons.worldId))
    .innerJoin(learners, eq(learners.id, learnerId))
    .where(
      and(
        eq(steps.id, id),
        eq(lessons.status, "published"),
        // Only the lesson's current version is playable; steps of superseded versions are gone.
        eq(lessons.currentVersionId, steps.lessonVersionId),
        visibleWorld(learners.userId, worlds),
      ),
    );
  return row;
}
type Step = NonNullable<Awaited<ReturnType<typeof loadStep>>>;

// Concept names only (public labels), resolved like mastery does: the step's own list, else its lesson's.
const missedOf = (step: Step) => resolveConcepts(step.secret.concepts, step.lessonConcepts, `step ${step.id}`);

const hintAt = (step: Step, rung: number) => {
  const h = step.secret.hints[rung - 1]!;
  // Eliminate is only meaningful on MCQ rung 1.
  const eliminate = step.pub.kind === "mcq" && rung === 1 ? h.eliminate : undefined;
  return { rung, text: h.text, ...(eliminate !== undefined && { eliminate }) };
};

async function readProgress(learnerId: string, stepId: string): Promise<Progress> {
  const [p] = await db
    .select()
    .from(stepProgress)
    .where(and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, stepId)));
  return p ?? fresh();
}

// Serialised per (learner, step) by the row lock, so parallel identical requests can't both be "first".
function mutate(
  learnerId: string,
  step: Step,
  action: Action,
  response: { kind: "mcq" | "cloze"; choice?: number; text?: string } | null,
) {
  const stepId = step.id;
  return withTx(async (tx) => {
    await tx.insert(stepProgress).values({ learnerId, stepId }).onConflictDoNothing();
    const where = and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, stepId));
    const [p] = await tx.select().from(stepProgress).where(where).for("update");
    const r = next(p!, action, { hintCount: step.secret.hints.length });
    if ("conflict" in r) return r;

    await tx.update(stepProgress).set({ ...r.progress, updatedAt: new Date() }).where(where);
    const o = r.outcome;
    let attemptId: string | undefined;
    let observedFirst = false;
    if (o.type === "hint") {
      await tx.insert(hintEvents).values({ learnerId, stepId, rung: o.rung });
    } else {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(attempts)
        .where(and(eq(attempts.learnerId, learnerId), eq(attempts.stepId, stepId)));
      const [row] = await tx
        .insert(attempts)
        .values({
          learnerId,
          stepId,
          kind: o.type === "skip" ? "skip" : response!.kind,
          response: o.type === "skip" ? null : response,
          observed: n === 0,
          correct: o.type === "skip" ? null : o.correct,
          hintsUsed: r.progress.rungsTaken,
          feedback: o.type === "skip" ? null : o.correct ? "Correct!" : "Not quite.",
          missedConcepts: o.type === "skip" || o.correct ? [] : missedOf(step),
        })
        .returning({ id: attempts.id });
      attemptId = row!.id;
      observedFirst = n === 0;
    }
    return { ...r, attemptId, observed: attemptId !== undefined && observedFirst };
  });
}

// Applies the learner's pending observations. Mastery is secondary: a failure never fails the attempt,
// and the next read of me.mastery / me.next catches up.
async function applyMastery(learnerId: string, out: { observed: boolean }) {
  if (!out.observed) return;
  try {
    await applyObservations(learnerId);
  } catch (e) {
    console.error("mastery update failed; will catch up on read", e);
  }
}

const Attempt = z.object({
  attemptId: z.string(),
  correct: z.boolean(),
  feedback: z.string(),
  missedConcepts: z.array(z.string()),
  hintsUsed: z.number(),
  state: State,
  attemptAllowed: z.boolean(),
});

export const stepsRouter = router({
  get: protectedProcedure
    .input(Id)
    .output(
      z.object({
        id: z.string(),
        idx: z.number(),
        title: z.string(),
        prompt: z.string(),
        kind: z.enum(["mcq", "cloze"]),
        options: z.array(z.string()).optional(),
        hintCount: z.number(),
        state: State,
        rungsTaken: z.number(),
        attemptAllowed: z.boolean(),
        hints: z.array(Hint),
        beforeFiles: z.record(z.string(), z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const p = await readProgress(ctx.learnerId, step.id);
      return {
        id: step.id,
        idx: step.idx,
        title: step.pub.title,
        prompt: step.pub.prompt,
        kind: step.pub.kind,
        ...(step.pub.options && { options: step.pub.options }),
        hintCount: step.secret.hints.length,
        state: p.state,
        rungsTaken: p.rungsTaken,
        attemptAllowed: p.attemptAllowed,
        hints: Array.from({ length: p.rungsTaken }, (_, i) => hintAt(step, i + 1)),
        beforeFiles: step.secret.beforeFiles,
      };
    }),

  attempt: protectedProcedure
    .input(Id.extend({ answer: Body }))
    .output(Attempt)
    .mutation(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const b = input.answer;
      if (b.kind !== step.pub.kind) throw new TRPCError({ code: "BAD_REQUEST", message: `kind must be ${step.pub.kind}` });
      if (b.kind === "mcq" && b.choice >= (step.pub.options?.length ?? 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "choice is out of range" });
      }
      const { answer, accepted } = step.secret;
      const correct =
        b.kind === "mcq" ? gradeMcq(b.choice, answer as number) : gradeCloze(b.text, answer as string, accepted ?? []);
      const out = await mutate(ctx.learnerId, step, { type: "attempt", correct }, b);
      if ("conflict" in out) throw conflict(out.conflict);
      await applyMastery(ctx.learnerId, out);
      return {
        attemptId: out.attemptId!,
        correct,
        feedback: correct ? "Correct!" : "Not quite.",
        // Same list the attempt row stores.
        missedConcepts: correct ? [] : missedOf(step),
        hintsUsed: out.progress.rungsTaken,
        state: out.progress.state,
        attemptAllowed: out.progress.attemptAllowed,
      };
    }),

  hint: protectedProcedure
    .input(Id)
    .output(Hint)
    .mutation(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const out = await mutate(ctx.learnerId, step, { type: "hint" }, null);
      if ("conflict" in out) throw conflict(out.conflict);
      return hintAt(step, out.progress.rungsTaken);
    }),

  skip: protectedProcedure
    .input(Id)
    .output(z.object({ state: z.literal("skipped") }))
    .mutation(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const out = await mutate(ctx.learnerId, step, { type: "skip" }, null);
      if ("conflict" in out) throw conflict(out.conflict);
      await applyMastery(ctx.learnerId, out);
      return { state: "skipped" as const };
    }),

  reveal: protectedProcedure
    .input(Id)
    .output(
      z.object({
        answer: z.discriminatedUnion("type", [
          z.object({ type: z.literal("mcq"), index: z.number() }),
          z.object({ type: z.literal("cloze"), text: z.string() }),
        ]),
        hunks: z.array(z.unknown()),
        explanations: z.object({ workedExample: z.string(), practice: z.string(), inferred: z.literal(true) }),
        narration: z.string(),
        source: z.object({ repo: z.string(), sha: z.string(), path: z.string() }).nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const { state } = await readProgress(ctx.learnerId, step.id);
      if (state !== "revealed" && state !== "skipped") throw conflict("Not revealed yet");
      const s = step.secret;
      return {
        answer:
          step.pub.kind === "mcq"
            ? { type: "mcq" as const, index: s.answer as number }
            : { type: "cloze" as const, text: s.answer as string },
        hunks: s.hunks,
        explanations: { ...s.explanations, inferred: true as const },
        narration: s.narration ?? s.explanations.workedExample,
        source: step.source,
      };
    }),
});
