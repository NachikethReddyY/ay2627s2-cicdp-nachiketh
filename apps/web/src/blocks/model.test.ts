import test from "node:test";
import assert from "node:assert/strict";
import { timelineSchema } from "@learnquest/ui-catalog";
import { initialPlaying, keyAction, motionAction, plan, stepReduce, tick } from "./model.ts";

const tl = timelineSchema.parse({
  steps: [0, 1, 2].map((i) => ({ caption: `s${i}`, durationMs: 500, set: [] })),
});

test("plan rejects unknown blocks but keeps their alt text", () => {
  const p = plan({ v: 1, blocks: [{ type: "nope", id: "a", props: { alt: "a chart" } }] });
  assert.equal(p.fatal, false);
  assert.deepEqual(p.items.map((i) => i.kind === "rejected" && i.alt), ["a chart"]);
});

test("plan treats a broken envelope as fatal", () => {
  assert.equal(plan("{not json").fatal, true);
  assert.equal(plan({ v: 2, blocks: [] }).fatal, true);
});

test("keyAction maps keys and leaves native controls alone", () => {
  assert.equal(keyAction(" "), "toggle");
  assert.equal(keyAction("ArrowLeft"), "prev");
  assert.equal(keyAction("ArrowRight"), "next");
  assert.equal(keyAction("Home"), "first");
  assert.equal(keyAction("End"), "last");
  assert.equal(keyAction("x"), null);
  assert.equal(keyAction(" ", "BUTTON"), null);
  assert.equal(keyAction("ArrowLeft", "input"), null);
});

test("stepReduce clamps, pauses on manual moves, and restarts from the end", () => {
  const playing = { step: 1, playing: true };
  assert.deepEqual(stepReduce(tl, playing, "next"), { step: 2, playing: false });
  assert.deepEqual(stepReduce(tl, { step: 0, playing: false }, "prev"), { step: 0, playing: false });
  assert.deepEqual(stepReduce(tl, playing, { goto: 99 }), { step: 2, playing: false });
  assert.deepEqual(stepReduce(tl, { step: 2, playing: false }, "play"), { step: 0, playing: true });
  assert.deepEqual(tick(tl, { step: 0, playing: true }), { step: 1, playing: true });
  assert.deepEqual(tick(tl, { step: 1, playing: true }), { step: 2, playing: false });
});

test("reduced motion turns autoplay off", () => {
  assert.equal(initialPlaying(true, false), true);
  assert.equal(initialPlaying(true, true), false);
  assert.equal(initialPlaying(undefined, false), false);
});

test("reduced motion turns Play into a single step", () => {
  assert.equal(motionAction("toggle", true), "next");
  assert.equal(motionAction("play", true), "next");
  assert.equal(motionAction("toggle", false), "toggle");
  assert.equal(motionAction("prev", true), "prev");
});

test("keyAction ignores keys with Alt, Ctrl or Meta held", () => {
  assert.equal(keyAction("ArrowLeft", "DIV", { alt: true }), null);
  assert.equal(keyAction("ArrowLeft", "DIV", { ctrl: true }), null);
  assert.equal(keyAction("Home", "DIV", { meta: true }), null);
  assert.equal(keyAction("ArrowLeft", "DIV", {}), "prev");
});

test("plan cleans alt text of rejected blocks", () => {
  const p = plan({ v: 1, blocks: [{ type: "nope", id: "a", props: { alt: "  hi\u0000 there  " } }] });
  const it = p.items[0];
  assert.equal(it?.kind === "rejected" && it.alt, "hi there");
});
