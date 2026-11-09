import { Worker } from "node:worker_threads";

export type LintLanguage = "javascript" | "typescript" | "python";
export type Finding = { ruleId: string; line: number; column: number; message: string };

export class LintUnavailableError extends Error {}

export const LINT_TIMEOUT_MS = 2_000;
const STARTUP_TIMEOUT_MS = 15_000; // loading ESLint, the TypeScript parser and the ruff WASM, once per worker

type Reply = { ready?: true; id?: number; findings?: Finding[]; error?: string };
type Job = {
  code: string;
  language: LintLanguage;
  settled: boolean;
  abort?: (why: string) => void; // set while the job runs on the worker; kills it
  resolve: (f: Finding[]) => void;
  reject: (e: Error) => void;
};

/** Jobs waiting or running; a full queue rejects at once instead of growing without bound. */
export const MAX_PENDING = 8;

// One warm worker handles one job at a time. A timeout, crash or error kills it; the next job starts a fresh one.
let worker: Worker | undefined;
let ready: Promise<Worker> | undefined;
let nextId = 0;
const queue: Job[] = [];
let busy = false;
let pending = 0;

function startWorker(): Promise<Worker> {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
  w.unref(); // an idle worker must not keep the process (or a test run) alive
  worker = w;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { kill(w); reject(new LintUnavailableError("lint worker did not start")); }, STARTUP_TIMEOUT_MS);
    w.once("message", (m: Reply) => {
      clearTimeout(timer);
      if (m.ready) resolve(w);
      else { kill(w); reject(new LintUnavailableError("lint worker failed to start")); }
    });
    w.once("error", (e: Error) => { clearTimeout(timer); kill(w); reject(new LintUnavailableError(`lint worker failed to start: ${e.message}`)); });
    w.once("exit", () => { clearTimeout(timer); reject(new LintUnavailableError("lint worker exited")); });
  });
}

function kill(w: Worker): void {
  if (worker === w) { worker = undefined; ready = undefined; }
  void w.terminate();
}

function run(job: Job, w: Worker): Promise<Finding[]> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      job.abort = undefined;
      w.off("message", onMessage);
      w.off("error", onError);
      w.off("exit", onExit);
      fn();
    };
    const fail = (why: string) => done(() => { kill(w); reject(new LintUnavailableError(why)); });
    job.abort = fail;
    const onMessage = (m: Reply) => {
      if (m.id !== id) return;
      if (m.findings) done(() => resolve(m.findings!));
      else fail(m.error ?? "lint failed");
    };
    const onError = (e: Error) => fail(`lint worker crashed: ${e.message}`);
    const onExit = () => fail("lint worker exited");
    w.on("message", onMessage);
    w.on("error", onError);
    w.on("exit", onExit);
    w.postMessage({ id, code: job.code, language: job.language });
  });
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (job.settled) continue;
      try {
        ready ??= startWorker();
        const w = await ready.catch((e) => { ready = undefined; throw e; });
        if (job.settled) continue; // timed out while the worker was starting
        job.resolve(await run(job, w));
      } catch (e) {
        job.reject(e instanceof LintUnavailableError ? e : new LintUnavailableError(e instanceof Error ? e.message : "lint failed"));
      }
    }
  } finally {
    busy = false;
  }
}

/**
 * Lints learner code without running it. Resolves with the findings ([] only when the code is clean) and rejects with
 * LintUnavailableError on timeout, a full queue or any internal failure. The timeout counts from the call, so time spent
 * waiting in the queue is included. Findings carry no fixes or replacement code.
 */
export function lintCode(code: string, language: LintLanguage, opts: { timeoutMs?: number } = {}): Promise<Finding[]> {
  if (pending >= MAX_PENDING) return Promise.reject(new LintUnavailableError("lint queue is full"));
  pending++;
  return new Promise((resolve, reject) => {
    const settle = (fn: () => void) => {
      if (job.settled) return;
      job.settled = true;
      pending--;
      clearTimeout(timer);
      fn();
    };
    const job: Job = {
      code,
      language,
      settled: false,
      resolve: (f) => settle(() => resolve(f)),
      reject: (e) => settle(() => reject(e)),
    };
    const timer = setTimeout(() => {
      if (job.settled) return;
      if (job.abort) job.abort("lint timed out"); // running: kills the worker and rejects
      else {
        const i = queue.indexOf(job);
        if (i >= 0) queue.splice(i, 1);
        job.reject(new LintUnavailableError("lint timed out"));
      }
    }, opts.timeoutMs ?? LINT_TIMEOUT_MS);
    queue.push(job);
    void pump();
  });
}

const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029/;

/** The text of a 1-based line, split the way ESLint counts lines (CRLF, CR, LF, U+2028, U+2029). */
export function sourceLineOf(code: string, line: number): string {
  return code.split(LINE_BREAK)[line - 1] ?? "";
}
