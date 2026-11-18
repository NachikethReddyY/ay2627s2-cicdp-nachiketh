import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createFakeEmbedder, type Embedder } from "../src/embed.ts";
import { bin } from "../src/bin.ts";

export const SAMPLE_FILES: Record<string, string> = {
  "src/greeting.ts": `import { shout } from "./shout.ts";

export function greetLearner(name: string): string {
  return shout("welcome " + name);
}

export const DEFAULT_HINT_DEPTH = 2;

export interface LessonPlan {
  title: string;
}
`,
  "src/shout.ts": `export function shout(text: string): string {
  return text.toUpperCase();
}
`,
  "src/app.tsx": `import { greetLearner } from "./greeting.ts";

export function App() {
  return <main>{greetLearner("sprout")}</main>;
}

export const Footer = () => <footer>bottom</footer>;
`,
  "engine/grader.py": `import re

LIMIT = 3


def grade_answer(answer):
    return answer.strip() == "42"


class HintGiver:
    def give(self, depth):
        return "hint" * depth
`,
  "docs/guide.md": `# Guide

Intro text about the project.

## Predict before reveal

Ask the learner for a prediction first and show the answer afterwards.

## Sandbox

Code runs in an isolated container.
`,
  "notes.txt": Array.from({ length: 130 }, (_, i) => `line ${i + 1}`).join("\n"),
};

export type TempRepo = { root: string; write(path: string, content: string): void; remove(path: string): void; cleanup(): void };

export function createTempRepo(files: Record<string, string> = SAMPLE_FILES): TempRepo {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-index-")));
  execFileSync(bin("git"), ["init", "-q"], { cwd: root });
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const [path, content] of Object.entries(files)) write(path, content);
  return {
    root,
    write,
    remove: (path) => rmSync(join(root, path)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function countingEmbedder(): Embedder & { embeddedTexts: string[] } {
  const inner = createFakeEmbedder();
  const embeddedTexts: string[] = [];
  return {
    ...inner,
    embeddedTexts,
    async embed(texts) {
      embeddedTexts.push(...texts);
      return inner.embed(texts);
    },
  };
}
