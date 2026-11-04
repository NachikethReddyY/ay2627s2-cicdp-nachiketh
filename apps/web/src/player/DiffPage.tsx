import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { buildTimeline, filesAtEnd } from "@learnquest/player-core";
import lesson from "./fixtures/lesson1";
import "./monaco";
import "./player.css";

export default function DiffPage() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const m = matchMedia("(max-width: 767px)");
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  return (
    <div className="lq diff-page mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <a href="/" className="lq-logo font-display text-2xl font-black">
        Learn<span className="text-blue">Quest</span>
      </a>
      <main>
        <h1 className="mt-4 font-display text-2xl font-black">{lesson.title}: diffs</h1>
        {lesson.steps.map((s) => {
          const after = filesAtEnd(buildTimeline([s.input]));
          const changed = Object.keys(after).filter((p) => after[p] !== s.input.beforeFiles[p]);
          return (
            <section key={s.id} className="lq-card diff-step mt-8 p-4 sm:p-6" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="font-display text-xl font-black">
                Step {s.idx + 1}: {s.title}
              </h2>
              {changed.map((p) => (
                <div key={p} className="mt-3">
                  <h3 className="font-mono text-sm font-bold">{p}</h3>
                  <div className="mt-1 h-56 overflow-hidden rounded-xl border-[3px] border-ink">
                    <DiffEditor
                      original={s.input.beforeFiles[p] ?? ""}
                      modified={after[p]}
                      language={/\.tsx?$/.test(p) ? "typescript" : "javascript"}
                      theme="vs"
                      options={{
                        readOnly: true,
                        renderSideBySide: !narrow,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fontSize: 14,
                      }}
                    />
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </main>
    </div>
  );
}
