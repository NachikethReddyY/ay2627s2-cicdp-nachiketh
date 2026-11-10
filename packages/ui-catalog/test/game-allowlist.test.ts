import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { gameSchema, publicDoc, type GameProps } from "../src/index.ts";

/**
 * LQ-91 guard. Every key in the authored game schema must be classified here. A new key fails this test until
 * someone decides whether it is sent to the learner (SENT, and then it must be built in publicKind) or kept on the
 * server (WITHHELD). Unclassified keys therefore cannot reach the client by default.
 */
const SENT = new Set([
  "title", "goalText", "alt", "shell", "lives", "kind", "questions", "prompt", "options", "items", "buckets",
  "size", "w", "h", "start", "x", "y", "dir", "goal", "walls", "gems", "commands", "allowRepeat", "maxTimes", "maxBody",
  "maxBlocks", "mode", "maxSteps", "target", "width", "maxSpeed",
]);
// solution is sent for grid watch mode only and starter for debug mode only (see publicKind); the rest is never sent.
const WITHHELD = new Set(["hints", "answer", "pairs", "left", "right", "cards", "text", "bucket", "solution", "starter", "repeat", "body"]);
// Keys the public shape adds or renames (match and sort are reshaped into flat string lists).
const PUBLIC_ONLY = ["hintCount", "gameIndex", "lefts", "rights", "cards"];

function keysOf(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => keysOf(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.properties && typeof o.properties === "object") for (const k of Object.keys(o.properties)) out.add(k);
    for (const v of Object.values(o)) keysOf(v, out);
  }
  return out;
}

test("every key of the authored game schema is classified as sent or withheld", () => {
  const keys = keysOf(z.toJSONSchema(gameSchema as unknown as z.ZodType, { unrepresentable: "any", io: "input" }));
  const unclassified = [...keys].filter((k) => !SENT.has(k) && !WITHHELD.has(k));
  assert.deepEqual(unclassified, [], `classify new game keys in SENT or WITHHELD (and allowlist them in public.ts): ${unclassified.join(", ")}`);
  for (const k of SENT) assert.ok(!WITHHELD.has(k), `${k} is in both lists`);
});

const shell = { title: "T", goalText: "G", alt: "A game.", hints: ["h"], shell: { lives: 3 } };
const kinds: GameProps["kind"][] = [
  { kind: "quiz", questions: [{ prompt: "p", options: ["a", "b"], answer: 1 }] },
  { kind: "order", items: ["x", "y", "z"] },
  { kind: "match", pairs: [{ left: "l1", right: "r1" }, { left: "l2", right: "r2" }] },
  { kind: "sort", buckets: ["A", "B"], cards: [{ text: "c1", bucket: 0 }, { text: "c2", bucket: 1 }] },
  { kind: "physics", target: { x: 20, width: 4 }, maxSpeed: 20 },
  { kind: "grid", size: { w: 4, h: 3 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 3, y: 2 }, walls: [], gems: [], commands: ["forward", "right"], mode: "solve", maxSteps: 12, solution: ["forward", "right"] },
];

test("the public payload carries only allowlisted keys and no answer-like key", () => {
  const doc = { v: 1, blocks: kinds.map((kind, i) => ({ type: "game", id: `g${i}`, props: { ...shell, kind } })) };
  const out = publicDoc(doc, () => 0.5) as { blocks: { props: unknown }[] };
  const sent = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        sent.add(k);
        walk(x);
      }
    }
  };
  out.blocks.forEach((b) => walk(b.props));
  const extra = [...sent].filter((k) => !SENT.has(k) && !PUBLIC_ONLY.includes(k));
  assert.deepEqual(extra, []);
  const answerLike = [...sent].filter((k) => /answer|solution|key|hint|correct|accepted|expected|pairs|bucket$/i.test(k) && k !== "hintCount");
  assert.deepEqual(answerLike, []);
});
