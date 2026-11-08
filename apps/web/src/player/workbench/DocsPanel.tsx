import { useId, useState } from "react";
import { Search } from "lucide-react";
import { DOCS, searchDocs, type Doc } from "./docs";

type Props = {
  /** Id of the doc to show. The caller owns it so the palette and hovers can open one. */
  selected: string | null;
  onSelect(id: string): void;
};

function Block({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <>
      <h3 className="wb-sec h-[22px] p-0">{label}</h3>
      {mono ? (
        <pre className="wb-mono mb-3.5 whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--pane2)] px-2.5 py-2 text-xs">{text}</pre>
      ) : (
        <p className="mb-3.5">{text}</p>
      )}
    </>
  );
}

export default function DocsPanel({ selected, onSelect }: Props) {
  const [q, setQ] = useState("");
  const uid = useId();
  const doc: Doc | undefined = selected ? DOCS.find((d) => d.id === selected) : undefined;
  const results = searchDocs(q);
  const byId = (id: string) => DOCS.find((d) => d.id === id);

  const pick = (id: string) => {
    onSelect(id);
    setQ("");
  };

  return (
    <div className="wb-prose flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-[33px] flex-none items-center gap-2.5 border-b border-[var(--line)] px-3">
        <h2 className="flex-none text-[13px] font-semibold">Docs</h2>
        <label htmlFor={`${uid}-q`} className="sr-only">Search docs</label>
        <div className="flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-[13px] border border-[var(--line)] bg-[var(--pane2)] px-3 shadow-[0_1px_2px_rgba(20,30,70,.08)]">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" className="flex-none text-[var(--mu)]" />
          <input
            id={`${uid}-q`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search docs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && q && (e.stopPropagation(), setQ(""))}
            className="min-w-0 flex-1 border-0 bg-transparent text-[var(--tx)] outline-none placeholder:text-[var(--mu)]"
          />
        </div>
        {q.trim() && (
          <div className="absolute inset-x-3 top-[34px] z-10 max-h-[230px] overflow-auto rounded-xl border border-[var(--line)] bg-[var(--tbar)] p-1 shadow-[0_10px_28px_rgba(20,30,70,.18)]">
            {results.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => pick(d.id)}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--hov)]"
              >
                <span className="font-medium">{d.title}</span> <span className="text-[11.5px] text-[var(--mu)]">{d.src}</span>
              </button>
            ))}
            {results.length === 0 && <p role="status" className="px-2.5 py-2 text-[var(--mu)]">No docs match that search.</p>}
          </div>
        )}
      </div>
      {doc && <article className="wb-scroll min-h-0 flex-1 px-4 pb-5 pt-4" aria-label={doc.title}>
          <div className="text-[11.5px] text-[var(--mu)]">{doc.src}</div>
          <h2 className="mb-2 mt-0.5 text-lg font-semibold leading-tight">{doc.title}</h2>
          <p className="mb-3.5">{doc.snippet}</p>
          <Block label="Syntax" text={doc.syntax} mono />
          <Block label="Example" text={doc.example} mono />
          <Block label="Details" text={doc.detail} />
          <h3 className="wb-sec h-[22px] p-0">See also</h3>
          <div className="flex flex-wrap gap-1.5">
            {doc.see.map((id) => {
              const r = byId(id);
              return r && (
                <button key={id} type="button" className="wb-chip" onClick={() => onSelect(id)}>
                  {r.title}
                </button>
              );
            })}
          </div>
        </article>}
    </div>
  );
}
