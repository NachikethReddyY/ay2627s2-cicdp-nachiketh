import type { ReactNode, Ref } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { FileIcon } from "./FileBadge";

type Props = {
  depth: number;
  kind: "folder" | "file";
  name: string;
  /** Folders: expanded. */
  open?: boolean;
  selected?: boolean;
  /** Source-control letter at the end of the row. */
  status?: "M" | "A";
  /** Replaces the folder icon (the project root uses the LearnSlop mark). */
  icon?: ReactNode;
  /** Bold, like the project root. */
  strong?: boolean;
  onClick(): void;
  ref?: Ref<HTMLButtonElement>;
  tabIndex?: number;
  setSize?: number;
  posInSet?: number;
  actions?: ReactNode;
  onMoveFile?(source: string, targetDir: string): void;
  path: string;
};

const INDENT = 12; // px per depth level (Main.dc.html: 8, 20, 32, 44, 56)

/** One row of the file tree: Main.dc.html's 22 px row (10 px chevron, 18 px icon, 13 px name). A real button with tree semantics. */
export default function TreeRow({ depth, kind, name, open = false, selected = false, status, icon, strong = false, onClick, ref, tabIndex, setSize, posInSet, actions, onMoveFile, path }: Props) {
  const folder = kind === "folder";
  return (
    <li role="none" className="flex min-w-0 items-center">
      <button
        ref={ref}
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={folder ? open : undefined}
        aria-selected={selected}
        aria-setsize={setSize}
        aria-posinset={posInSet}
        tabIndex={tabIndex}
        data-drawer-close={folder ? undefined : ""}
        title={name}
        className={`wb-row min-w-0 flex-1 ${strong ? "wb-row-strong" : ""}`}
        style={{ paddingLeft: 8 + INDENT * depth }}
        draggable={!folder && !!onMoveFile}
        onDragStart={!folder && onMoveFile ? (event) => {
          event.dataTransfer.setData("application/x-learnquest-workspace-file", path);
          event.dataTransfer.effectAllowed = "move";
        } : undefined}
        onDragOver={folder && onMoveFile ? (event) => {
          if (event.dataTransfer.types.includes("application/x-learnquest-workspace-file")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        } : undefined}
        onDrop={folder && onMoveFile ? (event) => {
          const source = event.dataTransfer.getData("application/x-learnquest-workspace-file");
          if (!source || source === path || path.startsWith(`${source}/`)) return;
          event.preventDefault();
          onMoveFile(source, path);
        } : undefined}
        onClick={onClick}
      >
        {folder ? (
          <ChevronRight size={10} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" className="flex-none opacity-65" style={{ transform: open ? "rotate(90deg)" : undefined }} />
        ) : (
          <span aria-hidden="true" className="w-2.5 flex-none" />
        )}
        {folder ? icon ?? (open
          ? <FolderOpen size={18} strokeWidth={1.35} fill="var(--folder-open)" stroke="var(--folder-open)" aria-hidden="true" className="flex-none" />
          : <Folder size={18} strokeWidth={1.35} fill="var(--folder)" stroke="var(--folder)" aria-hidden="true" className="flex-none" />) : <FileIcon path={name} />}
        <span className="truncate">{name}</span>
        {status && (
          <span className={status === "M" ? "wb-mono wb-git-m" : "wb-mono ml-auto text-[var(--ok)]"}>
            {status}
            <span className="sr-only">{status === "M" ? " (modified)" : " (added)"}</span>
          </span>
        )}
      </button>
      {actions}
    </li>
  );
}
