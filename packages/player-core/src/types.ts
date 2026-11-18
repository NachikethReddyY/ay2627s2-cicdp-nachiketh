
export type Files = Record<string, string>;

export type Hunk = { id: string; file: string; oldStart: number; lines: string[] };

export type StepInput = { beforeFiles: Files; hunks: Hunk[] };

export type TypingConfig = {
  msPerChar: number;
  lineEndPauseMs: number;
  blockThresholdLines: number;
};

export type ReplayEvent =
  | { kind: "file"; path: string; t: number }
  | { kind: "insert"; path: string; offset: number; text: string; t: number }
  | { kind: "delete"; path: string; offset: number; length: number; t: number }
  | { kind: "block"; path: string; offset: number; deleteLength: number; text: string; t: number };

export type StepSpan = { idx: number; startEvent: number; endEvent: number; startT: number; endT: number };

export type Snapshot = { eventIndex: number; files: Files; activePath: string };

export type Timeline = {
  events: ReplayEvent[];
  snapshots: Snapshot[];
  steps: StepSpan[];
  duration: number;
};

export type SeekResult = {
  files: Files;
  activePath: string;
  eventIndex: number;
  replayed: number;
  lastEdit: { path: string; offset: number } | null;
};
