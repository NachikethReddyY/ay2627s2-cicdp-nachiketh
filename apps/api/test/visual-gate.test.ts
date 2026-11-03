import assert from "node:assert/strict";
import test from "node:test";
import { validatePart } from "../src/visuals/gate.ts";

test("invalid visual document is dropped while lesson body survives", () => {
  const part = validatePart({
    body: "Fractions describe parts of a whole.",
    doc: { v: 1, blocks: [{ type: "run", id: "bad", props: {} }] },
  });

  assert.deepEqual(part, { body: "Fractions describe parts of a whole." });
});

test("valid blocks survive while unknown blocks are dropped", () => {
  const part = validatePart({
    body: "A chart compares values.",
    doc: {
      v: 1,
      blocks: [
        { type: "unknown", id: "bad", props: {} },
        { type: "text", id: "good", props: { md: "Values" } },
      ],
    },
  });

  assert.equal(part?.body, "A chart compares values.");
  assert.deepEqual(part?.doc?.blocks.map((block) => block.id), ["good"]);
});
