import { useState } from "react";
import { BLOCKS, parseSpec } from "@learnquest/ui-catalog";
import VisualView from "../blocks/VisualView";
import "./home.css";
import "./devblocks.css";

const examples = [
  "a labelled diagram of a plant cell",
  "a bouncing ball animation",
  "a quiz on the planets",
];

/** "blocks.1.props.timeline.steps.2.set.0.value" -> "Block 2, step 3, set 1, value". Falls back to the raw path. */
function plainIssue({ path, message }: { path: string; message: string }): string {
  const m = /^blocks\.(\d+)(?:\.props)?\.?(.*)$/.exec(path);
  if (!m) return `${path}: ${message}`;
  const rest = m[2].replace(/timeline\.steps\.(\d+)/, (_, n) => `step ${+n + 1}`).replace(/\.?set\.(\d+)/, (_, n) => `, set ${+n + 1}`).replace(/\./g, ", ").replace(/^, /, "");
  return `Block ${+m[1] + 1}${rest ? `, ${rest.replace(/^step (\d+), ,/, "step $1,")}` : ""}: ${message}`;
}

/** Dev-only gallery: generate, edit, parse, and preview visual block specs. */
export default function DevBlocks() {
  const [src, setSrc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [specOpen, setSpecOpen] = useState(false);
  if (!import.meta.env.DEV) return null;

  const res = src.trim() ? parseSpec(src) : null;
  const dropped = res ? res.issues.filter((i) => /^blocks\.\d+(\.|$)/.test(i.path)) : [];
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  async function generate() {
    setLoading(true);
    setStatus("loading");
    setError("");
    try {
      const r = await fetch("/api/dev/visual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await r.json().catch(() => null)) as { doc?: unknown; error?: { message?: string } } | null;
      if (!r.ok || !body?.doc) throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
      setSrc(JSON.stringify(body.doc, null, 2));
      setSpecOpen(false);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="lq devblocks">
      <div className="db-wrap">
        <header className="db-header">
          <span className="lq-sticker lq-bg-pink">DEV TOOL</span>
          <h1>Block playground</h1>
          <p>Generate a visual, inspect its spec, and try edits live.</p>
        </header>
        {reducedMotion && <p className="db-notice" role="status">Reduce motion is on in your system settings, so animations are paused. Use the step controls to move through the steps.</p>}
        <div className="db-grid">
          <section className="db-controls" aria-label="Block controls">
            <div className="lq-card db-panel">
              <label className="db-label" htmlFor="db-prompt">Prompt</label>
              <textarea id="db-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} maxLength={500} />
              <div className="db-picks" aria-label="Example prompts">
                {examples.map((example) => <button className="lq-chip" type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}
              </div>
              <button type="button" disabled={loading || !prompt.trim()} onClick={generate} className="lq-btn lq-btn-sun db-generate">
                {loading && <span aria-hidden="true" className="db-spinner" />}
                {loading ? "Generating…" : "Generate"}
              </button>
              <p className={`db-status ${status === "error" ? "is-error" : ""}`} aria-live="polite" role={status === "error" ? "alert" : undefined}>
                {status === "loading" ? "Generating…" : status === "done" ? "Done." : status === "error" ? error : "Idle"}
              </p>
            </div>
            <details className="lq-card db-details" open={specOpen} onToggle={(e) => setSpecOpen(e.currentTarget.open)}>
              <summary>Spec JSON</summary>
              <label className="db-label" htmlFor="db-spec">Edit spec JSON</label>
              <textarea id="db-spec" value={src} onChange={(e) => setSrc(e.target.value)} rows={14} spellCheck={false} />
            </details>
            {res && <details className="lq-card db-details db-parse">
              <summary>Parse result</summary>
              {res.issues.length > 0 && <div className="db-issues"><h2>Issues</h2><ul>{res.issues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul></div>}
              <pre>{JSON.stringify(res, null, 2)}</pre>
            </details>}
          </section>
          <section className="db-preview" aria-label="Rendered visual">
            <div className="lq-card db-preview-card">
              <h2>Preview</h2>
              {dropped.length > 0 && <div className="db-notice" role="alert">A visual was dropped because it failed validation. {dropped.length > 3 ? `First 3 of ${dropped.length} issues:` : "Issues:"}<ul>{dropped.slice(0, 3).map((i, n) => <li key={n}>{plainIssue(i)}</li>)}</ul></div>}
              {res ? <VisualView doc={src} registry={BLOCKS} /> : <p className="db-empty">Your rendered visual will appear here.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
