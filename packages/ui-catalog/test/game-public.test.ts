import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_BLOCKS, parseSpec, publicDoc, type GameProps } from "../src/index.ts";

const shell = { title: "T", goalText: "G", alt: "A game.", hints: ["secret hint"], shell: {} };
const kinds: GameProps["kind"][] = [
  { kind: "quiz", questions: [{ prompt: "p", options: ["a", "b"], answer: 1 }] },
  { kind: "order", items: ["x", "y", "z"] },
  { kind: "match", pairs: [{ left: "l1", right: "r1" }, { left: "l2", right: "r2" }] },
  { kind: "sort", buckets: ["A", "B"], cards: [{ text: "c1", bucket: 0 }, { text: "c2", bucket: 1 }] },
  { kind: "physics", target: { x: 20, width: 4 }, maxSpeed: 20 },
  {
    kind: "grid", size: { w: 4, h: 3 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 3, y: 2 }, walls: [], gems: [], commands: ["forward", "right"],
    mode: "solve", maxSteps: 12, maxBlocks: 7, solution: ["forward", "forward", "forward", "right", "forward", "forward"],
  },
];
const doc = { v: 1, blocks: kinds.map((kind, i) => ({ type: "game", id: `g${i}`, props: { ...shell, kind } })) };

test("a public game doc parses with the client registry and carries no answers", () => {
  const pub = publicDoc(doc, () => 0.5);
  // The catalog allows two games per doc, so parse them in pairs.
  const blocks = (pub as { blocks: unknown[] }).blocks;
  let parsed = 0;
  for (let i = 0; i < blocks.length; i += 2) {
    const res = parseSpec({ v: 1, blocks: blocks.slice(i, i + 2) }, CLIENT_BLOCKS);
    assert.equal(res.ok, true, JSON.stringify(res.issues));
    assert.deepEqual(res.issues, []);
    parsed += res.ok ? res.spec.blocks.length : 0;
  }
  assert.equal(parsed, kinds.length);
  const raw = JSON.stringify(pub);
  for (const secret of ["secret hint", '"answer"', '"solution"', '"pairs"', '"bucket"']) assert.ok(!raw.includes(secret), secret);
});

test("the full game doc is not accepted by the client registry", () => {
  const res = parseSpec(doc, CLIENT_BLOCKS);
  assert.equal(res.ok, false);
});

test("a game block that does not validate is dropped, never passed through", () => {
  const bad = { v: 1, blocks: [{ type: "game", id: "bad", props: { title: "x", answer: 1 } }, { type: "text", id: "t", props: { body: "hi" } }] };
  const out = publicDoc(bad) as { blocks: { id: string }[] };
  assert.deepEqual(out.blocks.map((b) => b.id), ["t"]);
});
