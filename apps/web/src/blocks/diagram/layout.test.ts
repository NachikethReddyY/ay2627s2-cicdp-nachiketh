import test from "node:test";
import assert from "node:assert/strict";
import dagre from "@dagrejs/dagre";
import { CHAR_W, clipToShape, layoutDiagram, nodeSize, wrap, type DiagramProps } from "./layout.ts";

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

test("clipToShape: circle, diamond and rect boundaries", () => {
  const n = { x: 100, y: 100, w: 80, h: 40 };
  const c = clipToShape({ ...n, h: 80 }, { x: 100, y: 0 }, "circle");
  assert.ok(Math.abs(c.x - 100) < 1e-9 && Math.abs(c.y - 60) < 1e-9);
  const d = clipToShape(n, { x: 200, y: 200 }, "diamond"); // on |dx|/40 + |dy|/20 = 1
  assert.ok(Math.abs(Math.abs(d.x - 100) / 40 + Math.abs(d.y - 100) / 20 - 1) < 1e-9);
  assert.deepEqual(clipToShape(n, { x: 100, y: 0 }, "diamond"), { x: 100, y: 80 });
  assert.deepEqual(clipToShape(n, { x: 300, y: 100 }), { x: 140, y: 100 }); // rect: already on the box edge
});

test("long labels are widened to at most 3 lines where possible; edge labels reserve room", () => {
  const label = "a fairly long node label that would wrap onto many lines";
  const l = layoutDiagram(dagre, { kind: "flow", nodes: [{ id: "a", label }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", label: "yes" }] });
  assert.ok(l.nodes[0].lines.length <= 4 && l.nodes[0].lines.length < wrap(label).length);
  assert.ok(l.edges[0].lw > 0 && l.edges[0].lh > 0);
});
