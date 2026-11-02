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

let backend: SandboxBackend | null = null;

// Docker is imported on first use, so a disabled sandbox never loads node-pty.
export async function getBackend(): Promise<SandboxBackend> {
  if (!backend) {
    const { dockerBackend } = await import("./docker.ts");
    backend = dockerBackend({ image: env.SANDBOX_IMAGE });
  }
  return backend;
}

export function setBackend(b: SandboxBackend | null) {
  backend = b;
}
