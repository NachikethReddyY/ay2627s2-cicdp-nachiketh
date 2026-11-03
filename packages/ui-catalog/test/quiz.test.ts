import { test } from "node:test";
import assert from "node:assert/strict";
import { gameBlock } from "../src/blocks/game/index.ts";
import type { GameProps } from "../src/blocks/game/schema.ts";

const valid: GameProps = {
  title: "Quick check", goalText: "Choose the right answer", alt: "Choose one option per question.", hints: [], shell: {},
  kind: { kind: "quiz", questions: [{ prompt: "Which is a number?", options: ["7", "seven"], answer: 0 }] },
};

test("quiz game accepts a well-formed multiple-choice game", () => {
  assert.deepEqual(gameBlock.schema.safeParse(valid).success, true);
  assert.deepEqual(gameBlock.check({ type: "game", id: "quiz", props: valid }), []);
});

test("quiz rejects an answer outside the options and duplicate options", () => {
  const bad = { ...valid, kind: { kind: "quiz" as const, questions: [{ prompt: "Q", options: ["same", "same"], answer: 2 }] } };
  assert.equal(gameBlock.check({ type: "game", id: "quiz", props: bad }).length, 2);
});
