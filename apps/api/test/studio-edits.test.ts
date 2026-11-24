process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { StudioDeps } from "../src/studio/route.ts";

const { CuedEdit, placeEdits } = await import("../src/studio/edits.ts");
const { studioRoutes } = await import("../src/studio/route.ts");

const heard = (line: string) =>
  line.split(" ").map((pair) => {
    const [text, start] = pair.split("@");
    return { text, start: Number(start), end: Number(start) + 0.1 };
  });

const SPOKEN = [
  heard("Start@0.12 with@0.36 an@0.5 empty@0.6 list@0.88 called@1.14 words.@1.48 Now@2.16 append@2.34 the@2.6 word@2.72 apple,@3.18 then@3.8 append@3.94 the@4.24 word@4.36 pear@4.76"),
  heard("Now@0.08 print@0.32 the@0.52 length@0.66 of@0.9 words.@1.08 It@1.76 prints@1.86 two@2.24 because@2.66"),
];

const edit = (segment: number, cue: string, predict: string | null = null) => ({ segment, cue, predict, code: `# ${cue}`, run: false });

test("each cue is timed at the start of its first heard word, ignoring case and punctuation", () => {
  const timed = placeEdits(
    [edit(0, "an empty list called words"), edit(0, "Apple. Then"), edit(1, "print the length of words")],
    SPOKEN,
  );
  assert.deepEqual(timed.map((t) => [t.segment, t.at, t.cueHeard]), [[0, 0.5, true], [0, 3.18, true], [1, 0.32, true]]);
});

test("quotes around a heard word do not stop a cue matching, but an inner apostrophe stays", () => {
  const timed = placeEdits([edit(0, "called words"), edit(0, "don't stop")], [heard("called@1.2 'Words'.@1.6 Don’t@2 stop@2.3")]);
  assert.deepEqual(timed.map((t) => [t.at, t.cueHeard]), [[1.2, true], [2, true]]);
});

test("a phrase said twice is matched in spoken order", () => {
  const timed = placeEdits([edit(0, "append the word"), edit(0, "append the word")], SPOKEN);
  assert.deepEqual(timed.map((t) => t.at), [2.34, 3.94]);
});

test("a cue the voice did not say keeps the previous edit's time and is flagged", () => {
  const timed = placeEdits([edit(0, "append the word apple"), edit(0, "a word nobody said"), edit(0, "pear")], SPOKEN);
  assert.deepEqual(timed.map((t) => [t.at, t.cueHeard]), [[2.34, true], [2.34, false], [4.76, true]]);
});

test("one misheard word still places a cue of three or more words, starting on its first word", () => {
  const whisper = [heard("Now@2.1 append@2.3 the@2.6 word@2.7 apple@3.2 then@3.6 append@3.66 the@3.9 word@4.0 pair@4.4")];
  const timed = placeEdits([edit(0, "append the word apple"), edit(0, "append the word pear"), edit(0, "pair it")], whisper);
  assert.deepEqual(timed.map((t) => [t.at, t.cueHeard]), [[2.3, true], [3.66, true], [3.66, false]]);
});

test("an exact match later wins over a close match earlier, and short cues must be exact", () => {
  const spoken = [heard("append@1 the@1.2 word@1.4 pair@1.6 append@2 the@2.2 word@2.4 pear@2.6 big@3 dog@3.2")];
  assert.deepEqual(placeEdits([edit(0, "append the word pear")], spoken).map((t) => t.at), [2]);
  assert.deepEqual(placeEdits([edit(0, "big cat")], spoken).map((t) => t.cueHeard), [false]);
});

test("number words in a cue match the digits the speech-to-text wrote", () => {
  const [timed] = placeEdits([edit(0, "contains three and one")], [heard("a@0.2 list@0.5 contains@1 3@1.3 and@1.5 1@1.7")]);
  assert.deepEqual([timed.at, timed.cueHeard], [1, true]);
});

test("an unheard cue is placed by where its words sit in the script, never before the last edit", () => {
  const words = heard("Lists@0 hold@1 items@2 in@3 order@4 and@5 you@6 sort@7 them@8 quickly@9.5");
  const script = "Lists hold items in order, and you sort them quickly.";
  const [early, late] = placeEdits([edit(0, "lists hold"), edit(0, "you sort them")], [words.map((w) => ({ ...w, text: "x" }))], [script]);
  assert.deepEqual([early.at, early.cueHeard], [0, false]);
  assert.equal(late.cueHeard, false);
  assert.ok(Math.abs(late.at - 6 / 10 * 9.6) < 1e-9, String(late.at));
  const [first, second] = placeEdits([edit(0, "sort them"), edit(0, "lists hold")], [words.map((w) => ({ ...w, text: "x" }))], [script]);
  assert.ok(second.at >= first.at);
});

