export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number; ok: boolean }>;

export type Clock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type WaitOptions = {
  url: string;
  timeoutMs: number;
  intervalMs: number;
  fetch: FetchLike;
  clock: Clock;
  accept?: (status: number) => boolean;
};

export type WaitResult = { ok: true; attempts: number } | { ok: false; attempts: number; lastError: string };

export async function probe(url: string, fetchFn: FetchLike, accept: (status: number) => boolean): Promise<string | null> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
    return accept(res.status) ? null : `status ${res.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function waitForHttp(options: WaitOptions): Promise<WaitResult> {
  const accept = options.accept ?? ((status: number) => status >= 200 && status < 300);
  const deadline = options.clock.now() + options.timeoutMs;
  let attempts = 0;
  let lastError = "no attempt made";
  while (true) {
    attempts += 1;
    const failure = await probe(options.url, options.fetch, accept);
    if (failure === null) return { ok: true, attempts };
    lastError = failure;
    if (options.clock.now() + options.intervalMs > deadline) return { ok: false, attempts, lastError };
    await options.clock.sleep(options.intervalMs);
  }
}
