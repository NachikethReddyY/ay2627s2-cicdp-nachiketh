import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, listFiles, type DirEntry } from "../runPython";
import { FOCUS } from "../ui";
import { canExpand } from "./canExpand";
import { toggleExpanded } from "./expanded";

type FileTreeProps = { refreshKey: number };
type Listing = { entries: DirEntry[]; truncated: boolean };

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const errText = (e: unknown) => (e instanceof ApiError && e.status === 409 ? "Open the terminal first" : "Could not list files");

function Dir({ path, refreshKey, depth }: { path: string; refreshKey: number; depth: number }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current; // a slower, older response must not overwrite a newer one
    setError(null);
    listFiles(path || undefined).then(
      (l) => { if (mine === seq.current) setListing(l); },
      (e) => { if (mine === seq.current) setError(errText(e)); },
    );
  }, [path]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const pad = { paddingLeft: depth * 12 };
  if (error) {
    return (
      <div style={pad} className="flex items-center gap-1 py-0.5 text-xs">
        <span>{error}</span>
        <button type="button" onClick={load} className={`underline ${FOCUS}`}>Retry</button>
      </div>
    );
  }
  if (!listing) return <div style={pad} className="py-0.5 text-xs opacity-60">Loading…</div>;
  if (listing.entries.length === 0 && !listing.truncated) return <div style={pad} className="py-0.5 text-xs opacity-60">Empty</div>;
  return (
    <ul>
      {listing.entries.map((en) => {
        const p = join(path, en.name);
        const isDir = en.type === "dir" && canExpand(path, en.name);
        return (
          <li key={en.name}>
            {isDir ? (
              <button
                type="button"
                aria-expanded={open.has(en.name)}
                onClick={() => setOpen((o) => toggleExpanded(o, en.name))}
                style={pad}
                className={`flex w-full items-center gap-1 py-0.5 text-left text-xs hover:bg-white/10 ${FOCUS}`}
              >
                <span aria-hidden="true">{open.has(en.name) ? "▾" : "▸"}</span>
                {en.name}
              </button>
            ) : (
              <div style={pad} className="py-0.5 pl-3 text-xs opacity-80">{en.name}{en.type === "link" ? " →" : en.type === "dir" ? "/" : ""}</div>
            )}
            {isDir && open.has(en.name) && <Dir path={p} refreshKey={refreshKey} depth={depth + 1} />}
          </li>
        );
      })}
      {listing.truncated && <li style={pad} className="py-0.5 text-xs opacity-60">…more</li>}
    </ul>
  );
}

export default function FileTree({ refreshKey }: FileTreeProps) {
  return (
    <nav aria-label="Files" className="h-full overflow-auto p-1 font-mono">
      <Dir path="" refreshKey={refreshKey} depth={0} />
    </nav>
  );
}
