import { z } from "zod";
import type { Block, BlockModule, Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import { MAX_BUCKETS, MAX_DRAG_ITEMS, MAX_SORT_CARDS } from "./drag.ts";
import { DIRS, MAX_GRID, MAX_GEMS, MAX_PROGRAM_STEPS, gridKind, simulate, type GridProps } from "./grid.ts";
import { physicsKind, type PhysicsProps } from "./physics.ts";
import { MAX_QUIZ_OPTIONS, MAX_QUIZ_QUESTIONS, MIN_QUIZ_OPTIONS, MIN_QUIZ_QUESTIONS } from "./quiz.ts";
import { gameSchema, kindOf, type GameProps } from "./schema.ts";
import { MAX_HINTS, shellFields, type ShellProps } from "./shell.ts";

export type PublicQuiz = { kind: "quiz"; questions: { prompt: string; options: string[] }[] };
export type PublicOrder = { kind: "order"; items: string[] };
export type PublicMatch = { kind: "match"; lefts: string[]; rights: string[] };
export type PublicSort = { kind: "sort"; buckets: string[]; cards: string[] };
export type PublicGridFrame = { x: number; y: number; dir: GridProps["start"]["dir"]; collected: number[] };
export type PublicGridProps = Omit<GridProps, "solution"> & { frames?: PublicGridFrame[] };
type PublicKind = PublicQuiz | PublicOrder | PublicMatch | PublicSort | PublicGridProps | PhysicsProps;
export type PublicGameProps = Omit<ShellProps, "hints"> & {
  hintCount: number;
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
  z.strictObject({
    kind: z.literal("grid"),
    size: gridKind.schema.shape.size,
    start: gridKind.schema.shape.start,
    goal: gridKind.schema.shape.goal,
    walls: gridKind.schema.shape.walls,
    gems: gridKind.schema.shape.gems,
    commands: gridKind.schema.shape.commands,
    allowRepeat: gridKind.schema.shape.allowRepeat,
    maxBlocks: gridKind.schema.shape.maxBlocks,
    mode: gridKind.schema.shape.mode,
    maxSteps: gridKind.schema.shape.maxSteps,
    starter: gridKind.schema.shape.starter,
    frames: z.array(z.strictObject({
      x: z.int().min(0).max(MAX_GRID - 1),
      y: z.int().min(0).max(MAX_GRID - 1),
      dir: z.enum(DIRS),
      collected: z.array(z.int().min(0).max(MAX_GEMS - 1)).max(MAX_GEMS),
    })).max(MAX_PROGRAM_STEPS).optional(),
  }),
  physicsKind.schema,
] as const;

const publicGameSchema = z.strictObject({
  title: shellFields.title,
  goalText: shellFields.goalText,
  alt: shellFields.alt,
  hintCount: z.int().min(0).max(MAX_HINTS),
  gameIndex: z.int().min(0).max(MAX_GAMES),
  shell: shellFields.shell,
  kind: z.discriminatedUnion("kind", publicKinds as unknown as [(typeof publicKinds)[number], ...(typeof publicKinds)[number][]]),
}) as unknown as z.ZodType<PublicGameProps>;

type Rng = () => number;

export function shuffled<T>(xs: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffledNot(xs: readonly string[], rng: Rng): string[] {
  const a = shuffled(xs, rng);
  return a.length > 1 && a.every((x, i) => x === xs[i]) ? [...a.slice(1), a[0]] : a;
}

function publicKind(k: GameProps["kind"], rng: Rng): PublicKind {
  switch (k.kind) {
    case "quiz": {
      const q = k;
      return { kind: "quiz", questions: q.questions.map((x) => ({ prompt: x.prompt, options: [...x.options] })) };
    }
    case "order":
      return { kind: "order", items: shuffledNot((k).items, rng) };
    case "match": {
      const m = k;
      return { kind: "match", lefts: shuffled(m.pairs.map((x) => x.left), rng), rights: shuffled(m.pairs.map((x) => x.right), rng) };
    }
    case "sort": {
      const s = k;
      return { kind: "sort", buckets: [...s.buckets], cards: shuffled(s.cards.map((c) => c.text), rng) };
    }
    case "physics": {
      const p = k;
      return { kind: "physics", target: { x: p.target.x, width: p.target.width }, maxSpeed: p.maxSpeed };
    }
    case "grid": {
      const g = k;
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
        ...(g.mode === "watch" && g.solution && { frames: simulate(g.solution, g).trace.map(({ x, y, dir, collected }) => ({ x, y, dir, collected: [...collected] })) }),
        ...(g.mode === "debug" && g.starter && { starter: g.starter }),
      };
    }
  }
}

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

export const gameBlocksOf = (doc: unknown): Block[] => {
  const blocks = (doc as { blocks?: unknown } | null)?.blocks;
  return Array.isArray(blocks) ? (blocks as Block[]).filter((b) => b?.type === "game") : [];
};

export const publicGameBlock: BlockModule<PublicGameProps> = {
  type: "game",
  schema: publicGameSchema,
  check: (b) => {
    const k = b.props.kind;
    if (k.kind !== "grid" && k.kind !== "physics") return [];
    const issues: Issue[] = kindOf(k).check(k);
    const solutionIsServerSide = (i: Issue) => k.kind === "grid" && i.path.startsWith("solution");
    return issues.filter((i) => !solutionIsServerSide(i)).map((i) => ({ path: `props.kind.${i.path}`, message: i.message }));
  },
  describe: (b) => `Game: ${b.props.title}. Goal: ${b.props.goalText} ${b.props.alt}`,
  prompt: "",
  budget: 2,
};
