import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { alt, text, type BlockModule } from "../src/index.ts";
import { catalog, jsonSchema, specSchema } from "../src/gen/build.ts";
import { stale } from "../src/gen/main.ts";

const probe: BlockModule = {
  type: "probe",
  schema: z.strictObject({ title: text(40), alt: alt() }),
  check: () => [],
  describe: () => "probe",
  prompt: "Probe: a test block.\nExample: {}",
  budget: 2,
};
const other: BlockModule = { ...probe, type: "a_other", prompt: "Other block." };
const block = { type: "probe", id: "p", props: { title: "Hi", alt: "A" } };

test("committed visual.schema.json and visual.catalog.md match the generator", () => {
  assert.deepEqual(stale(), [], "run `pnpm --filter @learnquest/ui-catalog gen`");
});

test("empty registry: schema accepts no spec, catalog says so", () => {
  assert.equal(specSchema([]).safeParse({ v: 1, blocks: [block] }).success, false);
  assert.deepEqual(JSON.parse(jsonSchema([])).properties.blocks.items, { not: {} });
  assert.match(catalog([]), /No block types are available yet/);
});

test("registered modules form a closed, discriminated union", () => {
  const s = specSchema([probe, other]);
  assert.ok(s.safeParse({ v: 1, blocks: [block] }).success);
  assert.equal(s.safeParse({ v: 1, blocks: [{ ...block, type: "chart" }] }).success, false);
  assert.equal(s.safeParse({ v: 1, blocks: [{ ...block, props: { ...block.props, x: 1 } }] }).success, false);
  const items = JSON.parse(jsonSchema([probe, other])).properties.blocks.items;
  assert.deepEqual(items.oneOf.map((o: any) => o.properties.type.const), ["a_other", "probe"]);
});

test("catalog is sorted and carries each module's prompt, budget and props", () => {
  const md = catalog([probe, other]);
  assert.ok(md.indexOf("### a_other") < md.indexOf("### probe"));
  assert.match(md, /### probe\n\nAt most 2 per spec\.\n\nProbe: a test block\.\nExample: \{\}/);
  assert.match(md, /"maxLength":40/);
  assert.equal(md, catalog([other, probe]));
});