test("a missing transcript leaves the edit at the start of the segment", () => {
  const [timed] = placeEdits([edit(3, "anything")], SPOKEN);
  assert.deepEqual([timed.at, timed.cueHeard], [0, false]);
});

test("placed edits keep the predict question and the code, and a missing predict is null", () => {
  const [timed] = placeEdits([CuedEdit.parse({ segment: 0, cue: "pear", code: "x = 1" })], SPOKEN);
  assert.deepEqual(timed, { segment: 0, at: 4.76, cueHeard: true, cue: "pear", predict: null, code: "x = 1", run: false });
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("for any cues, times never go backwards within a segment and a heard cue sits on a heard word", () => {
  const rand = mulberry32(7);
  const vocabulary = ["list", "append", "the", "word", "apple", "pear", "print", "len"];
  for (let run = 0; run < 2000; run++) {
    const transcripts = Array.from({ length: 3 }, () => {
      let clock = 0;
      return Array.from({ length: Math.floor(rand() * 12) }, () => {
        clock += rand();
        return { text: vocabulary[Math.floor(rand() * vocabulary.length)], start: clock, end: clock + 0.1 };
      });
    });
    const edits = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => {
      const cue = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => vocabulary[Math.floor(rand() * vocabulary.length)]).join(" ");
      return edit(Math.floor(rand() * 3), cue);
    }).sort((a, b) => a.segment - b.segment);
    const timed = placeEdits(edits, transcripts);
    for (const [i, t] of timed.entries()) {
      const earlier = timed.slice(0, i).filter((p) => p.segment === t.segment);
      if (earlier.length > 0) assert.ok(t.at >= earlier.at(-1)!.at, `run ${run}: edit ${i} went back in time`);
      if (t.cueHeard) assert.ok(transcripts[t.segment].some((w) => w.start === t.at), `run ${run}: edit ${i} off the transcript`);
    }
  }
});

const PLAN = {
  title: "Python lists",
  summary: "Build a list.",
  sections: [
    { goal: "Make a list", concepts: ["list"] },
    { goal: "Append", concepts: ["append"] },
    { goal: "Count", concepts: ["len"] },
  ],
};

function appWith(deps: StudioDeps) {
  const app = Fastify();
  app.register(studioRoutes, { resolveLearnerId: async () => "learner-1", reserveAiSpend: async () => undefined, ...deps });
  return app;
}

const payload = {
  plan: PLAN,
  segments: [{ text: "Start with an empty list called words." }, { text: "Now print the length of words." }],
  transcripts: SPOKEN.map((words) => ({ words })),
};

test("edits sends the plan and segment texts to the engine and returns timed edits", async () => {
  const sent: unknown[] = [];
  const app = appWith({
    callEngine: (async (path: string, body: unknown) => {
      assert.equal(path, "/v1/studio/edits");
      sent.push(body);
      return { edits: { edits: [edit(0, "empty list", "What is in words?"), edit(1, "print the length")] }, usage: {} };
    }) as never,
  });
  const res = await app.inject({ method: "POST", url: "/studio/edits", payload });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, [{ plan: PLAN, segments: ["Start with an empty list called words.", "Now print the length of words."] }]);
  assert.deepEqual(
    res.json().edits.map((t: { at: number; predict: string | null }) => [t.at, t.predict]),
    [[0.6, "What is in words?"], [0.32, null]],
  );
  await app.close();
});

test("edits needs one transcript per segment before any engine call", async () => {
  const app = appWith({
    callEngine: (async () => {
      throw new Error("must not call the engine");
    }) as never,
  });
  const res = await app.inject({ method: "POST", url: "/studio/edits", payload: { ...payload, transcripts: payload.transcripts.slice(0, 1) } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "bad_request");
  await app.close();
});

test("edits in the wrong shape from the engine are a 502", async () => {
  const app = appWith({ callEngine: (async () => ({ edits: { edits: [{ segment: 0 }] } })) as never });
  const res = await app.inject({ method: "POST", url: "/studio/edits", payload });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, "engine_error");
  await app.close();
});

test("edits answers 401 without a session", async () => {
  const app = appWith({ resolveLearnerId: async () => null });
  const res = await app.inject({ method: "POST", url: "/studio/edits", payload });
  assert.equal(res.statusCode, 401);
  await app.close();
});
