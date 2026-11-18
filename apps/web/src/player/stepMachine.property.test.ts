import test from "node:test";
import assert from "node:assert/strict";
import { createActor } from "xstate";
import {
  stepMachine,
  canSubmit,
  canHint,
  canSkip,
  type AttemptResult,
  type Reveal,
  type StepPublic,
  type StepState,
} from "./stepMachine.ts";

type Action =
  | { type: "LOADED"; state: StepState | "unknown"; hintsOnLoad: number; hintCount: number; attemptAllowed: boolean }
  | { type: "RESULT"; correct: boolean; revealed: boolean; attemptAllowed: boolean }
  | { type: "HINT" }
  | { type: "SKIPPED" }
  | { type: "CONFLICT" }
  | { type: "REVEAL_LOADED" }
  | { type: "NEXT" };

type Value = "browse" | StepState | "finished";

const RUNS = 400;
const MAX_LENGTH = 40;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)];
}

function randomAction(rand: () => number): Action {
  const kind = pick(rand, ["LOADED", "LOADED", "RESULT", "RESULT", "HINT", "HINT", "SKIPPED", "CONFLICT", "REVEAL_LOADED", "NEXT", "NEXT"] as const);
  switch (kind) {
    case "LOADED":
      return {
        type: "LOADED",
        state: pick(rand, ["predicting", "hinting", "revealed", "skipped", "unknown"] as const),
        hintsOnLoad: Math.floor(rand() * 3),
        hintCount: 1 + Math.floor(rand() * 4),
        attemptAllowed: rand() < 0.5,
      };
    case "RESULT":
      return { type: "RESULT", correct: rand() < 0.5, revealed: rand() < 0.4, attemptAllowed: rand() < 0.5 };
    default:
      return { type: kind };
  }
}

function randomSequence(rand: () => number): Action[] {
  const length = 1 + Math.floor(rand() * MAX_LENGTH);
  return Array.from({ length }, () => randomAction(rand));
}

const reveal: Reveal = {
  answer: { type: "mcq", index: 0 },
  hunks: [],
  explanations: { workedExample: "w", practice: "p", inferred: true },
  narration: "w",
  source: null,
};

function stepFor(a: Extract<Action, { type: "LOADED" }>): StepPublic {
  return {
    id: "s",
    idx: 0,
    title: "t",
    prompt: "p",
    kind: "mcq",
    options: ["a", "b"],
    hintCount: a.hintCount,
    state: a.state as StepState,
    rungsTaken: a.hintsOnLoad,
    attemptAllowed: a.attemptAllowed,
    hints: Array.from({ length: a.hintsOnLoad }, (_, i) => ({ rung: i + 1, text: `h${i + 1}` })),
    beforeFiles: {},
  };
}

function toEvent(a: Action, nextRung: number) {
  switch (a.type) {
    case "LOADED":
      return { type: "LOADED" as const, step: stepFor(a) };
    case "RESULT": {
      const r: AttemptResult = {
        attemptId: "a",
        correct: a.correct,
        feedback: "f",
        missedConcepts: [],
        hintsUsed: 0,
        state: a.revealed ? "revealed" : "hinting",
        attemptAllowed: a.attemptAllowed,
      };
      return { type: "RESULT" as const, r };
    }
    case "HINT":
      return { type: "HINT" as const, hint: { rung: nextRung, text: `h${nextRung}` } };
    case "SKIPPED":
      return { type: "SKIPPED" as const };
    case "CONFLICT":
      return { type: "CONFLICT" as const, msg: "conflict" };
    case "REVEAL_LOADED":
      return { type: "REVEAL_LOADED" as const, reveal };
    case "NEXT":
      return { type: "NEXT" as const };
  }
}

type Model = { value: Value; idx: number };

function modelStep(m: Model, a: Action, lessonSteps: number): Model {
  const inStep = m.value === "predicting" || m.value === "hinting";
  if (m.value === "browse" && a.type === "LOADED") {
    return { ...m, value: a.state === "unknown" ? "predicting" : a.state };
  }
  if (inStep) {
    if (a.type === "RESULT") return { ...m, value: a.revealed ? "revealed" : "hinting" };
    if (a.type === "HINT") return { ...m, value: "hinting" };
    if (a.type === "SKIPPED") return { ...m, value: "skipped" };
    if (a.type === "CONFLICT") return { ...m, value: "browse" };
  }
  if ((m.value === "revealed" || m.value === "skipped") && a.type === "NEXT") {
    return m.idx + 1 < lessonSteps ? { value: "browse", idx: m.idx + 1 } : { ...m, value: "finished" };
  }
  return m;
}

type Violation = { property: string; detail: string };

