import { z } from "zod";
import type { Block, BlockModule, Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import { MAX_BUCKETS, MAX_DRAG_ITEMS, MAX_SORT_CARDS, type MatchProps, type OrderProps, type SortProps } from "./drag.ts";
import { gridKind, type GridProps } from "./grid.ts";
import { physicsKind, type PhysicsProps } from "./physics.ts";
import { MAX_QUIZ_OPTIONS, MAX_QUIZ_QUESTIONS, MIN_QUIZ_OPTIONS, MIN_QUIZ_QUESTIONS, type QuizProps } from "./quiz.ts";
import { gameSchema, kindOf, type GameProps } from "./schema.ts";
import { MAX_HINTS, shellFields, type ShellProps } from "./shell.ts";

/**
 * The client-safe shape of a game: everything the learner may see and nothing that reveals an answer.
 * Answers, hints and the right order/pairing/buckets stay on the server (games.check, games.hint).
 */
export type PublicQuiz = { kind: "quiz"; questions: { prompt: string; options: string[] }[] };
export type PublicOrder = { kind: "order"; items: string[] };
export type PublicMatch = { kind: "match"; lefts: string[]; rights: string[] };
export type PublicSort = { kind: "sort"; buckets: string[]; cards: string[] };
export type PublicKind = PublicQuiz | PublicOrder | PublicMatch | PublicSort | GridProps | PhysicsProps;
export type PublicGameProps = Omit<ShellProps, "hints"> & {
  /** How many hints games.hint can return for this game. */
  hintCount: number;
  /** Position of this game among the doc's game blocks; the handle for games.hint and games.check. */
  gameIndex: number;
  kind: PublicKind;
};

const MAX_GAMES = 100;

const publicKinds = [
  z.strictObject({
    kind: z.literal("quiz"),
    questions: z
      .array(z.strictObject({ prompt: text(240), options: z.array(text(120)).min(MIN_QUIZ_OPTIONS).max(MAX_QUIZ_OPTIONS) }))
      .min(MIN_QUIZ_QUESTIONS)
      .max(MAX_QUIZ_QUESTIONS),
  }),
  z.strictObject({ kind: z.literal("order"), items: z.array(text(60)).min(2).max(MAX_DRAG_ITEMS) }),
  z.strictObject({ kind: z.literal("match"), lefts: z.array(text(60)).min(2).max(MAX_DRAG_ITEMS), rights: z.array(text(60)).min(2).max(MAX_DRAG_ITEMS) }),
  z.strictObject({ kind: z.literal("sort"), buckets: z.array(text(40)).min(2).max(MAX_BUCKETS), cards: z.array(text(60)).min(2).max(MAX_SORT_CARDS) }),
  // Grid and physics reveal nothing the board does not already show; grid's `solution` is only ever sent in watch mode.
  gridKind.schema,
  physicsKind.schema,
] as const;

export const publicGameSchema = z.strictObject({
  title: shellFields.title,
  goalText: shellFields.goalText,
  alt: shellFields.alt,
  hintCount: z.int().min(0).max(MAX_HINTS),
  gameIndex: z.int().min(0).max(MAX_GAMES),
  shell: shellFields.shell,
  kind: z.discriminatedUnion("kind", publicKinds as unknown as [(typeof publicKinds)[number], ...(typeof publicKinds)[number][]]),
}) as unknown as z.ZodType<PublicGameProps>;

export type Rng = () => number;

/** Fisher-Yates, returns a copy. */
export function shuffled<T>(xs: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Shuffles, but never hands back the original order (rotates by one if the shuffle landed on it). */
function shuffledNot(xs: readonly string[], rng: Rng): string[] {
  const a = shuffled(xs, rng);
  return a.length > 1 && a.every((x, i) => x === xs[i]) ? [...a.slice(1), a[0]!] : a;
}

function publicKind(k: GameProps["kind"], rng: Rng): PublicKind {
  // Every kind is built field by field from an allowlist: a field added to a kind later is not sent until it is listed here.
  switch (k.kind) {
    case "quiz": {
      const q = k as QuizProps;
      return { kind: "quiz", questions: q.questions.map((x) => ({ prompt: x.prompt, options: [...x.options] })) };
    }
    case "order":
      return { kind: "order", items: shuffledNot((k as OrderProps).items, rng) };
    case "match": {
      const m = k as MatchProps;
      return { kind: "match", lefts: shuffled(m.pairs.map((x) => x.left), rng), rights: shuffled(m.pairs.map((x) => x.right), rng) };
    }
    case "sort": {
      const s = k as SortProps;
      return { kind: "sort", buckets: [...s.buckets], cards: shuffled(s.cards.map((c) => c.text), rng) };
    }
    case "physics": {
      const p = k as PhysicsProps;
      return { kind: "physics", target: { x: p.target.x, width: p.target.width }, maxSpeed: p.maxSpeed };
    }
    case "grid": {
      const g = k as GridProps;
      return {
        kind: "grid",
        size: { w: g.size.w, h: g.size.h },
        start: { x: g.start.x, y: g.start.y, dir: g.start.dir },
        goal: { x: g.goal.x, y: g.goal.y },
        walls: g.walls.map((c) => ({ x: c.x, y: c.y })),
        gems: g.gems.map((c) => ({ x: c.x, y: c.y })),
        commands: [...g.commands],
        ...(g.allowRepeat && { allowRepeat: { maxTimes: g.allowRepeat.maxTimes, maxBody: g.allowRepeat.maxBody } }),
        ...(g.maxBlocks !== undefined && { maxBlocks: g.maxBlocks }),
        mode: g.mode,
        maxSteps: g.maxSteps,
        // Watch mode replays the solution on screen by design, so it is the one place it is sent.
        ...(g.mode === "watch" && g.solution && { solution: g.solution }),
        ...(g.mode === "debug" && g.starter && { starter: g.starter }),
      };
    }
  }
}

/** The allowlisted client view of one game's props. `gameIndex` is its position among the doc's games. */
export function toPublicGame(p: GameProps, gameIndex: number, rng: Rng = Math.random): PublicGameProps {
  return {
    title: p.title,
    goalText: p.goalText,
    alt: p.alt,
    hintCount: p.hints.length,
    gameIndex,
    shell: p.shell.lives === undefined ? {} : { lives: p.shell.lives },
    kind: publicKind(p.kind, rng),
  };
}

/**
 * Rewrites a visual doc for the client: every game block becomes its public form; other blocks pass through.
 * A game block that does not validate is dropped rather than sent as it is.
 */
export function publicDoc(doc: unknown, rng: Rng = Math.random): unknown {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return doc;
  let n = 0;
  const out: unknown[] = [];
  for (const b of blocks as Block[]) {
    if (b?.type !== "game") {
      out.push(b);
      continue;
    }
    const idx = n++;
    const parsed = gameSchema.safeParse(b.props);
    if (parsed.success) out.push({ type: "game", id: b.id, props: toPublicGame(parsed.data, idx, rng) });
  }
  return { ...(doc as object), blocks: out };
}

/** The game blocks of a doc, in order. Their position here is `gameIndex`. */
export const gameBlocksOf = (doc: unknown): Block[] => {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? (blocks as Block[]).filter((b) => b?.type === "game") : [];
};

/** The block module the web app parses with: the same envelope as gameBlock, over the public props. */
export const publicGameBlock: BlockModule<PublicGameProps> = {
  type: "game",
  schema: publicGameSchema,
  check: (b) => {
    const k = b.props.kind;
    if (k.kind !== "grid" && k.kind !== "physics") return [];
    const issues: Issue[] = kindOf(k).check(k);
    // The solution is withheld outside watch mode, so the checks that need it cannot apply.
    const needsSolution = (i: Issue) => k.kind === "grid" && k.mode !== "watch" && i.path.startsWith("solution");
    return issues.filter((i) => !needsSolution(i)).map((i) => ({ path: `props.kind.${i.path}`, message: i.message }));
  },
  describe: (b) => `Game: ${b.props.title}. Goal: ${b.props.goalText} ${b.props.alt}`,
  prompt: "",
  budget: 2,
};
