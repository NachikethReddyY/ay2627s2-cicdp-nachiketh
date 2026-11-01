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
              <span className="flex min-h-6 items-center gap-1.5 px-1 text-sm font-extrabold">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 flex-none fill-green stroke-ink stroke-2 [stroke-linejoin:round]">
                  <path d="M3 6h7l2 2h9v11H3z" />
                </svg>
                {n.name}
              </span>
              <div className="ml-2 border-l-2 border-ink/30 pl-1.5">
                <List nodes={n.kids} viewed={viewed} editing={editing} onPick={onPick} />
              </div>
            </>
          ) : (
            <button
              type="button"
              aria-current={n.path === viewed ? "true" : undefined}
              onClick={() => onPick(n.path!)}
              className={`flex min-h-6 w-full items-center gap-1.5 rounded-md px-1 text-left font-mono text-sm ${FOCUS} ${n.path === viewed ? "bg-sun font-bold" : "hover:bg-mint"}`}
            >
              <span className="truncate">{n.name}</span>
              {n.path === editing && (
                <>
                  <span aria-hidden="true" className="ml-auto size-2.5 flex-none rounded-full border-2 border-ink bg-pink" />
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
      className="max-h-48 flex-none overflow-auto border-b-[3px] border-ink bg-paper p-2 lg:max-h-none lg:w-[200px] lg:border-r-[3px] lg:border-b-0"
    >
      <List nodes={build(paths)} viewed={viewed} editing={editing} onPick={onPick} />
    </nav>
  );
}
