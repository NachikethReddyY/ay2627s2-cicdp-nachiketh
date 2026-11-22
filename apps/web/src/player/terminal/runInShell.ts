import { ShellNotReadyError, type ShellSocket } from "./shellSocket.ts";

export const READY_TIMEOUT_MS = 15_000;
export const SETTLE_MS = 100;
export const PROMPT_WAIT_MS = 2_000;
export const FINISH_TIMEOUT_MS = 60_000;
export const PROMPT_MARKER = "\u001b]777;learnquest-refresh\u0007";

export const CTRL_C = "\u0003";
export const STILL_RUNNING = `Your program is still running after ${FINISH_TIMEOUT_MS / 1000} seconds. The next Run stops it first.`;

export type ShellRunEnd = "finished" | "timeout";
type PromptEnd = ShellRunEnd | "lost";
type PromptSocket = Pick<ShellSocket, "onOutput" | "onState">;
type Deadline = (ms: number) => AbortSignal;

const defaultDeadline: Deadline = (ms) => AbortSignal.timeout(ms);

export function watchPrompts(socket: PromptSocket): { next(signal: AbortSignal): Promise<PromptEnd>; stop(): void } {
  const decoder = new TextDecoder();
  const waiters = new Set<(end: PromptEnd) => void>();
  let tail = "";
  const settle = (end: PromptEnd) => {
    for (const waiter of [...waiters]) waiter(end);
  };
  const offOutput = socket.onOutput((bytes) => {
    const text = tail + decoder.decode(bytes, { stream: true });
    const at = text.lastIndexOf(PROMPT_MARKER);
    tail = (at < 0 ? text : text.slice(at + PROMPT_MARKER.length)).slice(1 - PROMPT_MARKER.length);
    if (at >= 0) settle("finished");
  });
  const offState = socket.onState((state) => {
    if (state.kind !== "open") settle("lost");
  });
  return {
    next: (signal) =>
      new Promise<PromptEnd>((resolve) => {
        if (signal.aborted) return resolve("timeout");
        const done = (end: PromptEnd) => {
          waiters.delete(done);
          signal.removeEventListener("abort", expire);
          resolve(end);
        };
        const expire = () => done("timeout");
        signal.addEventListener("abort", expire, { once: true });
        waiters.add(done);
      }),
    stop: () => {
      offOutput();
      offState();
      waiters.clear();
    },
  };
}

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

const lostShell = () => new RunInShellError("unavailable", "The shell disconnected, press Run again");

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForShell(socket: Pick<ShellSocket, "whenReady">): Promise<void> {
  try {
    await socket.whenReady(READY_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof ShellNotReadyError) {
      if (e.why === "timeout") throw new RunInShellError("starting", "The sandbox is still starting, press Run again");
      if (e.why === "disabled") throw new RunInShellError("disabled", "The sandbox is disabled");
      const why: Record<string, string> = {
        exited: "The shell ended. Press Enter in the terminal to start a new shell, then Run again",
        replaced: "The terminal is open in another window",
        busy: "The sandbox is busy, try again in a moment",
        too_many_tabs: "Too many terminal tabs are open",
        signed_out: "Sign in to use the terminal",
      };
      throw new RunInShellError("unavailable", why[e.why] ?? "The terminal is unavailable");
    }
    throw e;
  }
}

export async function runShellCommand(o: {
  command: string;
  panel: { open(): void };
  socket: Pick<ShellSocket, "whenReady" | "send">;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  o.panel.open();
  await waitForShell(o.socket);
  if (!o.socket.send(CTRL_C)) throw lostShell();
  await (o.sleep ?? defaultSleep)(SETTLE_MS);
  if (!o.socket.send(`${o.command}\r`)) throw lostShell();
}

export async function runInShell(o: {
  language: "python" | "javascript";
  code: string;
  panel: { open(): void };
  socket: Pick<ShellSocket, "whenReady" | "send" | "onOutput" | "onState">;
  putFile(name: "solution.py" | "solution.js", content: string): Promise<void>;
  refreshTree(): void;
  deadline?: Deadline;
}): Promise<ShellRunEnd> {
  const { file, command } = runTarget(o.language);
  o.panel.open();

  await waitForShell(o.socket);

  try {
    await o.putFile(file, o.code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new RunInShellError("copy", `Could not copy your code to the sandbox: ${message}`);
  }

  const deadline = o.deadline ?? defaultDeadline;
  const prompts = watchPrompts(o.socket);
  try {
    const interrupted = prompts.next(deadline(PROMPT_WAIT_MS));
    if (!o.socket.send(CTRL_C)) throw lostShell();
    if ((await interrupted) === "lost") throw lostShell();
    const finished = prompts.next(deadline(FINISH_TIMEOUT_MS));
    if (!o.socket.send(command)) throw lostShell();
    o.refreshTree();
    const end = await finished;
    if (end === "lost") throw new RunInShellError("unavailable", "The shell disconnected before your program finished");
    return end;
  } finally {
    prompts.stop();
  }
}
