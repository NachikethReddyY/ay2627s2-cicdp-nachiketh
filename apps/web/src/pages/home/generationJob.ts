// The one path generation in flight, kept outside React so it survives the learner leaving the home page.
// Generator.tsx reads it with useSyncExternalStore; a finished or failed job is still there when they come back.

/** The client stops waiting after this. The API's outline budget is shorter, so this only fires if the request itself hangs. */
export const CLIENT_TIMEOUT_MS = 120_000;

export type GenerationJob =
  | { status: "idle" }
  | { status: "running"; prompt: string }
  | { status: "failed"; prompt: string; code: string | null }
  | { status: "done"; prompt: string; courseSlug: string };

export type GenerateFn = (prompt: string) => Promise<{ firstCourseSlug: string }>;

let job: GenerationJob = { status: "idle" };
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

/** Starts a generation unless one is already running. Resolves once the job settles, for tests and callers that wait. */
export function startGeneration(prompt: string, generate: GenerateFn, timeoutMs = CLIENT_TIMEOUT_MS): Promise<void> {
  if (job.status === "running") return Promise.resolve();
  setJob({ status: "running", prompt });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("client timeout"), { code: "TIMEOUT" })), timeoutMs);
  });
  return Promise.race([generate(prompt), timedOut]).then(
    (r) => {
      clearTimeout(timer);
      setJob({ status: "done", prompt, courseSlug: r.firstCourseSlug });
    },
    (e: unknown) => {
      clearTimeout(timer);
      setJob({ status: "failed", prompt, code: errorCode(e) });
    },
  );
}

// tRPC errors carry the code under `data`; our own timeout carries it on the error itself.
function errorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ("code" in e && typeof e.code === "string") return e.code;
  if ("data" in e && typeof e.data === "object" && e.data !== null && "code" in e.data && typeof e.data.code === "string") return e.data.code;
  return null;
}
