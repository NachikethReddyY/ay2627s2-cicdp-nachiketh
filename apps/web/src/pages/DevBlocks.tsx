import { useState } from "react";
import { parseSpec } from "@learnquest/ui-catalog";
import VisualView from "../blocks/VisualView";

const box = "w-full rounded-xl border-2 border-ink bg-white p-2";

/** Dev-only gallery: type a prompt or paste a JSON spec, see the parse result and the rendered blocks. */
export default function DevBlocks() {
  const [src, setSrc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  if (!import.meta.env.DEV) return null;
  const res = src.trim() ? parseSpec(src) : null;

  async function generate() {
    setLoading(true);
    setMsg("Generating...");
    try {
      const r = await fetch("/api/dev/visual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await r.json().catch(() => null)) as { doc?: unknown; error?: { message?: string } } | null;
      if (!r.ok || !body?.doc) throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
      setSrc(JSON.stringify(body.doc, null, 2));
      setMsg("Done.");
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="font-display text-2xl font-black">Block gallery</h1>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-extrabold">
          Prompt
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={500}
            className={box} />
        </label>
        <button type="button" disabled={loading || !prompt.trim()} onClick={generate}
          className="min-h-11 self-start rounded-full border-2 border-ink px-4 font-extrabold disabled:opacity-50">
          {loading ? "Generating..." : "Generate"}
        </button>
        <p aria-live="polite" className="min-h-5 text-sm">{msg}</p>
      </div>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Spec JSON
        <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={10} spellCheck={false}
          className={`${box} font-mono text-xs`} />
      </label>
      {res && <pre aria-label="Parse result" className="overflow-auto whitespace-pre-wrap break-words rounded-xl border-2 border-ink bg-white p-2 font-mono text-xs">{JSON.stringify(res, null, 2)}</pre>}
      {res && <VisualView doc={src} />}
    </main>
  );
}
