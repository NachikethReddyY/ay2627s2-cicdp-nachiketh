import test from "node:test";
import assert from "node:assert/strict";
import dagre from "@dagrejs/dagre";
import { CHAR_W, layoutDiagram, nodeSize, wrap, type DiagramProps } from "./layout.ts";

test("wrap keeps every line within the cap, even for one long word", () => {
  for (const s of ["a b c", "x".repeat(60), "the quick brown fox jumps over the lazy dog again and again"])
    assert.ok(wrap(s).every((l) => l.length <= 14), s);
  assert.equal(wrap("x".repeat(60)).join(""), "x".repeat(60));
});

const wide = (n: number, shape?: DiagramProps["shape"], kind = "graph"): DiagramProps => ({
  kind, shape,
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node number ${i} with a long label ${"w".repeat(30)}`.slice(0, 60) })),
  // a fan-out from n0 puts the other nodes in one rank (the widest case), plus a cycle edge
  edges: [...Array.from({ length: n - 1 }, (_, i) => ({ from: "n0", to: `n${i + 1}`, label: "edge label" })), { from: `n${n - 1}`, to: "n0" }],
});

for (const shape of ["rect", "round", "diamond", "circle"] as const)
  for (const kind of ["graph", "timeline"])
    test(`30 nodes, ${shape}/${kind}: no box overlaps and text fits its box`, () => {
      const l = layoutDiagram(dagre, wide(30, shape, kind));
      assert.equal(l.nodes.length, 30);
      for (const [i, a] of l.nodes.entries()) {
        assert.ok(Math.max(...a.lines.map((s) => s.length)) * CHAR_W <= a.w);
        assert.ok(a.x - a.w / 2 >= 0 && a.x + a.w / 2 <= l.width && a.y - a.h / 2 >= 0 && a.y + a.h / 2 <= l.height);
        for (const b of l.nodes.slice(i + 1))
          assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2, `${a.id} overlaps ${b.id}`);
      }
      assert.ok(l.edges.every((e) => e.points.length >= 2));
    });

test("nodeSize grows for diamonds", () => {
  assert.ok(nodeSize(["abc"], "diamond").w > nodeSize(["abc"], "rect").w);
});
