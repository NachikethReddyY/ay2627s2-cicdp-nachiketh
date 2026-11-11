import { animate, motion, useMotionValue, useMotionValueEvent, useInView, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import PredictDemo from "../components/PredictDemo";
import "./landing.css";

const concepts = ["Loops", "Functions", "Async", "State", "Testing", "Refactoring", "Closures", "Recursion"];

const moves = [
  { title: "Predict", body: "Pause a real commit. Say what the next change does.", img: "predict", tone: "#1890e4" },
  { title: "Hint", body: "Stuck? Hints come one rung at a time. Never the answer.", img: "hint", tone: "#f06ca8" },
  { title: "Reveal", body: "Watch the change replay in the editor, with narration.", img: "reveal", tone: "#5cc8f0" },
  { title: "Adapt", body: "A learner model picks your next step, and tells you why.", img: "adapt", tone: "#e4c46c" },
];

const mastery = [
  { name: "Loops", value: 72, a: "#1890e4", b: "#5cc8f0" },
  { name: "Functions", value: 45, a: "#f06ca8", b: "#f4b4cf" },
  { name: "Async", value: 18, a: "#6cd4a4", b: "#bfeed8" },
];

const ease = [0.22, 1, 0.36, 1] as const;

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.12 } } };
const rise = {
  hidden: { opacity: 0, y: 36, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, ease } },
};

/** Writes the pointer position into the glass surface so its light follows the cursor. */
function spotlight(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** Counts from 0 to `to` once it scrolls into view. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setN(to);
      return;
    }
    const controls = animate(0, to, { duration: 1.2, ease: "easeOut", onUpdate: (v) => setN(Math.round(v)) });
    return () => controls.stop();
  }, [inView, to, reduce]);
  return <span ref={ref} className="tabular-nums">{n}%</span>;
}

/** A primary button that leans toward the pointer. */
function MagneticLink({ href, children }: { href: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 260, damping: 18 });
  const y = useSpring(0, { stiffness: 260, damping: 18 });
  const onMove = (e: PointerEvent<HTMLAnchorElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - r.left - r.width / 2) * 0.25);
    y.set((e.clientY - r.top - r.height / 2) * 0.25);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <motion.a href={href} className="lp-btn" style={{ x, y }} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </motion.a>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6cd4a4" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <motion.path d="M4 12.5l5 5L20 6.5" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.25, ease }} />
    </svg>
  );
}

function Cross() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(224 224 224 / 0.45)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <motion.path d="M6 6l12 12M18 6L6 18" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, ease }} />
    </svg>
  );
}

