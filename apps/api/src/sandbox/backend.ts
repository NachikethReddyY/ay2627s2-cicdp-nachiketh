import { env } from "../env.ts";

export interface ShellHandle {
  write(data: Uint8Array | string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (code: number) => void): void;
}

/** The server already runs as many shell containers as SANDBOX_MAX_SHELLS allows. */
export class SandboxBusyError extends Error {
  constructor() {
    super("sandbox at its container limit");
  }
}

/** A running practice program. Output is untrusted data (ADR-0002): callers cap and never interpret it. */
export interface RunHandle {
  onStdout(cb: (data: string) => void): void;
  onStderr(cb: (data: string) => void): void;
  /** Sends one line to the program's stdin; lines sent before the program starts are held until it does. */
  writeLine(line: string): void;
  /** Stops the program and releases everything it held. Resolves once nothing is left running. */
  kill(): Promise<void>;
  /** `code` is null when the run could not be started or was cut off; `error` then says why. */
  onExit(cb: (code: number | null, error?: string) => void): void;
  /** Fires once the program itself is running, so a time limit can start then and not during sandbox setup. */
  onStart(cb: () => void): void;
}

export interface RunLimits {
  timeoutS: number;
}

export interface SandboxBackend {
  openShell(learnerId: string, size: { cols: number; rows: number }): Promise<ShellHandle>;
  /** Backends that can run practice code themselves. Without it, run.ts keeps its own `docker run` path. */
  runCode?(learnerId: string, language: "python" | "javascript", code: string, limits: RunLimits): RunHandle;
}

let backend: Promise<SandboxBackend> | null = null;

// The chosen backend is imported on first use, so a disabled sandbox never loads node-pty, and Daytona never loads it at all.
// The promise is cached so concurrent first calls share one backend.
export function getBackend(): Promise<SandboxBackend> {
  // Loaded inside `??=` so a cached backend (or a test's fake) never triggers another import or client build.
  backend ??= (env.SANDBOX_BACKEND === "daytona"
    ? import("./daytona.ts").then(({ daytonaBackendFromEnv }) => daytonaBackendFromEnv())
    : import("./docker.ts").then(({ dockerBackend }) => dockerBackend({ image: env.SANDBOX_IMAGE }))
  ).then(
    (b) => b,
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
