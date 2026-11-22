import assert from "node:assert/strict";
import { test } from "node:test";
import { publicScrimSegments, type ScrimGateState } from "../src/lessons/scrim.ts";
import type { Scrim } from "../src/parts/scrim-schema.ts";

test("for any scrim, no segment after an unrevealed gate is serialized", () => {
  let seed = 0x11223344;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let run = 0; run < 500; run++) {
    const length = 1 + Math.floor(random() * 20);
    const segments: Scrim["segments"] = [];
    const gates = new Map<number, ScrimGateState>();
    let pending = -1;
    for (let index = 0; index < length; index++) {
      const hasGate = random() < 0.35;
      const state = random() < 0.5 ? "revealed" : random() < 0.5 ? "skipped" : "predicting";
      if (hasGate) gates.set(index, { id: `step-${index}`, state });
      if (hasGate && state !== "revealed" && state !== "skipped" && pending < 0) pending = index;
      segments.push({
        text: `text-${index}`,
        durationMs: 1000,
        ...(random() < 0.7 && { edit: { code: `private-code-${index}`, run: false } }),
        ...(hasGate && { gate: index }),
      });
    }
    const scrim = { kind: "scrim", language: "javascript", segments, lab: { kind: "practice", instructions: "", language: "javascript", starterCode: "", tests: [] } } as Scrim;
    const result = publicScrimSegments(scrim, gates);
    assert.equal(result.nextOffset, pending < 0 ? length : pending + 1, `run ${run}`);
    assert.equal(result.segments.length, result.nextOffset, `run ${run}`);
    const serialized = JSON.stringify(result.segments);
    for (let index = result.nextOffset; index < length; index++) {
      assert.ok(!serialized.includes(`text-${index}`), `run ${run}: text after gate ${pending} leaked`);
      assert.ok(!serialized.includes(`private-code-${index}`), `run ${run}: code after gate ${pending} leaked`);
    }
    if (pending >= 0) assert.ok(!serialized.includes(`private-code-${pending}`), `run ${run}: pending gate edit leaked`);
  }
});
