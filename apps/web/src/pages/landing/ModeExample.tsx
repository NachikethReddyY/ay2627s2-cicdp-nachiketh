import { ArrowRight, BookOpen, Braces, Check, ChevronRight, ClipboardCheck, Code2, FileText, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import "./mode-example.css";

function ExampleWindow({ name, icon, children }: { name: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="lp-example">
      <div className="lp-example-bar">{icon}<span>{name}</span></div>
      <div className="lp-example-content">{children}</div>
    </div>
  );
}

const examples = [
  <ExampleWindow key="read" name="Open page" icon={<BookOpen size={17} />}>
    <strong>What does a function return?</strong>
    <p>A return value goes back to the code that called the function.</p>
    <div className="lp-example-flow"><code>double(4)</code><ArrowRight size={22} /><code>8</code></div>
    <pre>{`function double(n) {\n  return n * 2;\n}`}</pre>
  </ExampleWindow>,
  <ExampleWindow key="scenario" name="Read the code" icon={<Braces size={17} />}>
    <pre>{`function double(n) {\n  return n * 2;\n}\ndouble(4);`}</pre>
    <strong>What does the caller receive?</strong>
    <ul className="lp-example-options">
      <li><span /> 4</li>
      <li><span /> 8</li>
      <li><span /> undefined</li>
    </ul>
  </ExampleWindow>,
  <img key="scrim" className="lp-example-image" src="/images/landing-scrim.png" width={2000} height={1210} loading="lazy" decoding="async" alt="" />,
  <ExampleWindow key="practice" name="solution.js" icon={<Code2 size={17} />}>
    <pre>{`function triple(n) {\n  return n * 3;\n}`}</pre>
    <div className="lp-example-console"><Terminal size={17} /><code>triple(4) → 12</code></div>
    <p className="lp-example-pass"><Check size={17} /> Sample tests passed</p>
  </ExampleWindow>,
  <ExampleWindow key="summary" name="Return values recap" icon={<FileText size={17} />}>
    <strong>Follow the value back to its caller.</strong>
    <ul className="lp-example-notes">
      <li><Check size={17} /><span><code>return</code> sends a value back.</span></li>
      <li><ChevronRight size={17} /><span><code>console.log</code> prints to the console.</span></li>
      <li><ChevronRight size={17} /><span>The two can happen in the same function.</span></li>
    </ul>
  </ExampleWindow>,
  <ExampleWindow key="check" name="Summary quiz" icon={<ClipboardCheck size={17} />}>
    <pre>{`function price() {\n  console.log(5);\n}\nconst total = price();`}</pre>
    <strong>What value is stored in <code>total</code>?</strong>
    <div className="lp-example-blank">Your prediction</div>
  </ExampleWindow>,
];

export function ModeExample({ index }: { index: number }) {
  return examples[index];
}
