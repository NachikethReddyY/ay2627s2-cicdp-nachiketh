import { useState } from "react";
import { parseSpec } from "@learnquest/ui-catalog";
import VisualView from "../blocks/VisualView";

/** Dev-only gallery: paste a JSON spec, see the parse result and the rendered blocks. */
export default function DevBlocks() {
  const [src, setSrc] = useState("");
  if (!import.meta.env.DEV) return null;
  const res = src.trim() ? parseSpec(src) : null;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="font-display text-2xl font-black">Block gallery</h1>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Spec JSON
        <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={10} spellCheck={false}
          className="w-full rounded-xl border-2 border-ink bg-white p-2 font-mono text-xs" />
      </label>
      {res && <pre aria-label="Parse result" className="overflow-auto whitespace-pre-wrap break-words rounded-xl border-2 border-ink bg-white p-2 font-mono text-xs">{JSON.stringify(res, null, 2)}</pre>}
      {res && <VisualView doc={src} />}
    </main>
  );
}
