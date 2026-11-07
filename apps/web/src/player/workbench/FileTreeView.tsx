import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Mark } from "./Toolbar";
import { flattenTree, type TreeNode } from "./fileTree";
import TreeRow from "./TreeRow";

type Props = {
  label: string;
  nodes: TreeNode[];
  open: ReadonlySet<string>;
  /** Path of the selected file. */
  selected: string;
  onToggle(path: string): void;
  onSelect(path: string): void;
  rootActions?: ReactNode;
  onMoveFile?(source: string, targetDir: string): void;
};

/** The navigator's tree: rows from flattenTree, Main.dc.html's look, WAI-ARIA tree keys (arrows, Home, End). */
export default function FileTreeView({ label, nodes, open, selected, onToggle, onSelect, rootActions, onMoveFile }: Props) {
  const rows = useMemo(() => flattenTree(nodes, open), [nodes, open]);
  const list = useRef<HTMLUListElement>(null);
  const tabStop = rows.some((r) => r.path === selected) ? selected : rows[0]?.path;

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const row = rows[at];
    if (at < 0 || !row) return;
    const go = (i: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "ArrowRight" && row.isFolder) {
      e.preventDefault();
      if (!row.open) onToggle(row.path);
      else go(at + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.isFolder && row.open) onToggle(row.path);
      else {
        // To the parent folder: the nearest row above with a smaller depth.
        for (let i = at - 1; i >= 0; i--) if (rows[i].depth < row.depth) return go(i);
      }
    }
  };

  return (
    <ul ref={list} role="tree" aria-label={label} onKeyDown={onKeyDown}>
      {rows.map((r) => (
        <TreeRow
          key={r.path}
          depth={r.depth}
          kind={r.isFolder ? "folder" : "file"}
          name={r.node.name}
          open={r.open}
          setSize={r.setSize}
          posInSet={r.posInSet}
          selected={r.path === selected}
          status={r.node.status}
          strong={r.depth === 0}
          icon={r.depth === 0 ? <Mark size={18} /> : undefined}
          actions={r.depth === 0 ? rootActions : undefined}
          path={r.path}
          onMoveFile={onMoveFile}
          tabIndex={r.path === tabStop ? 0 : -1}
          onClick={() => (r.isFolder ? onToggle(r.path) : onSelect(r.path))}
        />
      ))}
    </ul>
  );
}
