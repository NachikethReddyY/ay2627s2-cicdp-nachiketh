import { ShellNotReadyError, type ShellSocket } from "./shellSocket.ts";

export const READY_TIMEOUT_MS = 15_000;
export const SETTLE_MS = 100;

const CTRL_C = "\u0003";

export function runTarget(language: "python" | "javascript"): { file: "solution.py" | "solution.js"; command: string } {
  return language === "python"
    ? { file: "solution.py", command: "cd ~ && python3 solution.py\r" }
    : { file: "solution.js", command: "cd ~ && node solution.js\r" };
}

export class RunInShellError extends Error {
  readonly kind: "starting" | "disabled" | "unavailable" | "copy";
  constructor(kind: "starting" | "disabled" | "unavailable" | "copy", message: string) {
    super(message);
    this.name = "RunInShellError";
    this.kind = kind;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Copies the editor's code into the learner's sandbox, then types the run command into the shell.
 * Nothing is written or typed unless the shell is ready. Ctrl-C clears any half-typed input first.
 */
export async function runInShell(o: {
  language: "python" | "javascript";
  code: string;
  panel: { open(): void };
  socket: Pick<ShellSocket, "whenReady" | "send">;
  putFile(name: "solution.py" | "solution.js", content: string): Promise<void>;
  refreshTree(): void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { file, command } = runTarget(o.language);
  o.panel.open();

  try {
    await o.socket.whenReady(READY_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof ShellNotReadyError) {
      if (e.why === "timeout") throw new RunInShellError("starting", "The sandbox is still starting, press Run again");
      if (e.why === "disabled") throw new RunInShellError("disabled", "The sandbox is disabled");
      throw new RunInShellError("unavailable", "The terminal is unavailable");
    }
    throw e;
  }

  try {
    await o.putFile(file, o.code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new RunInShellError("copy", `Could not copy your code to the sandbox: ${message}`);
  }

  o.socket.send(CTRL_C);
  await (o.sleep ?? defaultSleep)(SETTLE_MS);
  o.socket.send(command);
  o.refreshTree();
}
