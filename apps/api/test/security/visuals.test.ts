import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validatePart } from "../../src/visuals/gate.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/injection.json", import.meta.url), "utf8"));

test("injection fixture keeps learner text but drops executable visual blocks", () => {
  const part = validatePart(fixture);
  assert.equal(part?.body, fixture.body);
  assert.equal(part?.doc, undefined);
});

test("seeded malformed visual inputs never escape the part validator", () => {
  let seed = 0x68c0ffee;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let i = 0; i < 500; i += 1) {
    const blocks = Array.from({ length: Math.floor(random() * 8) }, (_, index) => ({
      type: random() < 0.5 ? "run" : `unknown-${Math.floor(random() * 20)}`,
      id: `fuzz-${i}-${index}`,
      props: { payload: "<script>alert(1)</script>" },
    }));
    const part = validatePart({ body: "untrusted learner text", doc: { v: 1, blocks } });
    assert.equal(part?.body, "untrusted learner text");
    assert.ok(part?.doc === undefined || part.doc.blocks.every((block) => block.type !== "run"));
  }
});