function runSequence(seq: Action[], lessonSteps: number, startIdx: number): Violation | null {
  const actor = createActor(stepMachine, { input: { lessonSteps, idx: startIdx } }).start();
  let model: Model = { value: "browse", idx: startIdx };

  for (const a of seq) {
    const before = actor.getSnapshot();
    const beforeValue = before.value as Value;
    const rung = before.context.hints.length + 1;
    actor.send(toEvent(a, rung));
    const after = actor.getSnapshot();
    const afterValue = after.value as Value;
    model = modelStep(model, a, lessonSteps);

    if (afterValue !== model.value || after.context.idx !== model.idx) {
      return { property: "machine agrees with reference model", detail: `${beforeValue} --${a.type}--> ${afterValue}, model says ${model.value}` };
    }

    const reachedRevealedThisStep = afterValue === "revealed" && beforeValue !== "revealed";
    if (reachedRevealedThisStep) {
      const viaSubmission = a.type === "RESULT" && a.revealed && (beforeValue === "predicting" || beforeValue === "hinting");
      const viaServerRestore = a.type === "LOADED" && a.state === "revealed" && beforeValue === "browse";
      if (!viaSubmission && !viaServerRestore) {
        return { property: "predict before reveal", detail: `${beforeValue} --${a.type}--> revealed without a submitted prediction` };
      }
    }

    if ((afterValue === "predicting" || afterValue === "hinting") && after.context.reveal !== null) {
      return { property: "predict before reveal", detail: `reveal stored while ${afterValue}` };
    }
    if (afterValue === "browse" && after.context.reveal !== null && after.context.step !== null) {
      return { property: "predict before reveal", detail: "reveal stored while a step is loading" };
    }

    if (afterValue === "revealed" || afterValue === "skipped" || afterValue === "finished") {
      if (canSubmit(after) || canHint(after) || canSkip(after)) {
        return { property: "terminal step offers no actions", detail: `${afterValue} still allows submit, hint or skip` };
      }
    }

    const staysInStep = (beforeValue === "predicting" || beforeValue === "hinting") && (afterValue === "predicting" || afterValue === "hinting");
    if (staysInStep) {
      if (after.context.hints.length < before.context.hints.length) {
        return { property: "hints only advance", detail: `hints went from ${before.context.hints.length} to ${after.context.hints.length}` };
      }
      const rungs = after.context.hints.map((h) => h.rung);
      const ascending = rungs.every((r, i) => i === 0 || r > rungs[i - 1]);
      if (!ascending && before.context.hints.length === 0 && a.type === "HINT") {
        return { property: "hints only advance", detail: `rungs ${rungs.join(",")} not ascending` };
      }
    }

    if (beforeValue === "finished" && (afterValue !== "finished" || after.context !== before.context)) {
      return { property: "finished stays terminal", detail: `${a.type} changed a finished machine` };
    }

    if ((beforeValue === "revealed" || beforeValue === "skipped") && afterValue !== beforeValue) {
      const leftByNext = a.type === "NEXT";
      if (!leftByNext) return { property: "revealed and skipped stay terminal", detail: `${beforeValue} --${a.type}--> ${afterValue}` };
      if (afterValue === "browse" && after.context.hints.length !== 0) {
        return { property: "next step starts clean", detail: "hints survived NEXT" };
      }
    }
  }
  return null;
}

function shrink(seq: Action[], lessonSteps: number, startIdx: number, property: string): Action[] {
  let current = seq;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.length; i++) {
      const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
      const v = candidate.length > 0 ? runSequence(candidate, lessonSteps, startIdx) : null;
      if (v && v.property === property) {
        current = candidate;
        improved = true;
        break;
      }
    }
  }
  return current;
}

test("random action sequences keep every step machine property", () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const rand = mulberry32(seed);
    const lessonSteps = 1 + Math.floor(rand() * 3);
    const startIdx = Math.floor(rand() * lessonSteps);
    const seq = randomSequence(rand);
    const violation = runSequence(seq, lessonSteps, startIdx);
    if (violation) {
      const small = shrink(seq, lessonSteps, startIdx, violation.property);
      assert.fail(`${violation.property}: ${violation.detail}\nseed ${seed}, lessonSteps ${lessonSteps}, idx ${startIdx}\nshrunk: ${JSON.stringify(small)}`);
    }
  }
});

test("a fresh machine can never be revealed before a prediction is submitted", () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const rand = mulberry32(seed);
    const actor = createActor(stepMachine, { input: { lessonSteps: 3 } }).start();
    actor.send(toEvent({ type: "LOADED", state: "predicting", hintsOnLoad: 0, hintCount: 3, attemptAllowed: true }, 1));
    const nonSubmitting = ["HINT", "SKIPPED", "CONFLICT", "REVEAL_LOADED", "NEXT"] as const;
    for (let i = 0; i < 20; i++) {
      const a: Action = { type: pick(rand, nonSubmitting) };
      actor.send(toEvent(a, actor.getSnapshot().context.hints.length + 1));
      assert.notEqual(actor.getSnapshot().value, "revealed", `seed ${seed}: revealed after ${a.type} with no submission`);
    }
  }
});
