export type RunQueueOptions = { isLive?: () => boolean };

export function createRunQueue<Job>(execute: (job: Job) => Promise<void>, { isLive = () => true }: RunQueueOptions = {}): (job: Job) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (job) => {
    const done = tail.then(() => (isLive() ? execute(job) : undefined));
    tail = done.catch(() => {});
    return done;
  };
}

export type RunGate = { wait(): Promise<void>; release(): void };

export function createRunGate(): RunGate {
  let open: (() => void) | null = null;
  const release = () => {
    const resolve = open;
    open = null;
    resolve?.();
  };
  return {
    wait: () => {
      release();
      return new Promise<void>((resolve) => { open = resolve; });
    },
    release,
  };
}

export function withDeadline<T>(send: (signal: AbortSignal) => Promise<T>, ms: number, makeSignal: (ms: number) => AbortSignal = (limit) => AbortSignal.timeout(limit)): Promise<T> {
  const signal = makeSignal(ms);
  return new Promise<T>((resolve, reject) => {
    const expire = () => reject(signal.reason);
    if (signal.aborted) {
      expire();
      return;
    }
    signal.addEventListener("abort", expire, { once: true });
    send(signal).then(resolve, reject);
  });
}
