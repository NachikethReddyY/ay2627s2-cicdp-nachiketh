import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { K, buildTimeline, filesAtEnd, seek, type Files, type Hunk, type ReplayEvent, type Timeline } from "./index.ts";

const hunk = (file: string, oldStart: number, lines: string[], id = "h"): Hunk => ({ id, file, oldStart, lines });

test("worked example: insert-only + modify hunks", () => {
  const before = "a\nb\nc\nd\ne\nf";
  const tl = buildTimeline([
    {
      beforeFiles: { "x.ts": before },
      hunks: [
        hunk("x.ts", 2, [" b", "+b2", " c"]),
        hunk("x.ts", 5, [" e", "-f", "+ff!"], "h2"),
      ],
    },
  ]);
  assert.equal(filesAtEnd(tl)["x.ts"], "a\nb\nb2\nc\nd\ne\nff!");
});

test("two steps: boundary snapshot", () => {
  const s1 = { beforeFiles: { "a.ts": "one\ntwo\n" }, hunks: [hunk("a.ts", 2, ["-two", "+2"])] };
  const end1 = "one\n2\n";
  const s2 = { beforeFiles: { "a.ts": end1 }, hunks: [hunk("a.ts", 1, ["-one", "+1"])] };
  const tl = buildTimeline([s1, s2]);
  assert.equal(tl.steps.length, 2);
  assert.ok(tl.snapshots.some((s) => s.eventIndex === tl.steps[1].startEvent));
  assert.deepEqual(seek(tl, tl.steps[1].startT).files, s2.beforeFiles);
  assert.equal(filesAtEnd(tl)["a.ts"], "1\n2\n");
});

test("multi-file file events, EOF without newline, block", () => {
  const big = Array.from({ length: 25 }, (_, i) => `+line${i}`);
  const tl = buildTimeline([
    {
      beforeFiles: { "a.ts": "x\ny", "b.ts": "p\nq\n" },
      hunks: [hunk("a.ts", 2, ["-y", "+yz", "+w"]), hunk("b.ts", 1, [" p", ...big])],
    },
  ]);
  assert.equal(tl.events.filter((e) => e.kind === "file").length, 1);
  assert.equal(tl.events.filter((e) => e.kind === "block").length, 1);
  const end = filesAtEnd(tl);
  assert.equal(end["a.ts"], "x\nyz\nw");
  assert.equal(end["b.ts"], "p\n" + big.map((l) => l.slice(1)).join("\n") + "\nq\n");
});

test("pure insert / delete hunks keep newlines right", () => {
  const tl = buildTimeline([
    { beforeFiles: { f: "a\nb\nc" }, hunks: [hunk("f", 1, ["+z"]), hunk("f", 3, ["-c"])] },
  ]);
  assert.equal(filesAtEnd(tl).f, "z\na\nb");
});

test("mismatched hunk throws", () => {
  assert.throws(
    () => buildTimeline([{ beforeFiles: { f: "a\nb" }, hunks: [hunk("f", 1, [" nope", "+x"])] }]),
    /does not match/,
  );
});

test("deterministic", () => {
  const steps = [{ beforeFiles: { f: "a\nb" }, hunks: [hunk("f", 1, ["-a", "+hello", " b"])] }];
  assert.deepStrictEqual(buildTimeline(steps), buildTimeline(steps));
});

test("seek replays at most K events", () => {
  const before = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
  const after = Array.from({ length: 50 }, (_, i) => `line number ${i} changed`).join("\n");
  const old = before.split("\n").map((l) => "-" + l);
  const tl = buildTimeline([
    { beforeFiles: { f: before }, hunks: [hunk("f", 1, [...old, ...after.split("\n").map((l) => "+" + l)])] },
  ], { msPerChar: 10, lineEndPauseMs: 0, blockThresholdLines: 1000 });
  assert.ok(tl.events.length > 1000);
  for (let i = 0; i <= 500; i++) assert.ok(seek(tl, (tl.duration * i) / 500).replayed <= K);
  assert.equal(filesAtEnd(tl).f, after);
});

function naive(tl: Timeline, files: Files, t: number): Files {
  const out = { ...files };
  for (const e of tl.events as ReplayEvent[]) {
    if (!(e.t < t) || e.kind === "file") continue;
    const s = out[e.path];
    out[e.path] =
      e.kind === "insert" ? s.slice(0, e.offset) + e.text + s.slice(e.offset)
      : e.kind === "delete" ? s.slice(0, e.offset) + s.slice(e.offset + e.length)
      : s.slice(0, e.offset) + e.text + s.slice(e.offset + e.deleteLength);
  }
  return out;
}

const text = fc.array(fc.constantFrom("a", "b", "cd", "", " x"), { maxLength: 12 }).map((l) => l.join("\n"));

test("property: end state and seek equal naive replay", () => {
  fc.assert(
    fc.property(text, text, fc.boolean(), fc.double({ min: 0, max: 1, noNaN: true }), (before, after, ctx, frac) => {
      const o = before.split("\n");
      const n = after.split("\n");
      let p = 0;
      let q = 0;
      if (ctx) {
        while (p < o.length && p < n.length && o[p] === n[p]) p++;
        while (q < o.length - p && q < n.length - p && o[o.length - 1 - q] === n[n.length - 1 - q]) q++;
      }
      const lines = [
        ...o.slice(0, p).map((l) => " " + l),
        ...o.slice(p, o.length - q).map((l) => "-" + l),
        ...n.slice(p, n.length - q).map((l) => "+" + l),
        ...o.slice(o.length - q).map((l) => " " + l),
      ];
      const files = { f: before };
      const tl = buildTimeline([{ beforeFiles: files, hunks: [hunk("f", 1, lines)] }]);
      assert.equal(filesAtEnd(tl).f, after);
      const t = frac * tl.duration;
      assert.deepEqual(seek(tl, t).files, naive(tl, files, t));
    }),
    { numRuns: 200 },
  );
});

test("an empty hunk line is treated as a blank context line", () => {
  const tl = buildTimeline([{ beforeFiles: { f: "a\n\nb" }, hunks: [hunk("f", 1, [" a", "", "-b", "+c"])] }]);
  assert.equal(filesAtEnd(tl).f, "a\n\nc");
});
