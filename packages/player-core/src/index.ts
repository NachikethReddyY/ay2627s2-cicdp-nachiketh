export * from "./types.ts";
export { K, buildTimeline } from "./events.ts";
export { seek } from "./seek.ts";
import { seek } from "./seek.ts";
import type { Files, Timeline } from "./types.ts";

export function filesAtEnd(timeline: Timeline): Files {
  return seek(timeline, timeline.duration).files;
}
