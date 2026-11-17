import { FOCUS } from "./ui";

type Node = { name: string; path?: string; kids: Node[] };

function build(paths: string[]) {
  const root: Node = { name: "", kids: [] };
  for (const p of paths) {
    let n = root;
    p.split("/").forEach((seg, i, a) => {
      const leaf = i === a.length - 1;
      let k = n.kids.find((c) => c.name === seg && (c.path !== undefined) === leaf);
      if (!k) n.kids.push((k = { name: seg, kids: [], path: leaf ? p : undefined }));
      n = k;
    });
  }
  return root.kids;
}

type Props = { id: string; hidden: boolean; paths: string[]; viewed: string; editing: string; onPick(p: string): void };

function List({ nodes, viewed, editing, onPick }: { nodes: Node[] } & Omit<Props, "id" | "hidden" | "paths">) {
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((n) => (
        <li key={n.name + (n.path ?? "/")}>
          {n.path === undefined ? (
            <>
              <span className="flex min-h-6 items-center gap-1.5 px-1 text-sm font-semibold">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 flex-none fill-[var(--sel)] stroke-[var(--mu)] stroke-2 [stroke-linejoin:round]">
                  <path d="M3 6h7l2 2h9v11H3z" />
                </svg>
                {n.name}
              </span>
              <div className="ml-2 border-l border-ink pl-1.5">
                <List nodes={n.kids} viewed={viewed} editing={editing} onPick={onPick} />
              </div>
            </>
          ) : (
            <button
              type="button"
              aria-current={n.path === viewed ? "true" : undefined}
              onClick={() => onPick(n.path!)}
              className={`flex min-h-6 w-full items-center gap-1.5 rounded-md px-1 text-left font-mono text-sm ${FOCUS} ${n.path === viewed ? "bg-[var(--sel)] font-semibold text-[var(--acT)]" : "hover:bg-[var(--hov)]"}`}
            >
              <span className="truncate">{n.name}</span>
              {n.path === editing && (
                <>
                  <span aria-hidden="true" className="ml-auto size-2 flex-none rounded-full bg-blue" />
                  <span className="sr-only">being edited</span>
                </>
              )}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Explorer({ id, hidden, paths, viewed, editing, onPick }: Props) {
  return (
    <nav
      id={id}
      hidden={hidden}
      aria-label="Files"
      className="max-h-48 flex-none overflow-auto border-b border-ink bg-[var(--side)] p-2 lg:max-h-none lg:w-[200px] lg:border-r lg:border-b-0"
    >
      <List nodes={build(paths)} viewed={viewed} editing={editing} onPick={onPick} />
    </nav>
  );
}
