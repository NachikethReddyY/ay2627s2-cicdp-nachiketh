export function createRunQueue<Job>(execute: (job: Job) => Promise<void>): (job: Job) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (job) => {
    const done = tail.then(() => execute(job));
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
