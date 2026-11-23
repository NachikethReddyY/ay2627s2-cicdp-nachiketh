import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Lock, Play, Star } from "lucide-react";
import type { CourseData } from "../../lib/api";
import { trpc } from "../../lib/trpc";
import { writeLabel } from "./writeProgress";

type Lesson = CourseData["lessons"][number];

const kinds = { learn: "📖 Learn", watch: "▶ Watch", practice: "⌨ Practice", "game-practice": "🎮 Game", scrim: "🎬 Scrim" };

function Pill({ kind }: { kind: Lesson["kind"] }) {
  if (kind === "predict") return null;
  return <span className="lesson-kind">{kinds[kind]}</span>;
}

type Props = {
  l: Lesson;
  slug: string;
  state: "done" | "cur" | "locked";
  x: number;
  cta: string;
  open: boolean;
  setOpen: (s: string | null) => void;
  onWritten: () => void;
};

const stateText = { done: "Done", cur: "Now", locked: "Locked" };

export default function LessonNode({ l, slug, state, x, cta, open, setOpen, onWritten }: Props) {
  const reduce = useReducedMotion();
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const needsWrite = state !== "locked" && (l.writeState === "failed" || l.writeState === "pending");
  const write = () => {
    setWriting(true);
    setWriteError(false);
    void trpc.lessons.write.mutate({ id: l.slug }).then(
      () => {
        setWriting(false);
        onWritten();
      },
      () => {
        setWriting(false);
        setWriteError(true);
      },
    );
  };
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

  const click = (e: MouseEvent) => {
    if (e.detail === 0 && state !== "locked") return;
    e.preventDefault();
    setOpen(open ? null : l.slug);
  };

  const face = (
    <motion.span
      className={`lesson-face ${state}`}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      transition={{ type: "spring", stiffness: 600, damping: 25 }}
    >
      <Icon size={state === "cur" ? 26 : 22} strokeWidth={2.25} aria-hidden />
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
          <Link ref={node} to="/play" search={{ lesson: l.slug, course: slug }} aria-label={`${l.title}${state === "done" ? " (complete)" : ""}`} className="lesson-hit" onClick={click}>
            {face}
          </Link>
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
            {writeLabel[l.writeState] && <span className={`lesson-write ${l.writeState}`}>{writeLabel[l.writeState]}</span>}
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
            <p className="lesson-pop-note">Reach 80% mastery in {l.missingPrerequisites.join(", ")} to unlock this lesson.</p>
          ) : needsWrite ? (
            <>
              <p className="lesson-pop-note">{l.writeState === "failed" ? "Writing this lesson failed." : "This lesson isn't written yet."}</p>
              <button type="button" className="btn lesson-pop-btn" disabled={writing} onClick={write}>
                {writing ? "Writing…" : "Write now"}
              </button>
              {writeError && <p role="alert" className="lesson-pop-error">Couldn't write this lesson. Try again.</p>}
            </>
          ) : (
            <Link
              to="/play"
              search={{ lesson: l.slug, course: slug }}
              className={`${state === "done" ? "pill" : "btn"} lesson-pop-btn`}
            >
              {cta}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
