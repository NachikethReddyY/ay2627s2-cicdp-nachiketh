import { useRef, useState, type ReactNode } from "react";
import { AudioLines, BookOpen, Check, ChevronRight, CircleHelp, ClipboardCheck, Code2, FileText, MonitorPlay, RotateCcw, Terminal } from "lucide-react";
import "./learning-modes.css";

const choices = ["8", "undefined", "0"] as const;
type Choice = (typeof choices)[number];

function ScrimPreview() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const revealed = choice !== null;
  const replay = () => {
    setChoice(null);
    firstOption.current?.focus();
  };

  return (
    <article className="lp-mode lp-mode-scrim" aria-labelledby="mode-scrim-title">
      <div className="lp-mode-copy">
        <MonitorPlay size={21} aria-hidden="true" />
        <div>
          <h3 id="mode-scrim-title">Scrims</h3>
          <p>Watch a narrated code replay. Predict what happens at the pause, then try the idea yourself.</p>
        </div>
      </div>

      <div className="lp-mode-player">
        <div className="lp-mode-player-bar">
          <span><Code2 size={15} aria-hidden="true" /> double.js</span>
          <span className="lp-mode-replay-state"><i aria-hidden="true" />{revealed ? "Code revealed" : "Paused for prediction"}</span>
        </div>
        <div className="lp-mode-player-body">
          <div className="lp-mode-replay">
            <pre aria-label="Code example"><code>
              <span className="lp-mode-row">
                <span aria-hidden="true">1</span><span><b>function</b> double(n) {"{"}</span>
              </span>
              <span className="lp-mode-row">
                <span aria-hidden="true">2</span><span>{"  "}<b>const</b> result = n * <em>2</em>;</span>
              </span>
              {revealed && (
                <span className="lp-mode-row lp-mode-added">
                  <span aria-hidden="true">3</span><span>{"  "}<b>return</b> result;</span>
                </span>
              )}
              <span className="lp-mode-row">
                <span aria-hidden="true">{revealed ? "4" : "3"}</span><span>{"}"}</span>
              </span>
            </code></pre>
            <div className="lp-mode-narration">
              <AudioLines size={17} aria-hidden="true" />
              <p>{revealed ? "Now the caller receives the doubled value." : "The function computes a result. Follow what happens when it ends."}</p>
            </div>
            <ol className="lp-mode-timeline" aria-label="Replay stages">
              <li className="is-done"><span />Read</li>
              <li className={revealed ? "is-done" : "is-current"} aria-current={revealed ? undefined : "step"}><span />Predict</li>
              <li className={revealed ? "is-current" : undefined} aria-current={revealed ? "step" : undefined}><span />Reveal</li>
            </ol>
          </div>
          <div className="lp-mode-prediction">
            <fieldset>
              <legend>What does <code>double(4)</code> return before any edit?</legend>
              <div className="lp-mode-choices">
                {choices.map((option) => (
                  <button
                    key={option}
                    ref={option === choices[0] ? firstOption : undefined}
                    type="button"
                    aria-disabled={revealed}
                    className={revealed && option === "undefined" ? "is-correct" : revealed && option === choice ? "is-missed" : undefined}
                    onClick={() => { if (!revealed) setChoice(option); }}
                  >
                    <code>{option}</code>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="lp-mode-result">
              <p role="status">{revealed && <>{choice === "undefined" ? "Correct. " : "It returns undefined. "}Without a return statement, the value never reaches the caller.</>}</p>
              {revealed && <button type="button" className="lp-mode-reset" onClick={replay}><RotateCcw size={14} aria-hidden="true" /> Replay</button>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function ModeCard({ id, icon, title, description, children }: { id: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <article className={`lp-mode lp-mode-${id}`} aria-labelledby={`mode-${id}-title`}>
      <div className="lp-mode-copy">
        {icon}
        <div>
          <h3 id={`mode-${id}-title`}>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="lp-mode-example" aria-hidden="true">{children}</div>
    </article>
  );
}

function OpenPageExample() {
  return (
    <div className="lp-mode-doc">
      <strong>What a function gives back</strong>
      <p>A return value goes back to the code that called the function.</p>
      <svg className="lp-mode-flow" viewBox="0 0 220 42" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="80" height="40" rx="7" />
        <rect x="139" y="1" width="80" height="40" rx="7" />
        <path className="lp-mode-flow-arrow" d="M90 21h40m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="41" y="25" textAnchor="middle">function</text>
        <text x="179" y="25" textAnchor="middle">caller</text>
      </svg>
      <code>const price = getPrice();</code>
    </div>
  );
}

export default function LearningModes() {
  return (
    <section className="lp-modes" id="learning-modes" aria-labelledby="learning-modes-title">
      <div className="lp-modes-head">
        <h2 id="learning-modes-title" className="lp-h2">Six ways to learn code</h2>
        <p>Read the idea, watch it in a Scrim, try it in the editor, then review it from memory.</p>
      </div>
      <div className="lp-modes-grid">
        <ScrimPreview />
        <ModeCard id="pages" icon={<BookOpen size={19} aria-hidden="true" />} title="Open pages" description="Explore an idea through explanations, code examples, and diagrams.">
          <OpenPageExample />
        </ModeCard>
        <ModeCard id="quiz" icon={<CircleHelp size={19} aria-hidden="true" />} title="Quizzes and scenarios" description="Predict what a small program will do before seeing the answer.">
          <div className="lp-mode-scenario">
            <code>items.map(readPrice)</code>
            <p>What does this return?</p>
            <span><i /> One price per item</span>
          </div>
        </ModeCard>
        <ModeCard id="practice" icon={<Terminal size={19} aria-hidden="true" />} title="Practice editors" description="Write and test code against the lab’s examples.">
          <div className="lp-mode-practice-editor">
            <code><b>return</b> n * <em>2</em>;</code>
            <span><Check size={13} /> Sample tests passed</span>
          </div>
        </ModeCard>
        <ModeCard id="summary" icon={<FileText size={19} aria-hidden="true" />} title="Summary pages" description="Revisit the rule and the mistake to watch for.">
          <div className="lp-mode-summary-note">
            <span><Check size={13} /> <code>return</code> sends a value back</span>
            <span><ChevronRight size={13} /> Logging prints a value</span>
          </div>
        </ModeCard>
        <ModeCard id="review" icon={<ClipboardCheck size={19} aria-hidden="true" />} title="Summary quizzes" description="Retrieve what you learned and apply it to a new example.">
          <div className="lp-mode-review-question">
            <p>What value does the caller receive?</p>
            <code>console.log(price);</code>
          </div>
        </ModeCard>
      </div>
    </section>
  );
}
