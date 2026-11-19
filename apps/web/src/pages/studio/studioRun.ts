import type { StudioRun } from "./studioModel.ts";

let current: StudioRun = {};

export function readStudioRun(): StudioRun {
  return current;
}

export function writeStudioRun(next: StudioRun): void {
  current = next;
}
