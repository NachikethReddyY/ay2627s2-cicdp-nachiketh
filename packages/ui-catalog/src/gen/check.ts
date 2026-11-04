// Sidecar for the engine: reads one JSON doc on stdin, prints {"issues": [{path, message}]} (empty when clean).
import { readFileSync } from "node:fs";
import { parseSpec } from "../index.ts";

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(0, "utf8"));
} catch {
  raw = undefined;
}
console.log(JSON.stringify({ issues: parseSpec(raw).issues }));
