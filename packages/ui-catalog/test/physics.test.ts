import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, simulateLaunch, type PhysicsProps } from "../src/index.ts";

const issues = (kind: unknown) =>
  parseSpec({ v: 1, blocks: [{ type: "game", id: "g", props: { title: "T", goalText: "G", alt: "A", hints: [], shell: {}, kind } }] }).issues;
const kind = (x: number, width: number, maxSpeed: number): PhysicsProps => ({ kind: "physics", target: { x, width }, maxSpeed });

test("a reachable target parses cleanly", () => {
  assert.deepEqual(issues(kind(20, 2, 20)), []);
});

test("an unreachable target is rejected at save", () => {
  // At 10 m/s the farthest throw is about 10.2 m.
  const r = issues(kind(60, 2, 10));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.path, "blocks.0.props.kind.target");
});

test("the same launch gives the same outcome every time, and 45 degrees lands near v squared over g", () => {
  const a = simulateLaunch(kind(20, 2, 20), 45, 14);
  assert.deepEqual(simulateLaunch(kind(20, 2, 20), 45, 14), a);
  assert.ok(Math.abs(a.landX - (14 * 14) / 9.8) < 0.5);
  assert.equal(a.hit, true);
  assert.equal(simulateLaunch(kind(20, 2, 20), 45, 5).hit, false);
});
