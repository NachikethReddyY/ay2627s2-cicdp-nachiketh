import { z } from "zod";
import type { SpokenWord } from "./transcribe.ts";

export const CuedEdit = z.object({
  segment: z.number().int().min(0).max(11),
  cue: z.string().min(1).max(200),
  predict: z.string().min(1).max(200).nullish(),
  code: z.string().min(1).max(4000),
  run: z.boolean().default(false),
});

export type CuedEdit = z.infer<typeof CuedEdit>;

export type TimedEdit = {
  segment: number;
  at: number;
  cueHeard: boolean;
  cue: string;
  predict: string | null;
  code: string;
  run: boolean;
};

type Token = { word: string; start: number };

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const asDigits = (token: string): string => {
  const n = NUMBER_WORDS.indexOf(token);
  return n >= 0 ? String(n) : token;
};

export const spokenTokens = (text: string): string[] =>
  (text.toLowerCase().replace(/\u2019/g, "'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? []).map(asDigits);

function heardTokens(words: readonly SpokenWord[]): Token[] {
  return words.flatMap((word) => spokenTokens(word.text).map((token) => ({ word: token, start: word.start })));
}

const CLOSE_CUE_WORDS = 3;

function mismatches(tokens: readonly Token[], cue: readonly string[], at: number): number {
  return cue.filter((word, k) => tokens[at + k].word !== word).length;
}

function find(tokens: readonly Token[], cue: readonly string[], from: number): number {
  const starts = Array.from({ length: Math.max(0, tokens.length - cue.length - from + 1) }, (_, k) => from + k);
  const exact = starts.find((at) => mismatches(tokens, cue, at) === 0);
  if (exact !== undefined || cue.length < CLOSE_CUE_WORDS) return exact ?? -1;
  return starts.find((at) => tokens[at].word === cue[0] && mismatches(tokens, cue, at) === 1) ?? -1;
}

function estimate(script: string, cue: readonly string[], words: readonly SpokenWord[]): number {
  const written = spokenTokens(script);
  const first = cue.length > 0 ? written.findIndex((_, i) => cue.every((word, k) => written[i + k] === word)) : -1;
  if (first < 0 || written.length === 0) return 0;
  return (first / written.length) * (words.at(-1)?.end ?? 0);
}

export function placeEdits(
  edits: readonly CuedEdit[],
  transcripts: readonly (readonly SpokenWord[])[],
  scripts: readonly string[] = [],
): TimedEdit[] {
  const cursors = new Map<number, { next: number; at: number }>();
  return edits.map((edit) => {
    const words = transcripts[edit.segment] ?? [];
    const tokens = heardTokens(words);
    const cursor = cursors.get(edit.segment) ?? { next: 0, at: 0 };
    const cue = spokenTokens(edit.cue);
    const index = cue.length > 0 ? find(tokens, cue, cursor.next) : -1;
    const cueHeard = index >= 0;
    const at = Math.max(cueHeard ? tokens[index].start : estimate(scripts[edit.segment] ?? "", cue, words), cursor.at);
    cursors.set(edit.segment, { next: cueHeard ? index + cue.length : cursor.next, at });
    return { segment: edit.segment, at, cueHeard, cue: edit.cue, predict: edit.predict ?? null, code: edit.code, run: edit.run };
  });
}
