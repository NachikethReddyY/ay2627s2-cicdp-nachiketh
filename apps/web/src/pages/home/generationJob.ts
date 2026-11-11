// The one path generation in flight, kept outside React so it survives the learner leaving the home page.
// Generator.tsx reads it with useSyncExternalStore; a finished or failed job is still there when they come back.

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

let job: GenerationJob = { status: "idle" };
// Each request gets an id. Only the newest request's outcome is shown, so a late answer never replaces a newer job.
let latest = 0;
// The id of a request the server has not answered yet, if any. A new request waits until it is cleared.
let awaiting: number | null = null;
const listeners = new Set<() => void>();

const setJob = (next: GenerationJob) => {
  job = next;
  listeners.forEach((l) => l());
};

export const getJob = () => job;

export const subscribeJob = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Starts a generation unless one is running or a timed-out one is still awaiting the server.
 * The returned promise settles when the server answers, which can be after the client has already shown a timeout.
 */
export function startGeneration(prompt: string, generate: GenerateFn, { timeoutMs = CLIENT_TIMEOUT_MS, abandonMs = ABANDON_MS }: StartOptions = {}): Promise<void> {
  if (job.status === "running" || awaiting !== null) return Promise.resolve();
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

/** Forgets a finished or failed job once the learner has seen it. A running job is never dropped. */
export function dismissJob() {
  if (job.status === "done" || job.status === "failed") setJob({ status: "idle" });
}

// tRPC errors carry the code under `data`; our own timeout carries it on the error itself.
function errorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ("code" in e && typeof e.code === "string") return e.code;
  if ("data" in e && typeof e.data === "object" && e.data !== null && "code" in e.data && typeof e.data.code === "string") return e.data.code;
  return null;
}
