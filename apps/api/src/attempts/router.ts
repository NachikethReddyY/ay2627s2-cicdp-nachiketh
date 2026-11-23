import { and, count, eq, max, ne, gte } from "drizzle-orm";
import { playableLesson, visibleWorld } from "../access.ts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db, type Db } from "../db/client.ts";
import { attempts, hintEvents, learners, lessons, lessonVersions, partCompletions, stepProgress, steps, worlds } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { containsAnswer } from "../ai/answer-leak.ts";
import { gradeCloze } from "../grading/cloze.ts";
import { gradeMcq } from "../grading/mcq.ts";
import { scrimGateOpen } from "../lessons/scrim.ts";
import { loadScrimGates } from "../lessons/scrim-gates.ts";
import { catchUpMastery, resolveConcepts } from "../progress/mastery.ts";
import { fresh, next, type Action, type Progress } from "./machine.ts";

const Id = z.object({ id: z.string().regex(/^[\w-]{1,64}$/) });
const State = z.enum(["predicting", "hinting", "revealed", "skipped"]);
const Hint = z.object({ rung: z.number(), text: z.string(), eliminate: z.number().optional() });
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mcq"), choice: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal("cloze"), text: z.string().max(200) }),
]);

const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Step not found" });
const predictSkip = () => new TRPCError({ code: "BAD_REQUEST", message: "Predict steps cannot be skipped. Answer the step to finish the lesson." });

async function mustStep(id: string, learnerId: string) {
  const step = await loadStep(id, learnerId);
  const reachable = step !== undefined && (step.lessonKind !== "scrim" || (await scrimGateReachable(step, learnerId)));
  if (!step || !reachable) throw notFound();
  if ((step.lessonKind === "learn" || step.lessonKind === "watch") && step.idx > 0 && !(await openingPredicted(db, learnerId, step)))
    throw conflict("Answer the opening prediction first");
  return step;
}

async function scrimGateReachable(step: { versionId: string; idx: number }, learnerId: string) {
  const { scrim, gates } = await loadScrimGates(step.versionId, learnerId);
  return scrimGateOpen(scrim, gates, step.idx);
}

async function loadStep(id: string, learnerId: string) {
  const [row] = await db
    .select({ id: steps.id, idx: steps.idx, lessonId: lessons.id, lessonKind: lessons.kind, assessment: lessons.assessment, versionId: steps.lessonVersionId, pub: steps.public, secret: steps.secret, source: lessons.source })
    .from(steps)
    .innerJoin(lessonVersions, eq(lessonVersions.id, steps.lessonVersionId))
    .innerJoin(lessons, eq(lessons.id, lessonVersions.lessonId))
    .innerJoin(worlds, eq(worlds.id, lessons.worldId))
    .innerJoin(learners, eq(learners.id, learnerId))
    .where(
      and(
        eq(steps.id, id),
        gte(steps.idx, 0),
        playableLesson(lessons),
        eq(lessons.currentVersionId, steps.lessonVersionId),
        visibleWorld(learners.userId, worlds),
      ),
    );
  return row;
}
type Step = NonNullable<Awaited<ReturnType<typeof loadStep>>>;

const missedOf = (step: Step) => {
  const answer = step.pub.kind === "mcq" ? step.pub.options?.[Number(step.secret.answer)] : String(step.secret.answer);
  const hidden = [answer, ...(step.secret.accepted ?? [])].filter((value): value is string => Boolean(value));
  return resolveConcepts(step.secret.concepts, `step ${step.id}`)
    .filter((concept) => !hidden.some((value) => containsAnswer(concept, value)));
};

const hintAt = (step: Step, rung: number) => {
  const h = step.secret.hints[rung - 1];
  const eliminate = step.pub.kind === "mcq" && rung === 1 ? h.eliminate : undefined;
  return { rung, text: h.text, ...(eliminate !== undefined && { eliminate }) };
};

const isReadLesson = (step: Step) => step.lessonKind === "learn" || step.lessonKind === "watch";

