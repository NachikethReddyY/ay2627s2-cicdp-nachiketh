import { out, signUp, trpc } from "./helpers.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { count } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, hintEvents, learners, partCompletions, stepProgress } from "../src/db/schema.ts";
import { publicScrimSegments, scrimGateOpen, type ScrimGateState } from "../src/lessons/scrim.ts";
import { parseScrim } from "../src/parts/scrim-schema.ts";
import { insertScrimLesson, scrimOf, secrets, segmentCode, segmentText, type SegmentPlan } from "./scrim-fixture.ts";

const app = buildApp();
after(() => app.close());

function rng(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function randomPlan(random: () => number): SegmentPlan[] {
  const length = 2 + Math.floor(random() * 7);
  const gated = Array.from({ length }, (_, index) => index).filter(() => random() < 0.45);
  if (gated.length === 0) gated.push(Math.floor(random() * length));
  const order = shuffled(gated.map((_, gate) => gate), random);
  return Array.from({ length }, (_, index) => {
    const at = gated.indexOf(index);
    return { ...(random() < 0.7 && { edit: true }), ...(at >= 0 && { gate: order[at]! }) };
  });
}

const privateOf = (gate: number) => {
  const { before, hint, hunk, worked, practice } = secrets(gate);
  return [before, hint, hunk, worked, practice];
};

const STATES = ["none", "predicting", "hinting", "revealed", "skipped"] as const;

function assertNoMarkers(body: string, markers: readonly string[], label: string) {
  for (const marker of markers) assert.ok(!body.includes(marker), `${label}: leaked ${marker}`);
}

test("for any scrim, no segment after an unrevealed gate is serialized by the pure helper", () => {
  const random = rng(0x11223344);
  for (let run = 0; run < 500; run++) {
    const plan = randomPlan(random);
    const scrim = scrimOf(plan);
    const gates = new Map<number, ScrimGateState>();
    let pending = -1;
    plan.forEach((segment, index) => {
      if (segment.gate === undefined) return;
      const state = (["predicting", "hinting", "revealed"] as const)[Math.floor(random() * 3)]!;
      gates.set(segment.gate, { id: `step-${segment.gate}`, state });
      if (state !== "revealed" && pending < 0) pending = index;
    });
    const result = publicScrimSegments(scrim, gates);
    const end = pending < 0 ? plan.length : pending + 1;
    assert.equal(result.nextOffset, end, `run ${run}`);
    assert.equal(result.segments.length, end, `run ${run}`);
    const serialized = JSON.stringify(result.segments);
    for (let index = end; index < plan.length; index++) assertNoMarkers(serialized, [segmentText(index), segmentCode(index)], `run ${run}`);
    if (pending >= 0) assertNoMarkers(serialized, [segmentCode(pending)], `run ${run}`);
    plan.forEach((segment, index) => {
      if (segment.gate === undefined) return;
      assert.equal(scrimGateOpen(scrim, gates, segment.gate), pending < 0 || index <= pending, `run ${run}: gate ${segment.gate}`);
    });
  }
});

test("over generated scrims, lessons.get, scrimMore and every step route never expose anything past the first unrevealed gate", async () => {
  const cookie = await signUp(app);
  const t = trpc(app, cookie);
  assert.equal((await t.q("lessons.get", { id: "no-such-lesson" })).statusCode, 404);
  const [learner] = await db.select({ id: learners.id }).from(learners);
  const random = rng(0x5eed1234);
  for (let run = 0; run < 24; run++) {
    const plan = randomPlan(random);
    const slug = `prop-${run}`;
    const label = `run ${run} ${JSON.stringify(plan)}`;
    const { scrim, lessonId, stepIds, worldSlug } = await insertScrimLesson(slug, plan);
    assert.ok(parseScrim(scrim), `${label}: fixture is a valid scrim`);

    const gateStates = new Map<number, (typeof STATES)[number]>();
    for (const [gate, stepId] of stepIds) {
      const state = STATES[Math.floor(random() * STATES.length)]!;
      gateStates.set(gate, state);
      if (state === "none") continue;
      await db.insert(stepProgress).values({
        learnerId: learner.id, stepId, state, rungsTaken: state === "hinting" ? 1 : 0, attemptAllowed: true,
      });
    }
    const gateSegments = plan.flatMap((segment, index) => (segment.gate === undefined ? [] : [{ gate: segment.gate, index }]));
    const pendingSegment = gateSegments.find(({ gate }) => gateStates.get(gate) !== "revealed")?.index ?? -1;
    const end = pendingSegment < 0 ? plan.length : pendingSegment + 1;
    const open = new Set(gateSegments.filter(({ index }) => pendingSegment < 0 || index <= pendingSegment).map(({ gate }) => gate));
    const closedGates = gateSegments.filter(({ gate }) => !open.has(gate)).map(({ gate }) => gate);
    const beyond = Array.from({ length: plan.length - end }, (_, i) => end + i);
    const beyondMarkers = [
      ...beyond.flatMap((index) => [segmentText(index), segmentCode(index)]),
      ...(pendingSegment >= 0 ? [segmentCode(pendingSegment)] : []),
      ...closedGates.flatMap((gate) => Object.values(secrets(gate))),
    ];
    const everySecret = [...stepIds.keys()].flatMap(privateOf);
    const closedMarkers = closedGates.flatMap((gate) => Object.values(secrets(gate)));

    const lesson = await t.q("lessons.get", { id: slug });
    assert.equal(lesson.statusCode, 200, `${label}: ${lesson.body}`);
    const body = out(lesson);
    assert.equal(body.part.segments.length, end, label);
    assert.deepEqual(body.part.segments.map((s: { text: string }) => s.text), plan.slice(0, end).map((_, i) => segmentText(i)), label);
    assertNoMarkers(lesson.body, [...beyondMarkers, ...everySecret], `${label}: lessons.get`);
    const served = gateSegments.filter(({ index }) => index < end).map(({ gate }) => stepIds.get(gate)!);
    assert.deepEqual(body.steps.map((s: { id: string }) => s.id).sort(), [...served].sort(), `${label}: steps are only the served gates`);
    assert.deepEqual(body.part.segments.flatMap((s: { gate?: string }) => (s.gate ? [s.gate] : [])), served, label);

    for (const from of [0, 1, end - 1, end, end + 1, 20]) {
      const more = await t.q("lessons.scrimMore", { id: slug, from });
      if (from > end) {
        assert.equal(more.statusCode, 409, `${label}: from ${from}`);
        assertNoMarkers(more.body, [...beyondMarkers, ...everySecret], `${label}: scrimMore ${from}`);
        continue;
      }
      assert.equal(more.statusCode, 200, `${label}: from ${from}: ${more.body}`);
      const page = out(more);
      assert.deepEqual([page.from, page.nextOffset, page.complete], [from, end, end === plan.length], `${label}: from ${from}`);
      assert.equal(page.segments.length, end - from, `${label}: from ${from}`);
      assertNoMarkers(more.body, [...beyondMarkers, ...everySecret], `${label}: scrimMore ${from}`);
    }

    const rowCounts = async () => [
      (await db.select({ n: count() }).from(stepProgress))[0]!.n,
      (await db.select({ n: count() }).from(attempts))[0]!.n,
      (await db.select({ n: count() }).from(hintEvents))[0]!.n,
    ];
    const before = await rowCounts();
    for (const [gate, stepId] of stepIds) {
      const input = { id: stepId };
      const isOpen = open.has(gate);
      const where = `${label}: gate ${gate} (${gateStates.get(gate)}, ${isOpen ? "open" : "closed"})`;
      const get = await t.q("steps.get", input);
      const reveal = await t.q("steps.reveal", input);
      const skip = await t.m("steps.skip", input);
      if (!isOpen) {
        const attempt = await t.m("steps.attempt", { ...input, answer: { kind: "mcq", choice: 1 } });
        const hint = await t.m("steps.hint", input);
        for (const res of [get, reveal, attempt, hint, skip]) {
          assert.equal(res.statusCode, 409, `${where}: ${res.body}`);
          assertNoMarkers(res.body, Object.values(secrets(gate)), where);
        }
        continue;
      }
      assert.equal(get.statusCode, 200, `${where}: ${get.body}`);
      assert.equal(reveal.statusCode, gateStates.get(gate) === "revealed" ? 200 : 409, where);
      assert.equal(skip.statusCode, 409, `${where}: scrim gates cannot be skipped`);
      assertNoMarkers([get, reveal, skip].map((res) => res.body).join(""), closedMarkers, where);
    }
    assert.deepEqual(await rowCounts(), before, `${label}: refused step routes wrote nothing`);

    await db.insert(partCompletions).values({ lessonId, learnerId: learner.id });
    const allRevealed = [...gateStates.values()].every((state) => state === "revealed");
    const course = out(await t.q("courses.get", { slug: worldSlug }));
    assert.equal(course.lessons.find((l: { slug: string }) => l.slug === slug).done, allRevealed ? 1 : 0, `${label}: lab alone or skipped gates must not complete`);
  }
});
