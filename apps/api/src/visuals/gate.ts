import { z } from "zod";
import { parseSpec } from "@learnquest/ui-catalog";
import { buildTimeline, seek } from "@learnquest/player-core";
import { PracticeContent } from "../parts/practice-schema.ts";
import type { PartSecret } from "../db/schema.ts";

// Every lesson part from the engine or the model passes through here before it is stored.
// Its output is untrusted, so this is the one place that decides what is kept.

const text = (max: number) => z.string().trim().min(1).max(max);
const Hunk = z.object({ id: text(40), file: text(200), oldStart: z.number().int().min(1), lines: z.array(z.string().max(300)).min(1).max(60) });
const Part = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("learn"), body: text(4000), doc: z.unknown().optional() }),
  z.object({
    kind: z.literal("watch"),
    beforeFiles: z.record(text(200), z.string().max(6000)).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 4),
    hunks: z.array(Hunk).min(1).max(6),
  }),
  PracticeContent,
  z.object({ kind: z.literal("game-practice"), intro: text(500), doc: z.unknown() }),
]);

// shortcut: catches a cut-off body by its unclosed code fence or inline backtick, not every truncation; a retry covers the rest.
function checkBody(body: string) {
  const fences = body.match(/```/g)?.length ?? 0;
  const inline = body.replace(/```[\s\S]*?```/g, "").match(/`/g)?.length ?? 0;
  if (fences % 2 || inline % 2) throw new Error("learn part looks truncated");
  // A model that loops repeats a few words over and over; real prose has many distinct words.
  const words = body.split(/\s+/);
  if (words.length > 40 && new Set(words).size / words.length < 0.3) throw new Error("learn part is repetitive");
}

// Only the server writes "generated" / "generated-pending" images; a model-written one could point at any URL.
const dropClientImages = <T extends { blocks: Array<{ type: string; props?: unknown }> }>(spec: T): T => ({
  ...spec,
  blocks: spec.blocks.filter((b) => !(b.type === "image" && ["generated", "generated-pending"].includes((b.props as { source?: string } | undefined)?.source ?? ""))),
});

/**
 * Validates one generated part and returns the exact content to store. Throws when the part cannot be used,
 * so the caller can retry. A learn part's visual is optional: an invalid one is dropped and the text is kept.
 */
export function validatePart(raw: unknown): PartSecret {
  const part = Part.parse(raw);
  switch (part.kind) {
    case "learn": {
      checkBody(part.body);
      const parsed = part.doc === undefined ? null : parseSpec(part.doc);
      if (!parsed?.ok) return { kind: "learn", body: part.body };
      return { kind: "learn", body: part.body, doc: dropClientImages(parsed.spec) };
    }
    case "watch": {
      const tl = buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]); // throws when a hunk does not match its file
      if (JSON.stringify(seek(tl, tl.duration).files) === JSON.stringify(part.beforeFiles)) throw new Error("watch part changes nothing");
      return { kind: "watch", beforeFiles: part.beforeFiles, hunks: part.hunks };
    }
    case "practice":
      return part;
    case "game-practice": {
      // The game is the part, so an invalid one is an error, not a dropped visual.
      const parsed = parseSpec(part.doc);
      if (!parsed.ok) throw new Error("game-practice document failed the catalog");
      const spec = dropClientImages(parsed.spec);
      // parseSpec keeps any surviving block, so a document whose game block was dropped would be stored as text only.
      if (!spec.blocks.some((b) => b.type === "game")) throw new Error("game-practice document has no game block");
      return { kind: "game-practice", intro: part.intro, doc: spec };
    }
  }
}
