import test from "node:test";
import assert from "node:assert/strict";
import { Worker as NodeWorker } from "node:worker_threads";
import { runJs, SRC } from "./runJs.ts";

// Node has no browser Worker, so run the same SRC in a worker thread behind the same shape.
const spawn = (): Worker => {
  const boot = `const {parentPort:p}=require("worker_threads");globalThis.postMessage=(m)=>p.postMessage(m);p.on("message",(d)=>globalThis.onmessage({data:d}));${SRC}`;
  const w = new NodeWorker(boot, { eval: true });
  const o = {
    postMessage: (m: string) => w.postMessage(m),
    terminate: () => void w.terminate(),
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onerror: null as ((e: { message: string }) => void) | null,
  };
  w.on("message", (data) => o.onmessage?.({ data }));
  w.on("error", (e: Error) => o.onerror?.({ message: e.message }));
  return o as unknown as Worker; // only the members runJs touches
};

test("prints console.log lines", async () => {
  assert.deepEqual(await runJs('console.log("a", 1); console.log("b")', 3000, spawn), { output: "a 1\nb", error: undefined });
});

test("reports a thrown error", async () => {
  const r = await runJs('throw new Error("boom")', 3000, spawn);
  assert.match(r.error ?? "", /boom/);
});

test("kills an infinite loop", async () => {
  const r = await runJs("while (true) {}", 200, spawn);
  assert.match(r.error ?? "", /Timed out/);
});
