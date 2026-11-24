import { buildTimeline, type Hunk, type Timeline, type TypingConfig } from "@learnquest/player-core";

export const STUDIO_FILE = "main.py";

const TYPING: TypingConfig = { msPerChar: 55, lineEndPauseMs: 250, blockThresholdLines: 20 };

export function editHunk(before: string, after: string, file: string = STUDIO_FILE): Hunk[] {
  if (before === after) return [];
  const a = before.split("\n");
  const b = after.split("\n");
  const most = Math.min(a.length, b.length);
  let head = 0;
  while (head < most && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < most - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const removed = a.slice(head, a.length - tail).map((line) => `-${line}`);
  const added = b.slice(head, b.length - tail).map((line) => `+${line}`);
  return [{ id: "studio-edit", file, oldStart: head + 1, lines: [...removed, ...added] }];
}

export function editTimeline(before: string, after: string): Timeline {
  return buildTimeline([{ beforeFiles: { [STUDIO_FILE]: before }, hunks: editHunk(before, after) }], TYPING);
}
