import { useEffect, useRef, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Lock, Play, Star } from "lucide-react";
import type { CourseData } from "../../lib/api";

type Lesson = CourseData["lessons"][number];

export const kinds = { learn: "📖 Learn", watch: "▶ Watch", practice: "⌨ Practice", "game-practice": "🎮 Game" };

export function Pill({ kind }: { kind: Lesson["kind"] }) {
  if (kind === "predict") return null;
  return <span className="lesson-kind">{kinds[kind]}</span>;
}

type Props = { l: Lesson; slug: string; state: "done" | "cur" | "locked"; x: number; cta: string; open: boolean; setOpen: (s: string | null) => void };

const stateText = { done: "DONE", cur: "NOW", locked: "LOCKED" };

export default function LessonNode({ l, slug, state, x, cta, open, setOpen }: Props) {
  const reduce = useReducedMotion();
  const li = useRef<HTMLLIElement>(null);
  const node = useRef<HTMLAnchorElement>(null);
  const lock = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const Icon = state === "done" ? Check : state === "cur" ? (l.kind === "watch" ? Play : Star) : Lock;
  const left = x > 0;

  useEffect(() => {
    if (!open) return;
    pop.current?.focus();
    const off = (e: PointerEvent) => !li.current?.contains(e.target as Node) && setOpen(null);
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open, setOpen]);

  // Mouse clicks open the popover; keyboard Enter (detail 0) still follows the lesson link straight to /play.
  // A locked node is a button, so Enter opens its info popover instead.
  const click = (e: MouseEvent) => {
    if (e.detail === 0 && state !== "locked") return;
    e.preventDefault();
    setOpen(open ? null : l.slug);
  };

  const face = (
    <motion.span
      className={`lesson-face ${state}`}
      whileTap={reduce ? undefined : { y: 4, boxShadow: "1px 1px 0 var(--ink)" }}
      transition={{ type: "spring", stiffness: 600, damping: 25 }}
    >
      <Icon size={state === "cur" ? 30 : 26} strokeWidth={3} aria-hidden />
    </motion.span>
  );

  return (
    <li ref={li} className={`lesson-row ${open ? "open" : ""}`}>
      <div className="lesson-node" style={{ left: `calc(50% + ${x - 32}px)` }}>
        {state === "cur" && !reduce && (
          <motion.span
            aria-hidden
            className="lesson-pulse"
            animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {state === "locked" ? (
          <button ref={lock} type="button" aria-label={`${l.title} (locked)`} aria-expanded={open} className="lesson-hit" onClick={click}>
            {face}
          </button>
        ) : (
          <Link ref={node} to="/play" search={{ lesson: l.slug, course: slug }} aria-label={`${l.title}${state === "done" ? " (complete)" : ""}`} aria-expanded={open} className="lesson-hit" onClick={click}>
            {face}
          </Link>
        )}
        {state === "cur" && (
          <motion.img
            src="/img/pip-cheer.png"
            alt=""
            className={`lesson-pip ${left ? "left" : "right"}`}
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <div
        aria-hidden
        className={`lesson-tag-wrap ${left ? "left" : "right"}`}
        style={left ? { right: `calc(50% - ${x - 44}px)` } : { left: `calc(50% + ${x + 44}px)` }}
      >
        <div className={`lesson-tag ${state}`}>
          <div className="lesson-tag-top">
            <span className={`lesson-state ${state}`}>{stateText[state]}</span>
            <Pill kind={l.kind} />
          </div>
          <p className="lesson-tag-title">{l.title}</p>
        </div>
      </div>

      {open && (
        <div
          ref={pop}
          role="dialog"
          aria-label={l.title}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            setOpen(null);
            (node.current ?? lock.current)?.focus();
          }}
          className="lesson-pop"
        >
          <p className="lesson-pop-title">{l.title}</p>
          <div className="lesson-pop-kind"><Pill kind={l.kind} /></div>
          {state === "locked" ? (
            <p className="lesson-pop-note">Finish the lessons before this one to unlock it.</p>
          ) : (
            <Link
              to="/play"
              search={{ lesson: l.slug, course: slug }}
              className={`lq-btn ${state === "done" ? "lq-btn-surface" : "lq-btn-ink"} lesson-pop-btn`}
            >
              {cta}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
