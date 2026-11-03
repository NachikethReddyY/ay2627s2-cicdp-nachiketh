import { z } from "zod";
import { gridKind } from "./grid.ts";
import { physicsKind } from "./physics.ts";
import { quizKind } from "./quiz.ts";
import { matchKind, orderKind, sortKind } from "./drag.ts";
import { shellFields, type GameKind, type ShellProps } from "./shell.ts";

/** Registered game kinds. A new kind (order, match, sort, physics, quiz) is one module and one entry here. */
export const GAME_KINDS = { grid: gridKind, order: orderKind, match: matchKind, sort: sortKind, physics: physicsKind, quiz: quizKind } as const;

type Kinds = typeof GAME_KINDS;
/** The `kind` object of a game: a union discriminated on its own `kind` field. */
export type GameKindProps = { [K in keyof Kinds]: Kinds[K] extends GameKind<infer P> ? P : never }[keyof Kinds];
export type GameProps = ShellProps & { kind: GameKindProps };

const kinds = Object.values(GAME_KINDS).map((k) => k.schema);

export const gameSchema = z.strictObject({
  ...shellFields,
  kind: z.discriminatedUnion("kind", kinds as [(typeof kinds)[number], ...typeof kinds]),
}) as unknown as z.ZodType<GameProps>;

/** The module for a kind object; its type is widened so callers need not narrow the union first. */
export const kindOf = (k: GameKindProps) => GAME_KINDS[k.kind] as GameKind<GameKindProps>;
