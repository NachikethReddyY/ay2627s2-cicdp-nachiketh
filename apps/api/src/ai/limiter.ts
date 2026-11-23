export class LimiterStopped extends Error {
  constructor() {
    super("Queued work was stopped before it started");
    this.name = "LimiterStopped";
  }
}

type Waiting = { key: string; start: () => void; reject: (error: Error) => void };

export function createLimiter(limit: number) {
  let active = 0;
  const waiting: Waiting[] = [];

  const release = () => {
    active--;
    waiting.shift()?.start();
  };

  const run = <T>(key: string, job: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        job().then(resolve, reject).finally(release);
      };
      if (active < limit) start();
      else waiting.push({ key, start, reject });
    });

  const promote = (key: string) => {
    const at = waiting.findIndex((w) => w.key === key);
    if (at > 0) waiting.unshift(...waiting.splice(at, 1));
  };

  const stop = () => {
    const dropped = waiting.splice(0);
    for (const w of dropped) w.reject(new LimiterStopped());
    return dropped.length;
  };

  return { run, promote, stop };
}