const recoverSkipped = (step: Step, p: Progress): Progress => {
  if (p.state !== "skipped") return p;
  if (step.lessonKind === "predict" || isReadLesson(step)) return { ...p, state: "predicting", attemptAllowed: true, retryAllowed: false };
  if (step.lessonKind === "scrim") return { ...p, state: "predicting" };
  return p;
};

async function readProgress(learnerId: string, step: Step): Promise<Progress> {
  const [p] = await db
    .select()
    .from(stepProgress)
    .where(and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, step.id)));
  return recoverSkipped(step, p ?? fresh());
}

const TRIES_BEFORE_ANSWER = 3;
const triesBeforeAnswer = (step: Step) => (isReadLesson(step) || step.lessonKind === "practice" ? TRIES_BEFORE_ANSWER : 0);

async function triesOf(tx: Db, learnerId: string, stepId: string) {
  const [row] = await tx
    .select({ made: count() })
    .from(attempts)
    .where(and(eq(attempts.learnerId, learnerId), eq(attempts.stepId, stepId), ne(attempts.kind, "skip")));
  return { made: row.made };
}

async function closesReadLesson(tx: Db, step: Step) {
  if (!isReadLesson(step)) return false;
  const [last] = await tx.select({ idx: max(steps.idx), total: count() }).from(steps).where(and(eq(steps.lessonVersionId, step.versionId), gte(steps.idx, 0)));
  return last?.total >= 2 && last.idx === step.idx;
}

async function openingPredicted(tx: Db, learnerId: string, step: Step) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(attempts)
    .innerJoin(steps, eq(steps.id, attempts.stepId))
    .where(
      and(
        eq(attempts.learnerId, learnerId),
        eq(steps.lessonVersionId, step.versionId),
        eq(steps.idx, 0),
        ne(attempts.kind, "skip"),
      ),
    );
  return n > 0;
}

function mutate(
  learnerId: string,
  step: Step,
  action: Action,
) {
  const stepId = step.id;
  return withTx(async (tx) => {
    await tx.insert(stepProgress).values({ learnerId, stepId }).onConflictDoNothing();
    const where = and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, stepId));
    const [p] = await tx.select().from(stepProgress).where(where).for("update");
    const { made } = await triesOf(tx, learnerId, stepId);
    const r = next(recoverSkipped(step, p), action, {
      oneTry: step.assessment !== null,
      hintCount: step.secret.hints.length,
      triesBeforeAnswer: triesBeforeAnswer(step),
      triesMade: made,
      correctFinishesEarly: step.lessonKind !== "practice",
    });
    if ("conflict" in r) return r;
    if (action.type === "attempt" && (await closesReadLesson(tx, step)) && step.idx > 0 && !(await openingPredicted(tx, learnerId, step))) {
      return { conflict: "Answer the opening prediction first" };
    }

    await tx.update(stepProgress).set({ ...r.progress, updatedAt: new Date() }).where(where);
    const o = r.outcome;
    let attemptId: string | undefined;
    let missedConcepts: string[] = [];
    let observedFirst = false;
    let hintsUsed = r.progress.rungsTaken;
    if (o.type === "hint") {
      await tx.insert(hintEvents).values({ learnerId, stepId, rung: o.rung });
    } else {
      const [guideHelp] = await tx.select({ rung: hintEvents.rung }).from(hintEvents)
        .where(and(eq(hintEvents.learnerId, learnerId), eq(hintEvents.stepId, stepId), eq(hintEvents.rung, 0)));
      hintsUsed = Math.max(hintsUsed, guideHelp ? 1 : 0);
      const [{ n }] = await tx
        .select({ n: count() })
        .from(attempts)
        .where(and(eq(attempts.learnerId, learnerId), eq(attempts.stepId, stepId)));
      const [row] = await tx
        .insert(attempts)
        .values({
          learnerId,
          stepId,
          kind: o.type === "skip" ? "skip" : step.pub.kind,
          observed: n === 0,
          correct: o.type === "skip" ? null : o.correct,
          hintsUsed,
          missedConcepts: o.type === "skip" || o.correct ? [] : missedOf(step),
        })
        .returning({ id: attempts.id, missedConcepts: attempts.missedConcepts });
      attemptId = row.id;
      missedConcepts = row.missedConcepts;
      observedFirst = n === 0;
      if (o.type === "attempt" && (await closesReadLesson(tx, step))) {
        await tx.insert(partCompletions).values({ learnerId, lessonId: step.lessonId }).onConflictDoNothing();
      }
    }
    return { ...r, attemptId, missedConcepts, hintsUsed, observed: attemptId !== undefined && observedFirst };
  });
}



