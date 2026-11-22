import { ShellNotReadyError, type ShellSocket } from "./shellSocket.ts";

export const READY_TIMEOUT_MS = 15_000;
export const PROMPT_WAIT_MS = 2_000;
export const FINISH_TIMEOUT_MS = 60_000;
export const CTRL_C = "\u0003";
export const STILL_RUNNING = "Your program is still running. Ctrl+C was sent; another run will wait until it stops.";

export type ShellRunEnd = "finished" | "timeout";
type MarkerEnd = "matched" | "lost" | "timeout";
type MarkerSocket = Pick<ShellSocket, "onOutput" | "onState">;
type Deadline = (ms: number) => AbortSignal;

const defaultDeadline: Deadline = (ms) => AbortSignal.timeout(ms);
const randomToken = () => crypto.randomUUID().replaceAll("-", "");
const readyMarker = (token: string) => `\u001eLQ_READY_${token}\u001f`;
const runMarker = (token: string) => `\u001eLQ_RUN_${token}:`;
const shellPrint = (value: string) => `printf '\\036%s\\037\\n' '${value}'`;

export function watchMarker(socket: MarkerSocket): { next(signal: AbortSignal, marker: string): Promise<MarkerEnd>; stop(): void } {
  const decoder = new TextDecoder();
  const waiters = new Set<{ marker: string; finish(end: MarkerEnd): void }>();
  let tail = "";
  const offOutput = socket.onOutput((bytes) => {
    const text = tail + decoder.decode(bytes, { stream: true });
    const freshAt = tail.length;
    for (const waiter of [...waiters]) {
      const at = text.indexOf(waiter.marker);
      if (at >= 0 && at + waiter.marker.length > freshAt) waiter.finish("matched");
    }
    tail = text.slice(-256);
  });
  const offState = socket.onState((state) => {
    if (state.kind !== "open") for (const waiter of [...waiters]) waiter.finish("lost");
  });
  return {
    next: (signal, marker) => new Promise<MarkerEnd>((resolve) => {
      if (signal.aborted) return resolve("timeout");
      const waiter = {
        marker,
        finish: (end: MarkerEnd) => {
          waiters.delete(waiter);
          signal.removeEventListener("abort", expire);
          resolve(end);
        },
      };
      const expire = () => waiter.finish("timeout");
      signal.addEventListener("abort", expire, { once: true });
      waiters.add(waiter);
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
    ? { file: "solution.py", command: "cd ~ && python3 solution.py" }
    : { file: "solution.js", command: "cd ~ && node solution.js" };
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

async function waitForMarker(watcher: ReturnType<typeof watchMarker>, marker: string, deadline: Deadline): Promise<MarkerEnd> {
  return watcher.next(deadline(PROMPT_WAIT_MS), marker);
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
  await (o.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(100);
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
  onTimeout?(): void;
}): Promise<ShellRunEnd> {
  const { file, command } = runTarget(o.language);
  o.panel.open();
  await waitForShell(o.socket);

  const deadline = o.deadline ?? defaultDeadline;
  const watcher = watchMarker(o.socket);
  try {
    const ready = randomToken();
    const readyWait = waitForMarker(watcher, readyMarker(ready), deadline);
    if (!o.socket.send(CTRL_C) || !o.socket.send(`\r${shellPrint(`LQ_READY_${ready}`)}\r`)) throw lostShell();
    const readyEnd = await readyWait;
    if (readyEnd === "lost") throw lostShell();
    if (readyEnd === "timeout") throw new RunInShellError("unavailable", "The shell did not confirm it was ready; no code was copied");

    try {
      await o.putFile(file, o.code);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new RunInShellError("copy", `Could not copy your code to the sandbox: ${message}`);
    }

    const token = randomToken();
    const marker = runMarker(token);
    const finished = watcher.next(deadline(FINISH_TIMEOUT_MS), marker);
    const wrapped = `${command}; __lq_status=$?; printf '\\036LQ_RUN_${token}:%s\\037\\n' "$__lq_status"`;
    if (!o.socket.send(`${wrapped}\r`)) throw lostShell();
    o.refreshTree();

    const end = await finished;
    if (end === "lost") throw new RunInShellError("unavailable", "The shell disconnected before your program finished");
    if (end === "matched") return "finished";

    o.onTimeout?.();
    const stopped = watcher.next(new AbortController().signal, marker);
    if (!o.socket.send(CTRL_C)) throw lostShell();
    if (await stopped !== "matched") throw new RunInShellError("unavailable", "The shell did not confirm that your program stopped");
    return "timeout";
  } finally {
    watcher.stop();
  }
}
