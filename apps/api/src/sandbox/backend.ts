import { env } from "../env.ts";

export interface ShellHandle {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (code: number) => void): void;
}

export interface SandboxBackend {
  openShell(learnerId: string, size: { cols: number; rows: number }): Promise<ShellHandle>;
}

let backend: Promise<SandboxBackend> | null = null;

// Docker is imported on first use, so a disabled sandbox never loads node-pty.
// The promise is cached so concurrent first calls share one backend.
export function getBackend(): Promise<SandboxBackend> {
  backend ??= import("./docker.ts").then(
    ({ dockerBackend }) => dockerBackend({ image: env.SANDBOX_IMAGE }),
    (err) => {
      backend = null; // let the next call retry a failed load
      throw err;
    },
  );
  return backend;
}

export function setBackend(b: SandboxBackend | null) {
  backend = b && Promise.resolve(b);
}
