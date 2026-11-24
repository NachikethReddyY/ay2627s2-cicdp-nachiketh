import { BookOpen, ClipboardCheck, Code2, FileText, Film, ListChecks } from "lucide-react";
import { motion, useScroll, useTransform, type MotionStyle, type MotionValue } from "motion/react";
import { useRef } from "react";
import { ModeExample } from "./ModeExample";
import "./learning-story.css";

const modes = [
  { label: "Open pages", icon: BookOpen, detail: "Read explanations, code examples, and diagrams." },
  { label: "Quizzes and scenarios", icon: ListChecks, detail: "Predict what the code will do before seeing the result." },
  { label: "Scrims", icon: Film, detail: "Watch a narrated code replay that pauses for predictions." },
  { label: "Practice editors", icon: Code2, detail: "Write your own code and run it against sample tests." },
  { label: "Summary pages", icon: FileText, detail: "Revisit the main idea and the mistakes to watch for." },
  { label: "Summary quizzes", icon: ClipboardCheck, detail: "Recall the rule and apply it to a fresh example." },
];

function ModeTile({ mode: { label, icon: Icon, detail } }: { mode: (typeof modes)[number] }) {
  return (
    <>
      <div className="lp-story-tile-label"><Icon size={22} strokeWidth={1.75} aria-hidden="true" /><strong>{label}</strong></div>
      <div className="lp-story-detail"><p>{detail}</p></div>
    </>
  );
}

type MovingTileProps = {
  mode: (typeof modes)[number];
  index: number;
  progress: MotionValue<number>;
  spotlight: MotionValue<number>;
  overview: MotionValue<number>;
};

function MovingTile({ mode, index, progress, spotlight, overview }: MovingTileProps) {
  const { icon: Icon } = mode;
  const drop = .43 + index * .018;
  const start = .59 + index * .052;
  const shown = useTransform(progress, [drop, drop + .042], [0, 1]);
  const y = useTransform(progress, [drop, drop + .055], [-60, 0]);
  const rotate = useTransform(progress, [drop, drop + .055], [index % 2 === 0 ? -9 : 9, 0]);
  const focus = useTransform(progress, [start, start + .011, start + .041, start + .052], [0, 1, 1, 0]);
  const detail = useTransform(() => Math.max(focus.get(), overview.get()));
  const opacity = useTransform(() => shown.get() * (1 - .68 * spotlight.get() * (1 - focus.get())));
  const zIndex = useTransform(focus, (amount) => amount > 0 ? 2 : 1);
  const visibility = useTransform(focus, (amount) => amount > .62 ? "visible" : "hidden");
  return (
    <motion.li
      className="lp-story-tile-position"
      data-mode={index + 1}
      style={{ "--focus": focus, "--overview": overview, "--detail": detail, opacity, zIndex } as MotionStyle}
    >
      <motion.div className="lp-story-tile" style={{ y, rotate }}>
        <div className="lp-story-tile-summary"><ModeTile mode={mode} /></div>
        <motion.div className="lp-story-expanded-layout" style={{ visibility }}>
          <div className="lp-story-expanded-copy">
            <Icon size={32} strokeWidth={1.75} aria-hidden="true" />
            <h3>{mode.label}</h3>
            <p>{mode.detail}</p>
          </div>
          <div className="lp-story-mode-example"><ModeExample index={index} /></div>
        </motion.div>
      </motion.div>
    </motion.li>
  );
}

export default function LearningStory() {
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress: progress } = useScroll({ target: stage, offset: ["start start", "end end"] });
  const difficulty = useTransform(progress, [.025, .085, .155, .225], [0, 1, 1, 0]);
  const framework = useTransform(progress, [.19, .295, .365, .445], [0, 1, 1, 0]);
  const wordOpacity = useTransform(progress, [.025, .085, .365, .445], [0, 1, 1, 0]);
  const wordY = useTransform(progress, [.15, .295], [0, .75]);
  const wordColor = useTransform(progress, [.15, .295], ["#ededed", "#85acff"]);
  const blue = useTransform(progress, [.585, .635], [0, 1]);
  const spotlight = useTransform(progress, [.59, .605, .887, .906], [0, 1, 1, 0]);
  const overview = useTransform(progress, [.905, .95], [0, 1]);

  return (
    <section id="learning-modes" className="lp-story" aria-labelledby="learning-modes-title">
      <div className="lp-story-outline">
        <p>Learning to code is difficult.</p>
        <h2 id="learning-modes-title">We built a framework for teaching code.</h2>
        <ol role="list" className="lp-story-list">
          {modes.map((mode) => <li key={mode.label} className="lp-story-tile"><ModeTile mode={mode} /></li>)}
        </ol>
      </div>

      <div ref={stage} className="lp-story-scroll" aria-hidden="true">
        <div className="lp-story-pin">
          <motion.div className="lp-story-blue" style={{ opacity: blue }} />
          <div className="lp-story-scene">
            <motion.div className="lp-story-words lp-story-difficulty" style={{ opacity: difficulty }}>
              <span>Learning to</span><span>is difficult.</span>
            </motion.div>
            <motion.div className="lp-story-words lp-story-framework" style={{ opacity: framework }}>
              <span>We built a framework</span><span>for teaching</span>
            </motion.div>
            <motion.div className="lp-story-word" style={{ opacity: wordOpacity, color: wordColor, "--word-shift": wordY } as MotionStyle}>code</motion.div>
            <ol className="lp-story-tiles">
              {modes.map((mode, index) => <MovingTile key={mode.label} mode={mode} index={index} progress={progress} spotlight={spotlight} overview={overview} />)}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
