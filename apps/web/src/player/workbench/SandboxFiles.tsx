import { FilePlus, FolderPlus, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import { useApi } from "../../lib/api.ts";
import { createWorkspaceEntry, listFiles } from "../runPython";
import FileTreeView from "./FileTreeView";
import { Mark } from "./Toolbar";
import { toggleFolder } from "./fileTree";
import { sandboxNodes, type DirState } from "./sandboxTree";

type Props = {
  workspace: string;
  title: string;
  solution: string;
  selected: string;
  ready: boolean;
  revision: number;
  onRefresh: () => void;
  onSelect: (path: string) => void;
  onSave: () => void;
  fileNotice: string;
};

export default function SandboxFiles({ workspace, title, solution, selected, ready, revision, onRefresh, onSelect, onSave, fileNotice }: Props) {
  const root = useApi(`sandbox-files:${workspace}:${ready}:${revision}`, () => ready ? listFiles(undefined, workspace) : Promise.resolve(null));
  const [dirs, setDirs] = useState<ReadonlyMap<string, DirState>>(() => new Map());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = (path: string) => {
    setDirs((m) => new Map(m).set(path, "loading"));
    listFiles(path, workspace).then(
      (listing) => setDirs((m) => new Map(m).set(path, listing)),
      () => setDirs((m) => new Map(m).set(path, "error")),
    );
  };
  const toggle = (path: string) => {
    const opening = !open.has(path);
    setOpen((o) => toggleFolder(o, path));
    if (opening) load(path);
  };
  const refresh = () => {
    onRefresh();
    for (const path of open) load(path);
  };
  const create = async () => {
    if (!creating || busy) return;
    const next = name.trim();
    if (!next || next === solution) {
      setError(next ? "That name is reserved for the lesson file." : "Enter a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createWorkspaceEntry(workspace, next, creating);
      if (creating === "file") onSelect(next);
      setCreating(null);
      setName("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the entry.");
    } finally {
      setBusy(false);
    }
  };
  const listing = root.data;
  const nodes = listing ? sandboxNodes({ ...listing, entries: listing.entries.filter((entry) => entry.name !== solution) }, dirs) : [];
  const select = (path: string) => {
    if (path.split("/").every((segment) => /^[A-Za-z0-9._-]{1,64}$/.test(segment))) onSelect(path);
  };
  const begin = (kind: "file" | "folder") => { setCreating(kind); setName(""); setError(""); };

  return (
    <div className="min-w-0">
      <div className="wb-lesson-subhead flex min-w-0 items-center justify-between gap-1 px-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold" title={title}>
          <Mark size={16} />
          <span className="truncate">{title}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Workspace actions">
          <button type="button" className="wb-workspace-tool" aria-label="New file" title="New file" disabled={!ready || busy} onClick={() => begin("file")}><FilePlus size={15} aria-hidden="true" /></button>
          <button type="button" className="wb-workspace-tool" aria-label="New folder" title="New folder" disabled={!ready || busy} onClick={() => begin("folder")}><FolderPlus size={15} aria-hidden="true" /></button>
          <button type="button" className="wb-workspace-tool" aria-label="Save workspace file" title="Save workspace file" disabled={!ready} onClick={onSave}><Save size={15} aria-hidden="true" /></button>
          <button type="button" className="wb-workspace-tool" aria-label="Refresh workspace files" title="Refresh workspace files" disabled={!ready} onClick={refresh}><RefreshCw size={15} aria-hidden="true" /></button>
        </div>
      </div>
      {creating && <form className="flex flex-wrap gap-1 px-2 py-2 text-xs" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input autoFocus aria-label={creating === "file" ? "File name" : "Folder name"} maxLength={64} value={name} disabled={busy}
          className="min-w-0 grow rounded border border-[var(--line)] bg-[var(--code)] px-2 py-1" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="wb-tb" disabled={busy}>Create</button>
        <button type="button" className="wb-tb" disabled={busy} onClick={() => { setCreating(null); setError(""); }}>Cancel</button>
      </form>}
      {error && <p role="alert" className="px-2 py-1 text-xs">{error}</p>}
      {fileNotice && <p role="status" className="px-2 py-1 text-xs">{fileNotice}</p>}
      {Boolean(root.error) && <p role="alert" className="px-2 py-1 text-xs">Could not list workspace files. <button type="button" className="underline" onClick={refresh}>Retry</button></p>}
      <FileTreeView label="Workspace files" nodes={[{ name: solution }, ...nodes]} open={open} selected={selected} onToggle={toggle} onSelect={select} />
    </div>
  );
}
