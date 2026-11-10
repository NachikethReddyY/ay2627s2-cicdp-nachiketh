// Browser speech as a fallback for narration audio. Pure: the synth and the utterance factory are injected, so
// tests need no DOM.

export type Utterance = { text: string; volume: number; onend: (() => void) | null; onerror: (() => void) | null };
export type Synth = { speak(u: Utterance): void; cancel(): void; pause(): void; resume(): void };
export type Speaker = {
  speak(text: string, o: { volume: number; muted: boolean }): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  setVolume(v: number): void;
};

// Sentences, so a volume change only re-speaks the current one.
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

// `volume` is 0..1; mute is volume 0. Returns null when the browser has no speech synthesis.
export function createSpeaker(synth: Synth | null | undefined, makeUtterance: (text: string) => Utterance): Speaker | null {
  if (!synth) return null;
  let sentences: string[] = [];
  let i = 0;
  let volume = 1;
  let gen = 0; // cancel() fires onend/onerror on the cancelled utterance; stale callbacks are ignored

  const say = () => {
    if (i >= sentences.length) return;
    const g = gen;
    const u = makeUtterance(sentences[i]!);
    u.volume = volume;
    const next = () => {
      if (g !== gen) return;
      i += 1;
      say();
    };
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };

  return {
    speak(text, o) {
      gen += 1;
      synth.cancel();
      sentences = splitSentences(text);
      i = 0;
      volume = o.muted ? 0 : o.volume;
      say();
    },
    pause: () => synth.pause(),
    resume: () => synth.resume(),
    cancel() {
      gen += 1;
      sentences = [];
      synth.cancel();
    },
    setVolume(v) {
      volume = v;
      if (i >= sentences.length) return; // nothing is being spoken
      gen += 1; // an utterance's volume is fixed once it starts: re-speak the current sentence
      synth.cancel();
      say();
    },
  };
}
