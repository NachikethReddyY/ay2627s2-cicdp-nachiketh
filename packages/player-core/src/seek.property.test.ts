import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { buildTimeline, seek, type Hunk, type StepInput } from "./index.ts";

const lineArb = fc.string({ minLength: 0, maxLength: 6, unit: fc.constantFrom("a", "b", "c", " ", "x") });

const stepArb: fc.Arbitrary<StepInput> = fc
  .record({
    lines: fc.array(lineArb, { minLength: 1, maxLength: 12 }),
    inserts: fc.array(fc.record({ at: fc.nat(11), text: lineArb }), { minLength: 0, maxLength: 4 }),
  })
  .map(({ lines, inserts }) => {
    const before = lines.join("\n");
    const sorted = [...new Map(inserts.map((i) => [Math.min(i.at, lines.length - 1), i])).values()].sort(
      (a, b) => Math.min(a.at, lines.length - 1) - Math.min(b.at, lines.length - 1),
    );
    const hunks: Hunk[] = sorted.map((ins, n) => {
      const at = Math.min(ins.at, lines.length - 1);
      return { id: `h${n}`, file: "f.ts", oldStart: at + 1, lines: [` ${lines[at]}`, `+${ins.text}`] };
    });
    return { beforeFiles: { "f.ts": before }, hunks };
  });

const timelineArb = fc.array(stepArb, { minLength: 1, maxLength: 3 }).map((steps) => buildTimeline(steps));

test("seeking the same time twice gives the same result", () => {
  fc.assert(
    fc.property(timelineArb, fc.double({ min: -100, max: 100_000, noNaN: true }), (tl, t) => {
      assert.deepEqual(seek(tl, t), seek(tl, t));
    }),
  );
});

test("seeking never mutates the timeline", () => {
  fc.assert(
    fc.property(timelineArb, fc.double({ min: 0, max: 100_000, noNaN: true }), (tl, t) => {
      const frozen = JSON.stringify(tl);
      seek(tl, t);
      assert.equal(JSON.stringify(tl), frozen);
    }),
  );
});

test("later seek times never apply fewer events", () => {
  fc.assert(
    fc.property(
      timelineArb,
      fc.double({ min: -100, max: 100_000, noNaN: true }),
      fc.double({ min: -100, max: 100_000, noNaN: true }),
      (tl, a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        assert.ok(seek(tl, early).eventIndex <= seek(tl, late).eventIndex);
      },
    ),
  );
});

test("the event index only counts events strictly before the seek time", () => {
  fc.assert(
    fc.property(timelineArb, fc.double({ min: 0, max: 100_000, noNaN: true }), (tl, t) => {
      const { eventIndex } = seek(tl, t);
      const clamped = Math.min(t, tl.duration);
      assert.ok(eventIndex === tl.events.length || tl.events[eventIndex].t >= clamped);
    }),
  );
});

test("seeking past the end equals seeking to the end, and below zero equals zero", () => {
  fc.assert(
    fc.property(timelineArb, (tl) => {
      assert.deepEqual(seek(tl, tl.duration + 5_000), seek(tl, tl.duration));
      assert.deepEqual(seek(tl, -5_000), seek(tl, 0));
    }),
  );
});

test("replayed events never exceed the events applied", () => {
  fc.assert(
    fc.property(timelineArb, fc.double({ min: 0, max: 100_000, noNaN: true }), (tl, t) => {
      const r = seek(tl, t);
      assert.ok(r.replayed >= 0 && r.replayed <= r.eventIndex);
    }),
  );
});
