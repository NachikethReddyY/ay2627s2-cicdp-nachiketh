import { useEffect, useReducer, useRef, useState } from "react";
import type { Timeline } from "@learnquest/ui-catalog";
import { initialPlaying, motionAction, stepReduce, tick, viewState, type StepAction, type Stepper } from "../model.ts";
import { useReducedMotion } from "./useReducedMotion.ts";

/** Drives a timeline. Attach `ref` to the block's root so autoplay pauses when it is off-screen. */
export function useTimeline(timeline: Timeline) {
  const reduced = useReducedMotion();
  const [s, dispatch] = useReducer(
    (cur: Stepper, a: StepAction | "tick") => (a === "tick" ? tick(timeline, cur) : stepReduce(timeline, cur, a)),
    { step: 0, playing: initialPlaying(timeline.autoplay, reduced) },
  );
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabHidden, setTabHidden] = useState(false);

  useEffect(() => { if (reduced) dispatch("pause"); }, [reduced]);

  useEffect(() => {
    const onVis = () => setTabHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    const el = ref.current;
    const io = el && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([e]) => setOnScreen(e!.isIntersecting))
      : null;
    if (el) io?.observe(el);
    return () => { document.removeEventListener("visibilitychange", onVis); io?.disconnect(); };
  }, []);

  const running = s.playing && onScreen && !tabHidden && !reduced;
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => dispatch("tick"), timeline.steps[s.step]!.durationMs);
    return () => clearTimeout(id);
  }, [running, s.step, timeline]);

  return { ...s, ...viewState(timeline, s), reduced, ref, dispatch: ((a: StepAction) => dispatch(motionAction(a, reduced))) };
}

export type TimelineControl = ReturnType<typeof useTimeline>;
