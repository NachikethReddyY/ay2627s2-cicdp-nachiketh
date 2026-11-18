import { env } from "../env.ts";

export interface ShellHandle {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (code: number) => void): void;
}

export class SandboxBusyError extends Error {
  constructor() {
    super("sandbox at its container limit");
  }
}

export interface RunHandle {
  onStdout(cb: (data: string) => void): void;
  onStderr(cb: (data: string) => void): void;
  writeLine(line: string): void;
  kill(): Promise<void>;
  onExit(cb: (code: number | null, error?: string) => void): void;
  onStart(cb: () => void): void;
}

export const SANDBOX_FILES = ["solution.py", "solution.js"] as const;
export type SandboxFileName = (typeof SANDBOX_FILES)[number];
export type DirEntry = { name: string; type: "file" | "dir" | "link" | "other"; size: number };
export type DirListing = { entries: DirEntry[]; truncated: boolean };
export const LIST_MAX_ENTRIES = 200;

export class SandboxNotRunningError extends Error {
  constructor() {
    super("no running shell");
  }
}

export class SandboxFileTooLargeError extends Error {
  constructor() {
    super("file is too large to edit");
  }
}

export interface RunLimits {
  timeoutS: number;
}

export interface SandboxBackend {
  openShell(learnerId: string, size: { cols: number; rows: number }): Promise<ShellHandle>;
  writeFile?(learnerId: string, name: SandboxFileName, content: string): Promise<void>;
  readWorkspaceFile?(learnerId: string, path: string): Promise<string | null>;
  writeWorkspaceFile?(learnerId: string, path: string, content: string): Promise<void>;
  moveWorkspaceFile?(learnerId: string, source: string, targetDir: string): Promise<void>;
  listDir?(learnerId: string, relDir: string): Promise<DirListing | null>;
  runCode?(learnerId: string, language: "python" | "javascript" | "typescript", code: string, limits: RunLimits): RunHandle;
}

let backend: Promise<SandboxBackend> | null = null;

export function getBackend(): Promise<SandboxBackend> {
  backend ??= (env.SANDBOX_BACKEND === "daytona"
    ? import("./daytona.ts").then(({ daytonaBackendFromEnv }) => daytonaBackendFromEnv())
    : import("./docker.ts").then(({ dockerBackend }) => dockerBackend({ image: env.SANDBOX_IMAGE }))
  ).then(
    (b) => b,
    (err) => {
      backend = null;
      throw err;
    },
  );
  return backend;
}

export function setBackend(b: SandboxBackend | null) {
  backend = b && Promise.resolve(b);
}
