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
