// The path generations in flight, kept outside React so they survive the learner leaving the home page.
// Generator.tsx reads them with useSyncExternalStore; a finished or failed job is still there when they come back.
//
// One job runs at a time. Prompts submitted while one runs join a first-in-first-out queue, and the next queued prompt
// starts once the learner has seen the previous result (dismissJob). A failure or a finished path is never replaced by
// the next job before anyone has read it.

/** The client stops waiting after this and shows a timeout. The API's outline budget is shorter, so this only fires if the request itself hangs. */
export const CLIENT_TIMEOUT_MS = 120_000;
/** A timed-out request may still finish on the server and use a daily slot. Retry waits for it, up to this long, before it is allowed to send another. */
export const ABANDON_MS = 5 * 60_000;

export type GenerationJob =
  | { status: "idle" }
  | { status: "running"; prompt: string }
  | { status: "failed"; prompt: string; code: string | null; pending: boolean }
  | { status: "done"; prompt: string; courseSlug: string };

export type GenerateFn = (prompt: string) => Promise<{ firstCourseSlug: string }>;

export type StartOptions = { timeoutMs?: number; abandonMs?: number };

type Queued = { prompt: string; generate: GenerateFn; options: StartOptions };

let job: GenerationJob = { status: "idle" };
let queued: Queued[] = [];
// React compares snapshots by reference, so the prompt list is replaced whenever the queue changes.
let queuedPrompts: readonly string[] = [];
// Each request gets an id. Only the newest request's outcome is shown, so a late answer never replaces a newer job.
let latest = 0;
// The id of a request the server has not answered yet, if any. A new request waits until it is cleared.
let awaiting: number | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

const setJob = (next: GenerationJob) => {
  job = next;
  notify();
};

const setQueue = (next: Queued[]) => {
  queued = next;
  queuedPrompts = next.map((q) => q.prompt);
  notify();
};

export const getJob = () => job;

/** The prompts waiting behind the current job, oldest first. */
export const getQueue = () => queuedPrompts;

export const subscribeJob = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Starts a generation now, or queues it behind the one running or awaiting the server.
 * The returned promise settles when a request started right away answers, which can be after the client has already
 * shown a timeout. A queued prompt returns at once; it starts later, when the learner has seen the job before it.
 */
export function startGeneration(prompt: string, generate: GenerateFn, options: StartOptions = {}): Promise<void> {
  if (job.status === "running" || awaiting !== null) {
    setQueue([...queued, { prompt, generate, options }]);
    return Promise.resolve();
  }
  return run(prompt, generate, options);
}

function run(prompt: string, generate: GenerateFn, { timeoutMs = CLIENT_TIMEOUT_MS, abandonMs = ABANDON_MS }: StartOptions): Promise<void> {
  const id = ++latest;
  awaiting = id;
  setJob({ status: "running", prompt });

  let abandon: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    if (id !== latest || job.status !== "running") return;
    setJob({ status: "failed", prompt, code: "TIMEOUT", pending: true });
    abandon = setTimeout(() => {
      if (awaiting === id) awaiting = null;
      if (id === latest && job.status === "failed") setJob({ ...job, pending: false });
    }, abandonMs);
  }, timeoutMs);

  const settle = (next: GenerationJob) => {
    clearTimeout(timer);
    clearTimeout(abandon);
    if (awaiting === id) awaiting = null;
    if (id === latest) setJob(next);
  };
  return generate(prompt).then(
    (r) => settle({ status: "done", prompt, courseSlug: r.firstCourseSlug }),
    (e: unknown) => settle({ status: "failed", prompt, code: errorCode(e), pending: false }),
  );
}

/**
 * Forgets a finished or failed job once the learner has seen it, then starts the next queued prompt. A running job is
 * never dropped, and neither is a timed-out one the server may still answer: clearing it would start a second request
 * while the first may still finish.
 */
export function dismissJob() {
  if (job.status === "done" || (job.status === "failed" && !job.pending)) {
    setJob({ status: "idle" });
    startNext();
  }
}

function startNext() {
  if (job.status !== "idle" || awaiting !== null || queued.length === 0) return;
  const [next, ...rest] = queued;
  setQueue(rest);
  void run(next.prompt, next.generate, next.options);
}

// tRPC errors carry the code under `data`; our own timeout carries it on the error itself.
function errorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ("code" in e && typeof e.code === "string") return e.code;
  if ("data" in e && typeof e.data === "object" && e.data !== null && "code" in e.data && typeof e.data.code === "string") return e.data.code;
  return null;
}
