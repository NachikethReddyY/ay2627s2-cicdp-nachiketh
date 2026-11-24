import type { StudioRun } from "./studioModel.ts";

let current: { accountId: string; run: StudioRun } | undefined;

export function readStudioRun(accountId: string): StudioRun {
  return current?.accountId === accountId ? current.run : {};
}

export function writeStudioRun(accountId: string, run: StudioRun): void {
  current = { accountId, run };
}
