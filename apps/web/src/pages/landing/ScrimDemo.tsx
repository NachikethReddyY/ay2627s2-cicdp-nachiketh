import { useRef, useState } from "react";
import { AudioLines, Code2, MonitorPlay, RotateCcw } from "lucide-react";
import "./scrim-demo.css";

const choices = ["8", "undefined", "0"] as const;
type Choice = (typeof choices)[number];

export default function ScrimDemo() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const revealed = choice !== null;
  const replay = () => {
    setChoice(null);
    firstOption.current?.focus();
  };

  return (
    <section id="scrim-demo" className="lp-mode lp-mode-scrim" aria-labelledby="mode-scrim-title">
      <div className="lp-mode-copy">
        <MonitorPlay size={21} aria-hidden="true" />
        <div>
          <h2 id="mode-scrim-title">Try a Scrim</h2>
          <p>Read the code and choose an answer to see what the next edit does.</p>
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
    </section>
  );
}
