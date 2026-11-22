import { z } from "zod";
import { parseSpec } from "@learnquest/ui-catalog";
import { buildTimeline, seek } from "@learnquest/player-core";
import { checkStep, Hunk, McqStep, text } from "../ai/step-schema.ts";
import { GeneratedScrim } from "../parts/scrim-schema.ts";
import { PracticeContent } from "../parts/practice-schema.ts";
import type { GeneratedPart } from "../db/schema.ts";

const ReadSteps = z.array(McqStep).length(2);

const Part = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("learn"), body: text(4000), doc: z.unknown().optional(), steps: ReadSteps }),
  z.object({
    kind: z.literal("watch"),
    beforeFiles: z.record(text(200), z.string().max(6000)).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 4),
    hunks: z.array(Hunk).min(1).max(6),
    steps: ReadSteps,
  }),
  PracticeContent,
  GeneratedScrim,
  z.object({ kind: z.literal("game-practice"), intro: text(500), doc: z.unknown() }),
]);

function checkBody(body: string) {
  const fences = body.match(/```/g)?.length ?? 0;
  const inline = body.replace(/```[\s\S]*?```/g, "").match(/`/g)?.length ?? 0;
  if (fences % 2 || inline % 2) throw new Error("learn part looks truncated");
  const words = body.split(/\s+/);
  if (words.length > 40 && new Set(words).size / words.length < 0.3) throw new Error("learn part is repetitive");
}

const dropClientImages = <T extends { blocks: Array<{ type: string; props?: unknown }> }>(spec: T): T => ({
  ...spec,
  blocks: spec.blocks.filter((b) => !(b.type === "image" && ["generated", "generated-pending"].includes((b.props as { source?: string } | undefined)?.source ?? ""))),
});

export function validatePart(raw: unknown): GeneratedPart {
  const part = Part.parse(raw);
  switch (part.kind) {
    case "learn": {
      checkBody(part.body);
      for (const step of part.steps) checkStep(step);
      const parsed = part.doc === undefined ? null : parseSpec(part.doc);
      if (!parsed?.ok) return { kind: "learn", body: part.body, steps: part.steps };
      return { kind: "learn", body: part.body, doc: dropClientImages(parsed.spec), steps: part.steps };
    }
    case "watch": {
      const tl = buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]);
      if (JSON.stringify(seek(tl, tl.duration).files) === JSON.stringify(part.beforeFiles)) throw new Error("watch part changes nothing");
      for (const step of part.steps) checkStep(step);
      return { kind: "watch", beforeFiles: part.beforeFiles, hunks: part.hunks, steps: part.steps };
    }
    case "practice":
      return part;
    case "scrim":
      for (const step of part.steps) checkStep(step);
      return part;
    case "game-practice": {
      const parsed = parseSpec(part.doc);
      if (!parsed.ok) throw new Error("game-practice document failed the catalog");
      const spec = dropClientImages(parsed.spec);
      if (!spec.blocks.some((b) => b.type === "game")) throw new Error("game-practice document has no game block");
      return { kind: "game-practice", intro: part.intro, doc: spec };
    }
  }
}
