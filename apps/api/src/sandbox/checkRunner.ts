import { z } from "zod";
import type { PracticeLanguage, PracticeTest } from "../parts/practice-schema.ts";

export const BUDGET_S = 32;
export const MAX_HARNESS_OUTPUT = 800_000;

export type RawResult = { exit: number | null; timedOut: boolean; overflow: boolean; stdout: string; stderr: string };
export class CheckUnavailableError extends Error {}

const RawSchema = z.object({
  token: z.string(),
  results: z.array(z.object({ exit: z.number().int().nullable(), timedOut: z.boolean(), overflow: z.boolean(), stdout: z.string(), stderr: z.string() })),
});

export function encodeCheckInput(token: string, language: PracticeLanguage, code: string, tests: PracticeTest[]) {
  return JSON.stringify({ token, language, code, tests: tests.map(({ stdin }) => ({ stdin })) });
}

export function readCheckResults(output: string, exitCode: number | null | undefined, token: string, count: number): RawResult[] {
  try {
    if (exitCode !== 0 || output.length > MAX_HARNESS_OUTPUT) throw new Error("exit or output limit");
    const line = output.trimEnd().split("\n").at(-1);
    const parsed = RawSchema.parse(JSON.parse(line ?? ""));
    if (parsed.token !== token || parsed.results.length !== count) throw new Error("unexpected results");
    return parsed.results;
  } catch {
    throw new CheckUnavailableError("bad harness output");
  }
}
