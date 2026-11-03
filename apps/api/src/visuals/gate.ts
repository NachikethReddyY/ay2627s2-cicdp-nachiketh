import { parseSpec, type Spec } from "@learnquest/ui-catalog";

/** A lesson body is learner-facing text; its optional visual document is untrusted engine output. */
export type LearnPart = { body: string; doc?: Spec };

/**
 * Validate an engine supplied document at the persistence boundary. Invalid blocks are
 * dropped by the catalog parser; envelope failures drop the whole document. The text
 * body is always retained so a visual generation problem cannot lose lesson content.
 */
export function validatePart(input: unknown): LearnPart | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.body !== "string") return null;

  const result: LearnPart = { body: value.body };
  if (value.doc === undefined || value.doc === null) return result;

  const parsed = parseSpec(value.doc);
  if (parsed.ok) result.doc = parsed.spec;
  return result;
}
