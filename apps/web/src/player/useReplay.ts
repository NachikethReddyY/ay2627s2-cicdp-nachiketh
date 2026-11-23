import { useCallback, useEffect, useRef, useState } from "react";
import { seek, type SeekResult, type Timeline } from "@learnquest/player-core";

export const SPEEDS = [0.5, 1, 2, 4, "instant"] as const;
export type Speed = (typeof SPEEDS)[number];

export function stepIndexAt(tl: Timeline, t: number) {
  let i = 0;
  tl.steps.forEach((s, n) => {
    if (s.startT <= t) i = n;
  });
  return i;
}

export function useReplay(timeline: Timeline, onFrame: (r: SeekResult) => void, start?: "play" | "end") {
  const [playing, setPlayingState] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(() =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : 1,
  );
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const speedRef = useRef(speed);
  const playingRef = useRef(false);
  const frameRef = useRef(onFrame);
  useEffect(() => {
    frameRef.current = onFrame;
  });

  const setPlaying = useCallback((p: boolean) => {
    playingRef.current = p;
    setPlayingState(p);
  }, []);

  const go = useCallback(
    (nt: number) => {
      nt = Math.max(0, Math.min(timeline.duration, nt));
      tRef.current = nt;
      frameRef.current(seek(timeline, nt));
      setT(nt);
    },
    [timeline],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let shown = last;
    const tick = (now: number) => {
      if (!playingRef.current) return;
      const sp = speedRef.current;
      const nt = Math.min(timeline.duration, tRef.current + (now - last) * (sp === "instant" ? 1 : sp));
      last = now;
      tRef.current = nt;
      frameRef.current(seek(timeline, nt));
      if (now - shown > 100 || nt >= timeline.duration) {
        shown = now;
        setT(nt);
      }
      if (nt >= timeline.duration) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, timeline, setPlaying]);

  const pause = () => setPlaying(false);

  const jumpToStepEnd = useCallback(() => {
    setPlaying(false);
    const s = timeline.steps.find((x) => x.endT > tRef.current);
    if (s) go(s.endT);
  }, [go, timeline, setPlaying]);

  const play = useCallback(() => {
    if (speedRef.current === "instant") return jumpToStepEnd();
    if (tRef.current >= timeline.duration) go(0);
    setPlaying(true);
  }, [go, jumpToStepEnd, timeline.duration, setPlaying]);

  useEffect(() => {
    go(start === "end" ? timeline.duration : 0);
    if (start === "play") play();
    if (start === "end") setPlaying(false);
  }, [go, play, setPlaying, start, timeline.duration]);

  const setSpeed = (s: Speed) => {
    speedRef.current = s;
    setSpeedState(s);
    if (s === "instant" && playingRef.current) jumpToStepEnd();
  };

  const stepBoundary = (dir: 1 | -1) => {
    const cur = tRef.current;
    const i = stepIndexAt(timeline, cur);
    const starts = timeline.steps.map((s) => s.startT);
    if (dir === 1) go(starts[i + 1] ?? timeline.duration);
    else go(cur - starts[i] > 500 ? starts[i] : (starts[i - 1] ?? 0));
  };

  const shiftSpeed = (d: 1 | -1) => {
    const i = SPEEDS.indexOf(speedRef.current);
    setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))]);
  };

  return {
    playing,
    speed,
    t,
    play,
    pause,
    pauseAtFrame: () => {
      pause();
      setT(tRef.current);
      return seek(timeline, tRef.current);
    },
    toggle: () => (playingRef.current ? pause() : play()),
    seek: go,
    seekBy: (ms: number) => go(tRef.current + ms),
    stepBoundary,
    setSpeed,
    faster: () => shiftSpeed(1),
    slower: () => shiftSpeed(-1),
  };
}
