import { assign, setup } from "xstate";

export type Hint = { rung: number; text: string; eliminate?: number };
export type StepState = "predicting" | "hinting" | "revealed" | "skipped";

export type StepPublic = {
  id: string;
  idx: number;
  title: string;
  prompt: string;
  kind: "mcq" | "cloze";
  options?: string[];
  hintCount: number;
  state: StepState;
  rungsTaken: number;
  attemptAllowed: boolean;
  hints: Hint[];
  beforeFiles: Record<string, string>;
};

export type Reveal = {
  answer: { type: "mcq"; index: number } | { type: "cloze"; text: string };
  // Same shape as player-core's Hunk; defined here so this file stays import-free for node --test.
  hunks: { id: string; file: string; oldStart: number; lines: string[] }[];
  explanations: { workedExample: string; practice: string; inferred: true };
  source: { repo: string; sha: string; path: string } | null; // null for AI lessons
};

export type AttemptResult = {
  attemptId: string;
  correct: boolean;
  feedback: string;
  missedConcepts: string[];
  hintsUsed: number;
  state: StepState;
  attemptAllowed: boolean;
};

type Context = {
  lessonSteps: number;
  idx: number;
  step: StepPublic | null;
  hints: Hint[];
  attemptAllowed: boolean;
  feedback: string | null;
  lastCorrect: boolean | null;
  reveal: Reveal | null;
  notice: string | null;
};

type Event =
  | { type: "LOADED"; step: StepPublic }
  | { type: "RESULT"; r: AttemptResult }
  | { type: "HINT"; hint: Hint }
  | { type: "SKIPPED" }
  | { type: "CONFLICT"; msg: string }
  | { type: "REVEAL_LOADED"; reveal: Reveal }
  | { type: "NEXT" };

const stepReset: Omit<Context, "lessonSteps" | "idx"> = {
  step: null,
  hints: [],
  attemptAllowed: true,
  feedback: null,
  lastCorrect: null,
  reveal: null,
  notice: null,
};

const gated = {
  RESULT: [
    {
      guard: ({ event }: { event: { r: AttemptResult } }) => event.r.state === "revealed",
      target: "revealed",
      actions: "storeResult",
    },
    { target: "hinting", actions: "storeResult" },
  ],
  HINT: { target: "hinting", actions: "addHint" },
  SKIPPED: "skipped",
  CONFLICT: { target: "browse", actions: "setNotice" },
} as const;

const done = {
  REVEAL_LOADED: { actions: "storeReveal" },
  NEXT: [
    { guard: "hasNext", target: "browse", actions: "advance" },
    { target: "finished" },
  ],
} as const;

export const stepMachine = setup({
  types: {
    context: {} as Context,
    events: {} as Event,
    input: {} as { lessonSteps: number; idx?: number },
  },
  guards: {
    hasNext: ({ context }) => context.idx + 1 < context.lessonSteps,
    isState: ({ event }, p: { s: StepState }) => event.type === "LOADED" && event.step.state === p.s,
  },
  actions: {
    storeLoaded: assign(({ event }) =>
      event.type === "LOADED"
        ? { step: event.step, hints: event.step.hints, attemptAllowed: event.step.attemptAllowed }
        : {},
    ),
    storeResult: assign(({ event }) =>
      event.type === "RESULT"
        ? { feedback: event.r.feedback, lastCorrect: event.r.correct, attemptAllowed: event.r.attemptAllowed, notice: null }
        : {},
    ),
    addHint: assign(({ context, event }) =>
      event.type === "HINT" ? { hints: [...context.hints, event.hint], attemptAllowed: true, notice: null } : {},
    ),
    storeReveal: assign(({ event }) => (event.type === "REVEAL_LOADED" ? { reveal: event.reveal } : {})),
    setNotice: assign(({ event }) => (event.type === "CONFLICT" ? { notice: event.msg } : {})),
    advance: assign(({ context }) => ({ ...stepReset, idx: context.idx + 1 })),
  },
}).createMachine({
  id: "step",
  context: ({ input }) => ({ ...stepReset, lessonSteps: input.lessonSteps, idx: input.idx ?? 0 }),
  initial: "browse",
  states: {
    browse: {
      on: {
        LOADED: [
          { guard: { type: "isState", params: { s: "predicting" } }, target: "predicting", actions: "storeLoaded" },
          { guard: { type: "isState", params: { s: "hinting" } }, target: "hinting", actions: "storeLoaded" },
          { guard: { type: "isState", params: { s: "revealed" } }, target: "revealed", actions: "storeLoaded" },
          { guard: { type: "isState", params: { s: "skipped" } }, target: "skipped", actions: "storeLoaded" },
          { target: "predicting", actions: "storeLoaded" }, // an unknown state must not leave the step loading forever
        ],
      },
    },
    predicting: { on: gated },
    hinting: { on: gated },
    revealed: { on: done },
    skipped: { on: done },
    finished: { type: "final" },
  },
});

type Snap = { value: unknown; context: Context };

export const canSubmit = (s: Snap) => s.value === "predicting" || (s.value === "hinting" && s.context.attemptAllowed);
export const canHint = (s: Snap) =>
  (s.value === "predicting" || s.value === "hinting") &&
  !!s.context.step &&
  s.context.hints.length < s.context.step.hintCount;
export const canSkip = (s: Snap) => s.value === "predicting" || s.value === "hinting";
