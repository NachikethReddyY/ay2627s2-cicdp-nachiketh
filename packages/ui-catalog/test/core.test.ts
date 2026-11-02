import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { z } from "zod";
import { BLOCKS, RESERVED, alt, blockSchema, color, parseSpec, sanitize, text, type BlockModule, type ParseResult } from "../src/index.ts";

// Test-only module: the core ships with an empty registry, so fixtures use "probe".
const probe: BlockModule<{ title: string; alt: string; tone?: string; secret?: { token: string } }> = {
  type: "probe",
  schema: z.strictObject({ title: text(40), alt: alt(), tone: color().optional(), secret: z.strictObject({ token: text(40) }).optional() }),
  check: (b) => (b.props.title === "forbidden" ? [{ path: "props.title", message: "forbidden title" }] : []),
  describe: (b) => `Probe: ${b.props.title}`,
  prompt: "probe: a test block",
  budget: 2,
};
const reg = [probe];

const fixture = (name: string) => readFileSync(new URL(`../fixtures/core/${name}`, import.meta.url), "utf8");
const parse = (name: string) => parseSpec(fixture(name), reg);
const paths = (r: ParseResult) => r.issues.map((i) => i.path);

test("registry holds text and image and reserves run", () => {
  assert.deepEqual(BLOCKS.map((m) => m.type), ["text", "image", "diagram", "chart", "stage", "scene3d", "game"]);
  assert.ok(RESERVED.includes("run"));
});

test("valid fixture passes with no issues", () => {
  const r = parse("valid.json");
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.spec.blocks.map((b) => b.id), ["intro", "b_2"]);
  assert.equal(probe.describe(r.spec.blocks[0] as never), "Probe: Hello");
});

for (const [name, path] of [
  ["v2.json", "v"],
  ["empty-blocks.json", "blocks"],
  ["too-many-blocks.json", "blocks"],
  ["extra-envelope-key.json", "theme"],
  ["oversize.json", "$"],
] as const) {
  test(`envelope rejects the whole spec: ${name}`, () => {
    const r = parse(name);
    assert.equal(r.ok, false);
    assert.deepEqual(paths(r), [path]);
  });
}

test("oversize is rejected for its size, not its content", () => {
  assert.match(parse("oversize.json").issues[0].message, /65536 bytes/);
});

test("invalid JSON is an envelope failure", () => {
  assert.deepEqual(parseSpec("{nope", reg).issues, [{ path: "$", message: "spec is not valid JSON" }]);
});

test("unknown property paths escape dots within a key", () => {
  const block = { type: "probe", id: "x", props: { title: "ok", alt: "ok", "secret.token": 1 } };
  const dottedKey = parseSpec({ v: 1, blocks: [block] }, reg).issues[0].path;
  const nested = parseSpec({ v: 1, blocks: [{ ...block, props: { title: "ok", alt: "ok", secret: { token: 1 } } }] }, reg).issues[0].path;
  assert.equal(dottedKey, "blocks.0.props.secret\\.token");
  assert.equal(nested, "blocks.0.props.secret.token");
  assert.notEqual(dottedKey, nested);
  const backslashKey = parseSpec(
    { v: 1, blocks: [{ ...block, props: { title: "ok", alt: "ok", "secret\\token": 1 } }] },
    reg,
  ).issues[0].path;
  assert.equal(backslashKey, "blocks.0.props.secret\\\\token");
});

// Each fixture has a good block 0 and a bad block 1: the bad one is dropped, the good one kept.
for (const [name, path, message] of [
  ["unknown-type.json", "blocks.1.type", /unknown block type "globe"/],
  ["reserved-run.json", "blocks.1.type", /"run" blocks are not available/],
  ["extra-prop.json", "blocks.1.props.foo", /unknown property/],
  ["extra-block-key.json", "blocks.1.style", /unknown property/],
  ["bad-id.json", "blocks.1.id", /./],
  ["bad-color.json", "blocks.1.props.tone", /./],
  ["missing-alt.json", "blocks.1.props.alt", /./],
  ["duplicate-id.json", "blocks.1.id", /duplicate block id/],
  ["check-fail.json", "blocks.1.props.title", /forbidden title/],
] as const) {
  test(`block rejected with a path: ${name}`, () => {
    const r = parse(name);
    assert.ok(r.ok);
    assert.deepEqual(r.spec.blocks.map((b) => b.id), ["intro"]);
    assert.deepEqual(paths(r), [path]);
    assert.match(r.issues[0].message, message);
  });
}

test("budget caps blocks per type", () => {
  const r = parse("over-budget.json");
  assert.ok(r.ok);
  assert.equal(r.spec.blocks.length, 2);
  assert.deepEqual(paths(r), ["blocks.2"]);
});

// the "disabled" message needs a module in BLOCKS; covered below with text.
test("a type outside the enabled list is rejected", () => {
  const r = parseSpec(fixture("valid.json"), []);
  assert.equal(r.ok, false);
  assert.match(r.issues[0].message, /unknown block type "probe"/);
});

test("spec with no surviving blocks is not ok", () => {
  const r = parseSpec({ v: 1, blocks: [{ type: "run", id: "r", props: {} }] }, reg);
  assert.equal(r.ok, false);
  assert.deepEqual(paths(r), ["blocks.0.type"]);
});

test("text fields are sanitised", () => {
  const r = parse("unsafe-text.json");
  assert.ok(r.ok);
  assert.deepEqual(r.spec.blocks[0].props, { title: "Hi A", alt: "Alt" });
});

test("block schema converts to JSON Schema", () => {
  const js = z.toJSONSchema(blockSchema(probe.type, probe.schema)) as { additionalProperties: boolean };
  assert.equal(js.additionalProperties, false);
});

const UNSAFE = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

test("fuzz: sanitize output has no control, bidi or zero-width chars and is stable", () => {
  fc.assert(
    fc.property(fc.string({ unit: "binary" }), (s) => {
      const out = sanitize(s);
      assert.ok(!UNSAFE.test(out));
      assert.equal(sanitize(out), out);
    }),
    { numRuns: 2000 },
  );
});

test("fuzz: parseSpec never throws and always returns a result", () => {
  const block = fc.record({ type: fc.constantFrom("probe", "run", "x", 1), id: fc.string(), props: fc.anything() }, { requiredKeys: [] });
  const spec = fc.oneof(
    fc.anything(),
    fc.string(),
    fc.json(),
    fc.record({ v: fc.constantFrom(1, 2, "1"), blocks: fc.array(fc.oneof(block, fc.anything()), { maxLength: 14 }) }),
  );
  fc.assert(
    fc.property(spec, (input) => {
      const r = parseSpec(input, reg);
      assert.equal(typeof r.ok, "boolean");
      assert.ok(Array.isArray(r.issues));
      assert.ok(r.ok || r.issues.length > 0);
    }),
    { numRuns: 1000 },
  );
});
