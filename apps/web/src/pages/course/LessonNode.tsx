import { useEffect, useRef, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { BookOpen, Check, Code, Play, Sparkles, Star } from "lucide-react";
import type { CourseData } from "../../lib/api";

type Lesson = CourseData["lessons"][number];

export const kinds = { learn: "📖 Learn", watch: "▶ Watch", practice: "⌨ Practice" };
const icons = { learn: BookOpen, watch: Play, practice: Code, predict: Sparkles };

const looks = {
  done: { bg: "#10B981", lip: "#047857", glow: "", text: "text-slate-950" },
  cur: { bg: "#2563EB", lip: "#1E3A8A", glow: ", 0 0 28px rgba(56,189,248,0.55)", text: "text-white" },
  locked: { bg: "#18181B", lip: "#09090B", glow: "", text: "text-zinc-600" },
};

export function Pill({ kind }: { kind: Lesson["kind"] }) {
  if (kind === "predict") return null;
  return <span className="mono inline-block rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-400">{kinds[kind]}</span>;
}

type Props = { l: Lesson; slug: string; state: keyof typeof looks; x: number; cta: string; open: boolean; setOpen: (s: string | null) => void };

export default function LessonNode({ l, slug, state, x, cta, open, setOpen }: Props) {
  const reduce = useReducedMotion();
  const li = useRef<HTMLLIElement>(null);
  const node = useRef<HTMLAnchorElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const look = looks[state];
  const Icon = state === "done" ? Check : state === "cur" ? (l.kind === "watch" ? Play : Star) : icons[l.kind];
  const left = x > 0;

  useEffect(() => {
    if (!open) return;
    pop.current?.focus();
    const off = (e: PointerEvent) => !li.current?.contains(e.target as Node) && setOpen(null);
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [open, setOpen]);

  // Mouse clicks open the popover; keyboard Enter (detail 0) still follows the link straight to /play.
  const click = (e: MouseEvent) => {
    if (e.detail === 0) return;
    e.preventDefault();
    setOpen(open ? null : l.slug);
  };

  const face = (
    <motion.span
      className={`grid size-16 place-items-center rounded-full border border-white/10 ${look.text}`}
      style={{ background: look.bg, boxShadow: `0 5px 0 ${look.lip}${look.glow}` }}
      whileTap={reduce ? undefined : { y: 4, boxShadow: `0 1px 0 ${look.lip}${look.glow}` }}
      transition={{ type: "spring", stiffness: 600, damping: 25 }}
    >
      <Icon size={26} strokeWidth={state === "locked" ? 2 : 3} aria-hidden />
    </motion.span>
  );

  return (
    <li ref={li} className={`relative h-28 ${open ? "z-30" : ""}`}>
      <div className="absolute top-1/2 size-16 -translate-y-1/2" style={{ left: `calc(50% + ${x - 32}px)` }}>
        {state === "cur" && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-sky-400"
            animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {state === "locked" ? (
          <span role="img" aria-label={`${l.title} (locked)`} className="block rounded-full" onClick={click}>{face}</span>
        ) : (
          <Link ref={node} to="/play" search={{ lesson: l.slug, course: slug }} aria-label={`${l.title}${state === "done" ? " (complete)" : ""}`} aria-expanded={open} className="block rounded-full" onClick={click}>
            {face}
          </Link>
        )}
        {state === "cur" && (
          <motion.img
            src="/img/pip-cheer.png"
            alt=""
            className={`pointer-events-none absolute top-0 w-12 ${left ? "left-full ml-3" : "right-full mr-3"}`}
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <div
        aria-hidden
        className={`absolute top-1/2 flex -translate-y-1/2 ${left ? "left-0 justify-end" : "right-0"}`}
        style={left ? { right: `calc(50% - ${x - 44}px)` } : { left: `calc(50% + ${x + 44}px)` }}
      >
        <div className={`max-w-56 rounded-xl border border-white/8 bg-[#131720] px-3 py-2 ${left ? "text-right" : ""}`}>
          <p className={`line-clamp-2 text-sm font-medium ${state === "locked" ? "text-zinc-500" : "text-zinc-100"}`}>{l.title}</p>
          {l.kind !== "predict" && <div className="mt-1"><Pill kind={l.kind} /></div>}
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
            node.current?.focus();
          }}
          className="absolute bottom-[calc(50%+44px)] left-1/2 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#131720] p-4 shadow-2xl"
        >
          <p className="font-semibold text-white">{l.title}</p>
          <div className="mt-2"><Pill kind={l.kind} /></div>
          {state === "locked" ? (
            <p className="mt-3 text-sm text-zinc-400">Finish the lessons before this one to unlock it.</p>
          ) : (
            <Link
              to="/play"
              search={{ lesson: l.slug, course: slug }}
              className={`mt-4 block rounded-xl border-b-4 px-4 py-2 text-center font-semibold active:translate-y-1 ${state === "done" ? "border-zinc-900 bg-zinc-700 text-white hover:bg-zinc-600" : "border-emerald-700 bg-emerald-500 text-slate-950 hover:bg-emerald-400"}`}
            >
              {cta}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
