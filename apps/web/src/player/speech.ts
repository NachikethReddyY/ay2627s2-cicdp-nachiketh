
export type SpeechError = { error?: string };
export type Utterance = { text: string; volume: number; onend: (() => void) | null; onerror: ((e?: SpeechError) => void) | null };
export type Synth = { speak(u: Utterance): void; cancel(): void; pause(): void; resume(): void };
export type Speaker = {
  speak(text: string, o: { volume: number; muted: boolean }): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  setVolume(v: number): void;
};

const FATAL = new Set(["not-allowed", "synthesis-failed"]);

export function splitSentences(text: string): string[] {
  return (text.match(/.+?(?:[.!?]+["')\]]*(?=\s|$)|$)/gs) ?? []).map((s) => s.trim()).filter(Boolean);
}

export function createSpeaker(synth: Synth | null | undefined, makeUtterance: (text: string) => Utterance): Speaker | null {
  if (!synth) return null;
  let sentences: string[] = [];
  let i = 0;
  let volume = 1;
  let gen = 0;
  let paused = false;
  let halted = false;
  let respeak = false;

  const say = () => {
    if (i >= sentences.length) return;
    const g = gen;
    const u = makeUtterance(sentences[i]);
    u.volume = volume;
    u.onend = () => {
      if (g !== gen) return;
      i += 1;
      say();
    };
    u.onerror = (e) => {
      if (g !== gen) return;
      if (e?.error && FATAL.has(e.error)) {
        halted = true;
        paused = true;
        return;
      }
      i += 1;
      say();
    };
    synth.speak(u);
  };

  const restart = () => {
    gen += 1;
    synth.cancel();
    say();
  };

  return {
    speak(text, o) {
      paused = false;
      halted = false;
      respeak = false;
      gen += 1;
      synth.cancel();
      sentences = splitSentences(text);
      i = 0;
      volume = o.muted ? 0 : o.volume;
      say();
    },
    pause() {
      paused = true;
      synth.pause();
    },
    resume() {
      const retry = halted || respeak;
      paused = false;
      halted = false;
      respeak = false;
      if (retry) restart();
      synth.resume();
    },
    cancel() {
      gen += 1;
      sentences = [];
      paused = false;
      halted = false;
      respeak = false;
      synth.cancel();
    },
    setVolume(v) {
      volume = v;
      if (i >= sentences.length) return;
      if (paused) respeak = true;
      else restart();
    },
  };
}
