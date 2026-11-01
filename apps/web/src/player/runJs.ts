export type RunResult = { output: string; error?: string };

// Runs in the worker: global eval, console.log captured, one result message.
export const SRC = `onmessage=e=>{const o=[];console.log=(...a)=>o.push(a.join(" "));let error;try{(0,eval)(e.data)}catch(x){error=String(x)}postMessage({output:o.join("\\n"),error})}`;

const browserWorker = (): Worker => new Worker(URL.createObjectURL(new Blob([SRC])));

// Kills the worker after `ms` so an infinite loop cannot freeze the tab. `spawn` is swapped in tests (no Worker in Node).
export function runJs(code: string, ms = 3000, spawn: () => Worker = browserWorker): Promise<RunResult> {
  return new Promise((resolve) => {
    const w = spawn();
    const done = (r: RunResult) => {
      clearTimeout(timer);
      w.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ output: "", error: "Timed out after 3 seconds" }), ms);
    w.onmessage = (e: MessageEvent<RunResult>) => done(e.data);
    w.onerror = (e: ErrorEvent) => done({ output: "", error: e.message });
    w.postMessage(code);
  });
}
