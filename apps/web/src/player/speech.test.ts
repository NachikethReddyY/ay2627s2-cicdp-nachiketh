import assert from "node:assert/strict";
import test from "node:test";
import { createSpeaker, splitSentences, type Synth, type Utterance } from "./speech.ts";

const blank = (text: string): Utterance => ({ text, volume: 1, onend: null, onerror: null });

function fake() {
  const calls: string[] = [];
  const spoken: Utterance[] = [];
  const synth: Synth = {
    speak: (u) => (spoken.push(u), calls.push(`speak:${u.text}@${u.volume}`)),
    cancel: () => calls.push("cancel"),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
  };
  return { calls, spoken, sp: createSpeaker(synth, blank)! };
}

test("unsupported browser gives no speaker", () => {
  assert.equal(createSpeaker(null, blank), null);
  assert.equal(createSpeaker(undefined, blank), null);
});

test("splits sentences", () => {
  assert.deepEqual(splitSentences("One. Two! Three? Four"), ["One.", "Two!", "Three?", "Four"]);
  assert.deepEqual(splitSentences("  "), []);
});

test("speaks sentences in sequence", () => {
  const { calls, spoken, sp } = fake();
  sp.speak("Hello there. Bye.", { volume: 0.5, muted: false });
  assert.deepEqual(calls, ["cancel", "speak:Hello there.@0.5"]);
  spoken[0]!.onend!();
  assert.deepEqual(calls.slice(2), ["speak:Bye.@0.5"]);
  spoken[1]!.onend!(); // last sentence: nothing more
  assert.equal(calls.length, 3);
});

test("an utterance error moves on to the next sentence", () => {
  const { calls, spoken, sp } = fake();
  sp.speak("A. B.", { volume: 1, muted: false });
  spoken[0]!.onerror!();
  assert.equal(calls.at(-1), "speak:B.@1");
});

test("mute speaks at volume 0", () => {
  const { calls, sp } = fake();
  sp.speak("Hi.", { volume: 0.8, muted: true });
  assert.equal(calls.at(-1), "speak:Hi.@0");
});

test("volume change cancels and re-speaks the current sentence; stale callbacks are ignored", () => {
  const { calls, spoken, sp } = fake();
  sp.speak("One. Two.", { volume: 1, muted: false });
  sp.setVolume(0.2);
  assert.deepEqual(calls.slice(-2), ["cancel", "speak:One.@0.2"]);
  spoken[0]!.onend!(); // the cancelled utterance reports back: must not advance
  assert.equal(calls.length, 4);
  spoken[1]!.onend!();
  assert.equal(calls.at(-1), "speak:Two.@0.2");
  sp.setVolume(0); // mute mid-speech
  assert.deepEqual(calls.slice(-2), ["cancel", "speak:Two.@0"]);
});

test("volume change while idle speaks nothing", () => {
  const { calls, sp } = fake();
  sp.setVolume(0.3);
  assert.deepEqual(calls, []);
});

test("pause, resume and cancel", () => {
  const { calls, spoken, sp } = fake();
  sp.speak("A. B.", { volume: 1, muted: false });
  sp.pause();
  sp.resume();
  sp.cancel();
  assert.deepEqual(calls.slice(-3), ["pause", "resume", "cancel"]);
  spoken[0]!.onend!(); // cancelled: no further speech
  assert.equal(calls.at(-1), "cancel");
  sp.setVolume(0.5); // nothing to re-speak after cancel
  assert.equal(calls.at(-1), "cancel");
});
