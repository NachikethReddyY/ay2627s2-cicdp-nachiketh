import { createContext, useContext, type ReactNode, type Ref } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { FileIcon } from "./FileBadge";

export const DrawerCloseContext = createContext<((afterClose?: () => void) => void) | null>(null);

type Props = {
  depth: number;
  kind: "folder" | "file";
  name: string;
  open?: boolean;
  selected?: boolean;
  status?: "M" | "A";
  icon?: ReactNode;
  strong?: boolean;
  onClick?(): void;
  ref?: Ref<HTMLButtonElement>;
  tabIndex?: number;
  setSize?: number;
  posInSet?: number;
  actions?: ReactNode;
  onMoveFile?(source: string, targetDir: string): void;
  path: string;
};

const INDENT = 12;

export default function TreeRow({ depth, kind, name, open = false, selected = false, status, icon, strong = false, onClick, ref, tabIndex, setSize, posInSet, actions, onMoveFile, path }: Props) {
  const folder = kind === "folder";
  const closeDrawer = useContext(DrawerCloseContext);
  return (
    <li role="none" className="flex min-w-0 items-center">
      <button
        ref={ref}
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={folder ? open : undefined}
        aria-selected={selected}
        aria-disabled={!onClick || undefined}
        aria-setsize={setSize}
        aria-posinset={posInSet}
        tabIndex={tabIndex}
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
        onClick={folder || !closeDrawer || !onClick ? onClick : () => { onClick(); closeDrawer(); }}
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