export async function guideStep(learnerId: string, stepIds: string[]) {
  for (const id of stepIds) {
    const step = await mustStep(id, learnerId);
    const progress = await readProgress(learnerId, step);
    if (progress.state === "revealed" || progress.state === "skipped") continue;
    return {
      rung: Math.min(progress.rungsTaken + 1, step.secret.hints.length),
      task: step.pub.prompt,
      answers: step.pub.kind === "mcq" ? [step.pub.options?.[Number(step.secret.answer)] ?? ""] : [String(step.secret.answer), ...(step.secret.accepted ?? [])],
      record: async () => {
        if (step.secret.hints.length > 0) {
          await mutate(learnerId, step, { type: "hint" });
          return;
        }
        await withTx(async (tx) => {
          await tx.insert(stepProgress).values({ learnerId, stepId: id }).onConflictDoNothing();
          const [current] = await tx.select().from(stepProgress)
            .where(and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, id))).for("update");
          if (current.state !== "revealed" && current.state !== "skipped")
            await tx.insert(hintEvents).values({ learnerId, stepId: id, rung: 0 }).onConflictDoNothing();
        });
      },
    };
  }
  return null;
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
      const p = await readProgress(ctx.learnerId, step);
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
      const out = await mutate(ctx.learnerId, step, { type: "attempt", correct });
      if ("conflict" in out) throw conflict(out.conflict);
      if (out.observed && !step.assessment) await catchUpMastery(ctx.learnerId);
      return {
        attemptId: out.attemptId!,
        correct,
        feedback: correct ? (out.progress.state === "revealed" ? "Correct!" : "Correct! Try again to unlock the explanation.") : "Not quite.",
        missedConcepts: out.missedConcepts,
        hintsUsed: out.hintsUsed,
        state: out.progress.state,
        attemptAllowed: out.progress.attemptAllowed,
      };
    }),

  hint: protectedProcedure
    .input(Id)
    .output(Hint)
    .mutation(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      const out = await mutate(ctx.learnerId, step, { type: "hint" });
      if ("conflict" in out) throw conflict(out.conflict);
      return hintAt(step, out.progress.rungsTaken);
    }),

  skip: protectedProcedure
    .input(Id)
    .output(z.object({ state: z.literal("skipped") }))
    .mutation(async ({ ctx, input }) => {
      const step = await mustStep(input.id, ctx.learnerId);
      if (step.lessonKind === "predict") throw predictSkip();
      if (isReadLesson(step) || step.lessonKind === "scrim") throw conflict("This check cannot be skipped");
      const out = await mutate(ctx.learnerId, step, { type: "skip" });
      if ("conflict" in out) throw conflict(out.conflict);
      if (out.observed) await catchUpMastery(ctx.learnerId);
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
      if (isReadLesson(step)) throw conflict("Watch the lesson to see the answer");
      const { state } = await readProgress(ctx.learnerId, step);
      if (state !== "revealed" && state !== "skipped") throw conflict("Not revealed yet");
      const { made } = await triesOf(db, ctx.learnerId, step.id);
      if (made < triesBeforeAnswer(step)) throw conflict(`Try at least ${triesBeforeAnswer(step)} times to see the answer`);
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
