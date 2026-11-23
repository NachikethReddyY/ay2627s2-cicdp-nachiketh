import { useState } from "react";
import { useApi } from "../../lib/api.ts";
import { listFiles } from "../runPython";
import FileTreeView from "./FileTreeView";
import { toggleFolder } from "./fileTree";
import { sandboxNodes, type DirState } from "./sandboxTree";

export default function SandboxFiles({ selected, onRefresh }: { selected: string; onRefresh: () => void }) {
  const root = useApi("sandbox-files:home", () => listFiles());
  const [dirs, setDirs] = useState<ReadonlyMap<string, DirState>>(() => new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const load = (path: string) => {
    setDirs((m) => new Map(m).set(path, "loading"));
    listFiles(path).then(
      (listing) => setDirs((m) => new Map(m).set(path, listing)),
      () => setDirs((m) => new Map(m).set(path, "error")),
    );
  };
  const toggle = (path: string) => {
    const opening = !open.has(path);
    setOpen((o) => toggleFolder(o, path));
    const cached = dirs.get(path);
    if (opening && (cached === undefined || cached === "error")) load(path);
  };

  if (root.error) {
    return (
      <p role="alert" className="px-2 py-1 text-xs">
        Could not list sandbox files.{" "}
        <button type="button" className="underline" onClick={root.reload}>Retry</button>
      </p>
    );
  }
  if (!root.data) return <p role="status" className="px-2 py-1 text-xs opacity-70">Loading sandbox files…</p>;
  return (
    <>
      <div className="px-2 py-1 text-xs">
        <button type="button" className="underline" onClick={onRefresh}>Refresh sandbox files</button>
      </div>
      <FileTreeView label="Sandbox files" nodes={sandboxNodes(root.data, dirs)} open={open} selected={selected} onToggle={toggle} onSelect={() => {}} />
    </>
  );
}
