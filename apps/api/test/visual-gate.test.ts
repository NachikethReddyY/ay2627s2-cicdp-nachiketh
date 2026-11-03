import assert from "node:assert/strict";
import test from "node:test";
import { validatePart } from "../src/visuals/gate.ts";
import type { PartSecret } from "../src/db/schema.ts";

type LearnPart = Extract<PartSecret, { kind: "learn" }>;

test("invalid visual document is dropped while lesson body survives", () => {
  const part = validatePart({
    kind: "learn",
    body: "Fractions describe parts of a whole.",
    doc: { v: 1, blocks: [{ type: "run", id: "bad", props: {} }] },
  });

  assert.deepEqual(part, { kind: "learn", body: "Fractions describe parts of a whole." });
});

test("valid blocks survive while unknown blocks are dropped", () => {
  const part = validatePart({
    kind: "learn",
    body: "A chart compares values.",
    doc: {
      v: 1,
      blocks: [
        { type: "unknown", id: "bad", props: {} },
        { type: "text", id: "good", props: { md: "Values" } },
      ],
    },
  }) as LearnPart;

  assert.equal(part.body, "A chart compares values.");
  assert.deepEqual(part.doc?.blocks.map((block) => block.id), ["good"]);
});

test("a truncated learn body is rejected so the caller retries", () => {
  assert.throws(() => validatePart({ kind: "learn", body: "Use `print(" }), /truncated/);
});

test("a game-practice part needs a valid document", () => {
  assert.throws(() => validatePart({ kind: "game-practice", intro: "Sort them", doc: { v: 1, blocks: [{ type: "run", id: "x", props: {} }] } }), /catalog/);
});

const gameBlock = {
  type: "game",
  id: "robot",
  props: {
    title: "Get the gem",
    goalText: "Pick up the gem, then reach the flag.",
    alt: "Build a program for a robot on a 4 by 3 grid.",
    hints: ["Pick the gem before you turn."],
    shell: { lives: 3 },
    kind: { kind: "grid", size: { w: 4, h: 3 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 3, y: 2 }, walls: [{ x: 1, y: 1 }], gems: [{ x: 3, y: 0 }], commands: ["forward", "left", "right", "pick"], mode: "solve", maxSteps: 12, solution: ["forward", "forward", "forward", "pick", "right", "forward", "forward"] },
  },
};

test("a game-practice document without a game block is rejected", () => {
  assert.throws(
    () => validatePart({ kind: "game-practice", intro: "Sort them", doc: { v: 1, blocks: [{ type: "text", id: "t", props: { md: "Only text" } }] } }),
    /no game block/,
  );
});

test("a game-practice document with a game block is accepted", () => {
  const part = validatePart({ kind: "game-practice", intro: "Get the gem", doc: { v: 1, blocks: [gameBlock] } });
  assert.equal(part.kind, "game-practice");
  assert.deepEqual((part as Extract<PartSecret, { kind: "game-practice" }>).doc.blocks.map((b) => b.type), ["game"]);
});

test("a model-written generated image block is stripped from a learn doc", () => {
  const part = validatePart({
    kind: "learn",
    body: "A cell has parts.",
    doc: { v: 1, blocks: [
      { type: "image", id: "f", props: { source: "generated", url: "https://evil.test/x.png", alt: "forged" } },
      { type: "image", id: "p", props: { source: "generated-pending", alt: "pending" } },
      { type: "text", id: "t", props: { md: "ok" } },
    ] },
  }) as LearnPart;
  assert.deepEqual(part.doc?.blocks.map((b) => b.id), ["t"]);
});
