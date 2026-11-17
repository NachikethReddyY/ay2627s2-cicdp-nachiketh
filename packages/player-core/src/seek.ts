import { applyEdit } from "./events.ts";
import type { Files, SeekResult, Timeline } from "./types.ts";

export function seek(timeline: Timeline, t: number): SeekResult {
  const { events, snapshots, steps } = timeline;
  const tt = Math.min(Math.max(t, 0), timeline.duration);
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t < tt) lo = mid + 1;
    else hi = mid;
  }
  const target = lo;
  let s = 0;
  for (let a = 0, b = snapshots.length - 1; a <= b; ) {
    const mid = (a + b) >> 1;
    if (snapshots[mid].eventIndex <= target) (s = mid), (a = mid + 1);
    else b = mid - 1;
  }
  const snap = snapshots[s];
  const files: Files = { ...snap.files };
  let activePath = snap.activePath;
  for (let i = snap.eventIndex; i < target; i++) {
    const e = events[i];
    if (e.kind === "file") activePath = e.path;
    else files[e.path] = applyEdit(files[e.path] ?? "", e);
  }
  let stepStart = 0;
  for (const sp of steps) if (sp.startEvent <= target) stepStart = sp.startEvent;
  let lastEdit: SeekResult["lastEdit"] = null;
  for (let i = target - 1; i >= stepStart; i--) {
    const e = events[i];
    if (e.kind === "file") continue;
    lastEdit = { path: e.path, offset: e.kind === "delete" ? e.offset : e.offset + e.text.length };
    break;
  }
  return { files, activePath, eventIndex: target, replayed: target - snap.eventIndex, lastEdit };
}
