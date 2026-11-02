import { z } from "zod";
import type { Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";

export const MAX_HINTS = 3;
export const MAX_LIVES = 5;
export const MAX_GAME_ALT = 400;

/** Props every game shares, whatever its kind. */
export const shellFields = {
  title: text(60),
  goalText: text(200),
  /** Says how to play and what the game teaches; it is the fallback when the game cannot run. */
  alt: text(MAX_GAME_ALT),
  hints: z.array(text(160)).max(MAX_HINTS),
  shell: z.strictObject({ lives: z.int().min(1).max(MAX_LIVES).optional() }),
};

export type ShellProps = { title: string; goalText: string; alt: string; hints: string[]; shell: { lives?: number } };

/**
 * One game kind. `schema` is a z.strictObject whose `kind` is a literal (the discriminator).
 * `check` and `describe` get the kind object; check paths are relative to it, e.g. "walls.0".
 */
export type GameKind<P extends { kind: string }> = {
  schema: z.ZodObject<{ kind: z.ZodLiteral<P["kind"]> } & z.ZodRawShape, z.core.$strict>;
  check: (props: P) => Issue[];
  describe: (props: P) => string;
};
