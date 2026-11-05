import DiffMatchPatch from "diff-match-patch";
import type { Files, ReplayEvent, StepInput, StepSpan, Snapshot, Timeline, TypingConfig } from "./types.ts";

export const K = 200;
const DEFAULT_TYPING: TypingConfig = { msPerChar: 200, lineEndPauseMs: 300, blockThresholdLines: 20 };

/** Applies one edit event to a text. */
export function applyEdit(text: string, e: ReplayEvent): string {
  if (e.kind === "insert") return text.slice(0, e.offset) + e.text + text.slice(e.offset);
  if (e.kind === "delete") return text.slice(0, e.offset) + text.slice(e.offset + e.length);
  if (e.kind === "block") return text.slice(0, e.offset) + e.text + text.slice(e.offset + e.deleteLength);
  return text;
}

export function buildTimeline(steps: StepInput[], config: TypingConfig = DEFAULT_TYPING): Timeline {
  const { msPerChar, lineEndPauseMs, blockThresholdLines } = config;
  const dmp = new DiffMatchPatch();
  const events: ReplayEvent[] = [];
  const snapshots: Snapshot[] = [];
  const spans: StepSpan[] = [];
  let t = 0;
  let active = "";
  let files: Files = {};

  const push = (e: ReplayEvent, cost: number) => {
    events.push(e);
    t += cost;
    if (e.kind !== "file") files[e.path] = applyEdit(files[e.path] ?? "", e);
  };

  steps.forEach((step, idx) => {
    files = { ...step.beforeFiles };
    const first = step.hunks[0]?.file ?? (idx === 0 ? Object.keys(files)[0] ?? "" : active);
    snapshots.push({ eventIndex: events.length, files: { ...files }, activePath: first });
    if (idx === 0) active = first;
    const startEvent = events.length;
    const startT = t;
    const delta: Record<string, number> = {};

    for (const h of step.hunks) {
      if (h.file !== active) {
        push({ kind: "file", path: h.file, t }, lineEndPauseMs);
        active = h.file;
      }
      const oldL: string[] = [];
      const newL: string[] = [];
      let changed = 0;
      for (const line of h.lines) {
        // LLMs often emit a blank context line as "" instead of " ".
        const p = line === "" ? " " : line[0];
        if (p === "\\") continue;
        if (p !== " " && p !== "-" && p !== "+") throw new Error(`hunk ${h.id}: bad line prefix in "${line}"`);
        if (p !== "+") oldL.push(line.slice(1));
        if (p !== "-") newL.push(line.slice(1));
        if (p !== " ") changed++;
      }
      const text = files[h.file];
      if (text === undefined) throw new Error(`hunk ${h.id}: file ${h.file} not found`);
      const lines = text.split("\n");
      const start = h.oldStart - 1 + (delta[h.file] ?? 0);
      const n = oldL.length;
      const m = newL.length;
      let offset = 0;
      for (let i = 0; i < Math.min(start, lines.length); i++) offset += lines[i].length + 1;
      let oldSeg = oldL.join("\n");
      let newSeg = newL.join("\n");
      // Empty sides carry the newline that separates them from their neighbours.
      if (n === 0 && m > 0) {
        if (start < lines.length) newSeg += "\n";
        else (offset = text.length), (newSeg = "\n" + newSeg);
      } else if (m === 0 && n > 0) {
        if (start + n < lines.length) oldSeg += "\n";
        else if (start > 0) (offset -= 1), (oldSeg = "\n" + oldSeg);
      }
      if (start < 0 || start + n > lines.length || text.slice(offset, offset + oldSeg.length) !== oldSeg) {
        throw new Error(`hunk ${h.id}: context does not match ${h.file} at line ${h.oldStart}`);
      }
      delta[h.file] = (delta[h.file] ?? 0) + m - n;

      if (changed > blockThresholdLines) {
        push({ kind: "block", path: h.file, offset, deleteLength: oldSeg.length, text: newSeg, t }, msPerChar * 5);
        continue;
      }
      const diffs = dmp.diff_main(oldSeg, newSeg);
      dmp.diff_cleanupSemantic(diffs);
      let pos = offset;
      for (const [op, s] of diffs) {
        if (op === 0) pos += s.length;
        else if (op === -1) push({ kind: "delete", path: h.file, offset: pos, length: s.length, t }, msPerChar);
        else {
          for (const ch of s) {
            push({ kind: "insert", path: h.file, offset: pos, text: ch, t }, msPerChar + (ch === "\n" ? lineEndPauseMs : 0));
            pos += ch.length;
          }
        }
      }
    }
    spans.push({ idx, startEvent, endEvent: events.length, startT, endT: t });
  });

  return { events, snapshots: addPeriodic(events, snapshots), steps: spans, duration: t };
}

// Periodic snapshots need the running state, so rebuild it by replaying once (cheap, linear).
function addPeriodic(events: ReplayEvent[], boundary: Snapshot[]): Snapshot[] {
  const out: Snapshot[] = [];
  let bi = 0;
  let files: Files = {};
  let active = boundary[0]?.activePath ?? "";
  for (let i = 0; i <= events.length; i++) {
    let atBoundary = false;
    while (bi < boundary.length && boundary[bi].eventIndex === i) {
      out.push(boundary[bi]);
      files = { ...boundary[bi].files };
      atBoundary = true;
      bi++;
    }
    if (!atBoundary && i > 0 && i % K === 0 && i < events.length) out.push({ eventIndex: i, files: { ...files }, activePath: active });
    if (i === events.length) break;
    const e = events[i];
    if (e.kind === "file") active = e.path;
    else files[e.path] = applyEdit(files[e.path] ?? "", e);
  }
  return out;
}
