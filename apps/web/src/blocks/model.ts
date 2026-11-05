// Pure helpers for the renderer shell. No React or DOM, so node --test can run them.
import { parseSpec, sanitize, MAX_ALT, clampStep, stateAt, stepCount, type Block, type Issue, type Timeline, type TimelineState } from "@learnquest/ui-catalog";

type Item = { kind: "block"; block: Block } | { kind: "rejected"; alt: string; reasons: string[] };
export type Plan = { items: Item[]; issues: Issue[]; fatal: boolean };

const altOf = (raw: unknown): string => {
  const a = (raw as { props?: { alt?: unknown } } | null)?.props?.alt;
  return typeof a === "string" ? sanitize(a).trim().slice(0, MAX_ALT) : "";
};

/** Re-parses a doc and lines every raw block up with either its parsed block or a rejection (keeping its alt text). */
export function plan(doc: unknown): Plan {
  const res = parseSpec(doc);
  if (!res.ok && res.issues.every((i) => !i.path.startsWith("blocks.")))
    return { items: [], issues: res.issues, fatal: true };

  let data: unknown = doc;
  if (typeof doc === "string") try { data = JSON.parse(doc); } catch { data = null; }
  const raws = (data as { blocks?: unknown } | null)?.blocks;
  const rawList = Array.isArray(raws) ? raws : [];
  const survivors = res.ok ? [...res.spec.blocks] : [];
  const items: Item[] = rawList.map((raw, i) => {
    const reasons = res.issues.filter((x) => x.path === `blocks.${i}` || x.path.startsWith(`blocks.${i}.`)).map((x) => x.message);
    const block = reasons.length ? undefined : survivors.shift();
    return block ? { kind: "block", block } : { kind: "rejected", alt: altOf(raw), reasons };
  });
  return { items, issues: res.issues, fatal: false };
}

export type Stepper = { step: number; playing: boolean };
export type StepAction = "toggle" | "play" | "pause" | "next" | "prev" | "first" | "last" | { goto: number };

/** Stepping by hand always pauses; reaching the last step stops playback. */
export function stepReduce(t: Timeline, s: Stepper, a: StepAction): Stepper {
  const at = (i: number, playing = false): Stepper => ({ step: clampStep(t, i), playing });
  const last = stepCount(t) - 1;
  if (a === "toggle") return stepReduce(t, s, s.playing ? "pause" : "play");
  if (a === "play") return s.step >= last ? { step: 0, playing: last > 0 } : { ...s, playing: true };
  if (a === "pause") return { ...s, playing: false };
  if (a === "next") return at(s.step + 1);
  if (a === "prev") return at(s.step - 1);
  if (a === "first") return at(0);
  if (a === "last") return at(last);
  return at(a.goto);
}

/** Auto-advance after the step's duration; stops on the last step. */
export const tick = (t: Timeline, s: Stepper): Stepper => {
  const n = clampStep(t, s.step + 1);
  return { step: n, playing: n < stepCount(t) - 1 };
};

/** Reduced motion has no autoplay, so Play steps forward once instead of flipping to "Pause". */
export const motionAction = (a: StepAction, reduced: boolean): StepAction => (reduced && (a === "play" || a === "toggle") ? "next" : a);

/** Space, arrows and Home/End. Native controls (buttons, the scrub slider) keep their own keys. */
export function keyAction(key: string, targetTag = "", mods: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {}): StepAction | null {
  if (mods.alt || mods.ctrl || mods.meta) return null;
  if (["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(targetTag.toUpperCase())) return null;
  return ({ " ": "toggle", ArrowRight: "next", ArrowLeft: "prev", Home: "first", End: "last" } as const)[key as " "] ?? null;
}

/** Reduced motion beats the spec's autoplay flag: start paused, in step mode. */
export const initialPlaying = (autoplay: boolean | undefined, reducedMotion: boolean): boolean => !!autoplay && !reducedMotion;

export const viewState = (t: Timeline, s: Pick<Stepper, "step">): { state: TimelineState; caption: string; count: number } => ({
  state: stateAt(t, s.step),
  caption: t.steps[clampStep(t, s.step)]!.caption,
  count: stepCount(t),
});