export default function Landing() {
  const reduce = useReducedMotion();
  const { scrollY, scrollYProgress } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24));

  // The background drifts slower than the page, so depth shows as you scroll.
  const meshY = useTransform(scrollY, [0, 2400], [0, reduce ? 0 : -260]);
  const barScale = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  const movesRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: movesProgress } = useScroll({ target: movesRef, offset: ["start 80%", "end 60%"] });

  const headline = "Learn code by guessing first.".split(" ");

  return (
    <div className="lp">
      <motion.div aria-hidden className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-gradient-to-r from-[#1890e4] via-[#5cc8f0] to-[#e4c46c]" style={{ scaleX: barScale }} />

      <div className="lp-mesh" aria-hidden>
        <motion.div className="absolute inset-0" style={{ y: meshY }}>
          <div className="lp-blob lp-blob--violet" />
          <div className="lp-blob lp-blob--cyan" />
          <div className="lp-blob lp-blob--pink" />
        </motion.div>
        <div className="lp-grain" />
      </div>

      <nav className="lp-nav" data-scrolled={scrolled} aria-label="Main">
        <a href="/" className="lp-logo">
          Learn<span className="lp-grad">Slop</span>
        </a>
        <div className="flex items-center gap-5">
          <a href="#moves" className="lp-navlink hidden sm:inline-block">How it works</a>
          <a href="/login" className="lp-navlink">Sign in</a>
          <a href="/login" className="lp-btn lp-btn--small">Try it</a>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-6xl px-5 sm:px-6">
        <section className="grid items-center gap-14 pb-24 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <motion.div initial="hidden" animate="show" variants={stagger}>
            <motion.div variants={rise}>
              <span className="lp-chip">
                <span className="lp-dot" aria-hidden />
                Predict, watch, adapt
              </span>
            </motion.div>

            <h1 className="mt-7 text-[2.9rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
              {headline.map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  className="mr-[0.25em] inline-block"
                  variants={{
                    hidden: { opacity: 0, y: 40, filter: "blur(10px)" },
                    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease } },
                  }}
                >
                  {word === "guessing" ? (
                    <span className="lp-serif-italic lp-grad pr-1">{word}</span>
                  ) : (
                    word
                  )}
                </motion.span>
              ))}
            </h1>

            <motion.p variants={rise} className="mt-7 max-w-md text-lg leading-relaxed text-[var(--lp-muted)] sm:text-xl">
              Real commits, turned into bite-sized quests. You predict the change, then watch it happen. The more you
              learn, the smarter the next step.
            </motion.p>

            <motion.div variants={rise} className="mt-10 flex flex-wrap items-center gap-4">
              <MagneticLink href="/play">
                Play a step <ArrowIcon />
              </MagneticLink>
              <span className="lp-chip">Lessons landing soon</span>
            </motion.div>
          </motion.div>

          <motion.div
            id="try"
            className="relative mx-auto w-full max-w-xl scroll-mt-28 lg:max-w-none"
            initial={{ opacity: 0, y: 60, rotate: 1.5 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 1, delay: 0.3, ease }}
          >
            <motion.span
              className="lp-chip absolute -top-4 right-4 z-10"
              animate={reduce ? undefined : { y: [0, -6, 0], rotate: [-4, 2, -4] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            >
              try me!
            </motion.span>
            <PredictDemo />
          </motion.div>
        </section>

        <section aria-label="Concepts" className="pb-24">
          <div className="lp-marquee">
            <div className="lp-marquee__track">
              {[...concepts, ...concepts].map((name, i) => (
                <span key={`${name}-${i}`} className="lp-concept" aria-hidden={i >= concepts.length || undefined}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="moves" ref={movesRef} className="scroll-mt-28 pb-28">
          <motion.h2
            className="text-4xl font-semibold tracking-[-0.03em] sm:text-5xl"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.7, ease }}
          >
            Four moves. <span className="lp-serif-italic text-[var(--lp-muted)]">Repeat.</span>
          </motion.h2>

          <div className="lp-progress-track mt-8">
            <motion.div className="lp-progress" style={{ scaleX: movesProgress }} />
          </div>

          <motion.ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
            {moves.map((move, i) => (
              <motion.li key={move.title} variants={rise} whileHover={reduce ? undefined : { y: -8 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="lp-glass lp-move" style={{ "--tone": move.tone } as React.CSSProperties} onPointerMove={spotlight}>
                <div className="lp-orb">
                  <img src={`/img/${move.img}.png`} alt="" />
                </div>
                <span className="lp-step">0{i + 1}</span>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight">{move.title}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--lp-muted)]">{move.body}</p>
              </motion.li>
            ))}
          </motion.ol>
        </section>

        <section className="grid gap-6 pb-28 md:grid-cols-2">
          <motion.div className="lp-glass p-7 sm:p-8" onPointerMove={spotlight} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease }}>
            <p className="lp-eyebrow">Watching</p>
            <h3 className="mt-3 text-2xl font-semibold text-[var(--lp-muted)]">A tutorial</h3>
            <ul className="mt-6 space-y-4 text-[var(--lp-muted)]">
              {["It all makes sense while it plays", "Nothing tells you what you missed", "Same video for everyone"].map((line) => (
                <li key={line} className="lp-compare-item">
                  <Cross />
                  {line}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div className="lp-glass lp-compare--good p-7 sm:p-8" onPointerMove={spotlight} initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease, delay: 0.1 }}>
            <p className="lp-eyebrow text-[var(--lp-mint)]">Predicting first</p>
            <h3 className="mt-3 text-2xl font-semibold">LearnSlop</h3>
            <ul className="mt-6 space-y-4">
              {["You commit to a guess before the answer", "Misses show exactly what to review", "The next step adapts to what you know"].map((line) => (
                <li key={line} className="lp-compare-item">
                  <Tick />
                  {line}
                </li>
              ))}
            </ul>
          </motion.div>
        </section>

        <section className="grid items-center gap-14 pb-28 md:grid-cols-2">
          <motion.div className="relative" initial={{ opacity: 0, scale: 0.94 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.9, ease }}>
            <img src="/img/mastery.png" alt="Pip watering three plants of different heights" className="relative z-10 mx-auto mb-6 w-full max-w-md drop-shadow-[0_30px_40px_rgb(0_0_0_/_0.4)]" />
            <div className="lp-glass p-6">
              <p className="mb-5 text-sm font-medium text-[var(--lp-muted)]">Your mastery map</p>
              <div className="space-y-4">
                {mastery.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-4">
                    <span className="w-24 text-sm font-medium">{m.name}</span>
                    <div className="lp-track">
                      <motion.div
                        className="lp-fill"
                        style={{ width: `${m.value}%`, "--tone-a": m.a, "--tone-b": m.b, transformOrigin: "left" } as React.CSSProperties}
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.1, delay: 0.15 + i * 0.12, ease }}
                      />
                    </div>
                    <span className="w-12 text-right text-sm font-medium">
                      <CountUp to={m.value} />
                    </span>
                  </div>
                ))}
              </div>
              <p className="lp-next mt-6">Next up: <strong className="font-semibold">Async</strong>. It is your lowest unlocked concept.</p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.8, ease }}>
            <p className="lp-eyebrow">Adaptive</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              It learns <span className="lp-serif-italic lp-grad">you</span> back.
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-[var(--lp-muted)]">
              Every first attempt updates a model of what you know. Hints help, but they do not earn mastery, so
              watching never counts as learning. Each recommendation shows its reason.
            </p>
            <p className="mt-5 text-sm text-[var(--lp-muted)]/80">Replays are reconstructed from a diff, never recorded.</p>
          </motion.div>
        </section>

        <section className="pb-28">
          <motion.div className="lp-glass lp-finale" initial={{ opacity: 0, y: 50, scale: 0.97 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.9, ease }} onPointerMove={spotlight}>
            <motion.img
              src="/img/finale.png"
              alt="Pip leaping with confetti"
              className="relative mx-auto mb-4 w-full max-w-xs"
              animate={reduce ? undefined : { y: [0, -12, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <h2 className="relative mx-auto max-w-2xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              Ready to take a <span className="lp-serif-italic lp-grad">guess</span>?
            </h2>
            <div className="relative mt-9 flex justify-center">
              <MagneticLink href="/play">
                Play a step <ArrowIcon />
              </MagneticLink>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="lp-foot mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 py-10 text-center">
        <span>
          Learn<span className="lp-grad font-semibold">Slop</span>
        </span>
        <span>A CICDP course project</span>
      </footer>
    </div>
  );
}
