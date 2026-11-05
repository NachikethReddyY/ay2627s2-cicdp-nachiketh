export * from "./types.ts";
export { K, buildTimeline } from "./events.ts";
export { seek } from "./seek.ts";
import { seek } from "./seek.ts";
import type { Files, Timeline } from "./types.ts";

/** State after the last event (used by a read-only diff page). */
export function filesAtEnd(timeline: Timeline): Files {
  return seek(timeline, timeline.duration).files;
}
