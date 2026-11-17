
export const CLIENT_TIMEOUT_MS = 120_000;
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
let queuedPrompts: readonly string[] = [];
let latest = 0;
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

export const getQueue = () => queuedPrompts;

export const subscribeJob = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

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

function errorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ("code" in e && typeof e.code === "string") return e.code;
  if ("data" in e && typeof e.data === "object" && e.data !== null && "code" in e.data && typeof e.data.code === "string") return e.data.code;
  return null;
}
