import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ExternalLink, FilePlus2, FolderPlus, LoaderCircle, Maximize2, Minimize2, Monitor, MonitorPlay, Play, RefreshCw, Smartphone, Tablet, X } from "lucide-react";
import { createPortal } from "react-dom";
import { usePanel } from "../player/terminal/usePanel";
import TerminalView from "../player/terminal/TerminalView";
import { createShellSocket, type ShellSocket, type ShellState } from "../player/terminal/shellSocket";
import { ApiError, getWorkspaceFile, listFileDirectories, listFiles, moveWorkspaceFile, putFile, putWorkspaceFile, readWorkspaceFiles } from "../player/runPython";
import { runInShell, runShellCommand, RunInShellError } from "../player/terminal/runInShell";
import FileTreeView from "../player/workbench/FileTreeView";
import { ancestors, initialOpen, sortTree, toggleFolder, type TreeNode } from "../player/workbench/fileTree";
import DocsPanel from "../player/workbench/DocsPanel";
import { DOCS } from "../player/workbench/docs";
import Workbench from "../player/workbench/Workbench";
import WorkbenchEditor from "../player/workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../player/workbench/StatusBar";
import { languageOf } from "./testEditorFixture";
import { DEMO_DIRECTORY, DEMO_ENTRY_FILE, DEMO_PROJECT_FILES } from "./testEditorDemo";
import { Toaster, toast } from "sonner";
import { removeWebPreviewFile, startWebPreview, syncWebPreviewFile, type PreviewFile } from "./webContainerPreview";

// Dev-only workbench for browsing and editing the authenticated container workspace.

const READY: WorkbenchStatus = { text: "Ready" };
const DEMO_WEB_FILES = DEMO_PROJECT_FILES.filter((file) => file.path.includes("/web/"));
const DEMO_ENTRY_TEXT = DEMO_PROJECT_FILES.find((file) => file.path === DEMO_ENTRY_FILE)?.content ?? "";

// The bundled demo as a file tree, so the editor paints at once while the sandbox is still starting.
function demoTree(): TreeNode[] {
  const root: TreeNode[] = [];
  for (const { path } of DEMO_PROJECT_FILES) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, index) => {
      if (index === parts.length - 1) {
        level.push({ name });
        return;
      }
      let folder = level.find((node) => node.name === name);
      if (!folder) {
        folder = { name, open: index === 0 && name === DEMO_DIRECTORY, children: [] };
        level.push(folder);
      }
      level = folder.children!;
    });
  }
  return sortTree(root);
}

const LANGUAGE_LABELS: Record<string, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", markdown: "Markdown", json: "JSON", html: "HTML", css: "CSS" };
const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
const MAX_TERMINALS = 4;
type TerminalSession = { id: string; label: string; socket: ShellSocket };
type BrowserPreview = { state: "idle" | "starting" | "ready" | "error"; url?: string; message?: string };
type PreviewLog = { level: string; args: string[]; time: string };
type PreviewDevice = "responsive" | "mobile" | "tablet";

async function ensureWebPreviewFiles() {
  let packageContent = DEMO_PROJECT_FILES.find((file) => file.path.endsWith("/package.json"))!.content;
  try {
    packageContent = (await getWorkspaceFile(`${DEMO_DIRECTORY}/package.json`)).content;
  } catch { /* The first seed below supplies the package manifest. */ }

  try {
    const manifest = JSON.parse(packageContent) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = { ...manifest.scripts };
    const dependencies = { ...manifest.dependencies };
    const devDependencies = { ...manifest.devDependencies };
    let changed = false;
    if (!scripts.dev) { scripts.dev = "vite web --host 0.0.0.0"; changed = true; }
    if (!dependencies.react) { dependencies.react = "^19.0.0"; changed = true; }
    if (!dependencies["react-dom"]) { dependencies["react-dom"] = "^19.0.0"; changed = true; }
    if (!devDependencies.vite) { devDependencies.vite = "^6.1.0"; changed = true; }
    if (changed) {
      await putWorkspaceFile(`${DEMO_DIRECTORY}/package.json`, JSON.stringify({
        ...manifest,
        scripts,
        dependencies,
        devDependencies,
      }, null, 2) + "\n");
    }
  } catch { /* Keep a learner's non-JSON manifest untouched. */ }

  await Promise.all(DEMO_WEB_FILES.map(async (file) => {
    if (!(await workspaceFileExists(file.path))) await putWorkspaceFile(file.path, file.content);
  }));
}

function workspaceNodes(entries: Awaited<ReturnType<typeof listFiles>>["entries"], dir = ""): TreeNode[] {
  return entries.filter((entry) => (entry.type === "file" || entry.type === "dir") && entry.name !== ".learnquest-folder" && (dir || entry.name === DEMO_DIRECTORY))
    .sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((entry) => {
    if (entry.type === "file") return { name: entry.name };
    return { name: entry.name, open: !dir && entry.name === DEMO_DIRECTORY, children: [] };
  });
}

async function workspaceTree(dir = ""): Promise<TreeNode[]> {
  const { entries } = await listFiles(dir || undefined);
  return workspaceNodes(entries, dir);
}

function mergeWorkspaceTree(current: TreeNode[], listings: Map<string, TreeNode[]>): TreeNode[] {
  const merge = (next: TreeNode[], previous: TreeNode[], parent: string): TreeNode[] => next.map((node) => {
    if (!node.children) return node;
    const path = joinPath(parent, node.name);
    const old = previous.find((item) => item.name === node.name);
    const children = listings.get(path);
    return { ...node, children: children ? merge(children, old?.children ?? [], path) : old?.children ?? [] };
  });
  return listings.has("") ? merge(listings.get("")!, current, "") : current;
}

function workspaceFiles(nodes: TreeNode[], parent = ""): string[] {
  return nodes.flatMap((node) => {
    const path = joinPath(parent, node.name);
    return node.children ? workspaceFiles(node.children, path) : [path];
  });
}

// Only a 404 means the file is missing. Any other failure is rethrown, so a seed never overwrites a file it could not read.
async function workspaceFileExists(path: string) {
  try {
    await getWorkspaceFile(path);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}

// The sandbox API returns text only, so binary files would reach the preview corrupted. They are skipped by extension before any read.
const BINARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "woff", "woff2", "ttf", "otf", "eot", "pdf", "zip", "mp3", "mp4", "wav", "webm"]);
const isBinaryFile = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
};

// Reads the demo project as it is saved in the sandbox, so a reload keeps learner edits to files that were never opened.
// Dependencies and dotfiles are skipped, and a file too large to open is left out instead of failing the whole preview.
// Binary assets are skipped and reported through binarySkipped, so the caller can tell the learner why the page may differ.
// The paths are listed first, then read in batches of 64, so a project of any size costs one read request per 64 files.
async function savedProjectFiles(): Promise<{ files: PreviewFile[]; binarySkipped: boolean }> {
  const paths: string[] = [];
  let binarySkipped = false;
  const pending = [DEMO_DIRECTORY];
  while (pending.length) {
    const dirs = pending.splice(0, 32);
    const { directories } = await listFileDirectories(dirs);
    for (const dir of dirs) {
      for (const entry of directories[dir]?.entries ?? []) {
        const path = joinPath(dir, entry.name);
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        if (entry.type === "dir") pending.push(path);
        else if (entry.type === "file") {
          if (isBinaryFile(entry.name)) binarySkipped = true;
          else paths.push(path);
        }
      }
    }
  }
  const { files } = await readWorkspaceFiles(paths);
  return { files, binarySkipped };
}

export default function TestEditor() {
  const [tree, setTree] = useState<TreeNode[]>(demoTree);
  const [open, setOpen] = useState(DEMO_ENTRY_FILE);
  const [content, setContent] = useState(DEMO_ENTRY_TEXT);
  const [folders, setFolders] = useState<ReadonlySet<string>>(() => initialOpen(demoTree()));
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [status, setStatus] = useState<WorkbenchStatus>(READY);
  const [shellNote, setShellNote] = useState<string>();
  // The name field shown under the tree while a new file or folder is being named.
  const [draftEntry, setDraftEntry] = useState<"file" | "folder" | null>(null);
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("terminal-1");
  const [terminalStates, setTerminalStates] = useState<Record<string, ShellState>>({});
  const [splitTerminals, setSplitTerminals] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [browserPreview, setBrowserPreview] = useState<BrowserPreview>({ state: "idle" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMinimized, setPreviewMinimized] = useState(false);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("responsive");
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsTab, setDevtoolsTab] = useState<"console" | "elements">("console");
  const [previewLogs, setPreviewLogs] = useState<PreviewLog[]>([]);
  const [inspectedElement, setInspectedElement] = useState<{ tag: string; id?: string; classes?: string; text?: string; size?: string } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const previewWindowRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const previewStarting = useRef(false);
  const previewAutoStarted = useRef(false);
  const previewDragStart = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const runRef = useRef<HTMLButtonElement>(null);
  // The demo entry is open from the first paint, so typing before the sandbox answers is kept and saved later.
  const activePath = useRef(DEMO_ENTRY_FILE);
  const activeContent = useRef(DEMO_ENTRY_TEXT);
  // False until the open file has been read from the sandbox, so the bundled copy is checked against it once.
  const openConfirmed = useRef(false);
  const treeRef = useRef<TreeNode[]>(demoTree());
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const shellSockets = useRef(new Set<ShellSocket>());
  const openRequest = useRef(0);
  // Last known text of each file, so a click shows it at once while the sandbox copy is re-read behind it.
  const fileCache = useRef(new Map<string, string>(DEMO_PROJECT_FILES.map((file): [string, string] => [file.path, file.content])));
  const loadedFolders = useRef(new Set<string>([""]));
  const loadingWorkspace = useRef(false);
  const queuedWorkspaceRefresh = useRef(false);
  const workspaceLoad = useRef<Promise<void>>(Promise.resolve());
  const terminalNumber = useRef(1);
  // Shell tab ids carry a per-page tag, so two windows never replace each other's terminal.
  const windowTag = useRef(Math.random().toString(36).slice(2, 10));
  const panel = usePanel(); // no container: the workbench clamps the height at render

  useEffect(() => {
    setPreviewHost(document.querySelector(".wb"));
  }, []);

  useEffect(() => {
    const receivePreviewMessage = (event: MessageEvent) => {
      if (!browserPreview.url || event.source !== previewFrameRef.current?.contentWindow) return;
      if (event.origin !== new URL(browserPreview.url).origin || event.data?.__learnquestPreview !== true) return;
      if (event.data.type === "console") {
        setPreviewLogs((logs) => [...logs, { level: event.data.level, args: event.data.args, time: new Date().toLocaleTimeString() }].slice(-150));
      } else if (event.data.type === "element") {
        setInspectedElement(event.data);
        setDevtoolsTab("elements");
        setDevtoolsOpen(true);
      } else if (event.data.type === "inspect-state") {
        setInspecting(Boolean(event.data.enabled));
      }
    };
    window.addEventListener("message", receivePreviewMessage);
    return () => window.removeEventListener("message", receivePreviewMessage);
  }, [browserPreview.url]);

  useEffect(() => {
    if (!previewPosition) return;
    const keepWindowInView = () => {
      const rect = previewWindowRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left));
      const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top));
      if (left !== previewPosition.left || top !== previewPosition.top) setPreviewPosition({ left, top });
    };
    window.addEventListener("resize", keepWindowInView);
    return () => window.removeEventListener("resize", keepWindowInView);
  }, [previewPosition]);

  useEffect(() => {
    const socket = createShellSocket({ tabId: `terminal-1-${windowTag.current}` });
    shellSockets.current.add(socket);
    setTerminals([{ id: "terminal-1", label: "Terminal 1", socket }]);
    setTerminalStates({ "terminal-1": socket.state() });
    // Start the sandbox on open so the files load without opening the terminal. The terminal view's own connect() is a no-op once this one is connecting.
    // Deferred, and cancelled on cleanup: React's development double-mount would otherwise open a socket and drop it at once.
    const timer = setTimeout(() => socket.connect(), 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => () => {
    shellSockets.current.forEach((socket) => socket.dispose());
    shellSockets.current.clear();
  }, []);
  useEffect(() => {
    const unsubscribers = terminals.map((terminal) => terminal.socket.onState((state) => {
      setTerminalStates((current) => ({ ...current, [terminal.id]: state }));
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [terminals]);
  const shell = terminals.find((terminal) => terminal.id === activeTerminalId)?.socket ?? null;
  const shellState = useMemo<ShellState>(() => terminalStates[activeTerminalId] ?? { kind: "idle" as const }, [activeTerminalId, terminalStates]);
  // Switching files shows no spinner: the previous text stays until the new file arrives. Only the first load is busy.
  const workspaceStatus: WorkbenchStatus = workspaceLoading
    ? { text: "Loading workspace files…", tone: "busy" }
    : shellState.kind === "connecting"
      ? { text: "Connecting to sandbox…", tone: "busy" }
      : browserPreview.state === "error"
        ? { text: browserPreview.message ?? "The browser preview failed to start", tone: "error" }
        : status;

  const addTerminal = () => {
    if (terminals.length >= MAX_TERMINALS) return;
    const number = ++terminalNumber.current;
    const id = `terminal-${number}`;
    const socket = createShellSocket({ tabId: `${id}-${windowTag.current}` });
    shellSockets.current.add(socket);
    setTerminals((current) => [...current, { id, label: `Terminal ${number}`, socket }]);
    setTerminalStates((current) => ({ ...current, [id]: socket.state() }));
    setActiveTerminalId(id);
    setSplitTerminals(false);
    panel.dispatch({ type: "open" });
  };

  const closeTerminal = (id: string) => {
    const index = terminals.findIndex((terminal) => terminal.id === id);
    const removed = terminals[index];
    if (!removed) return;
    removed.socket.dispose();
    shellSockets.current.delete(removed.socket);
    const next = terminals.filter((terminal) => terminal.id !== id);
    setTerminals(next);
    setTerminalStates((current) => {
      const { [id]: _removed, ...remaining } = current;
      return remaining;
    });
    if (activeTerminalId === id) setActiveTerminalId(next.length ? next[Math.max(0, index - 1)].id : "");
    if (next.length < 2) setSplitTerminals(false);
  };

  // Resolves false when the edits could not be saved, so callers can keep the buffer open.
  // `keepalive` is for saves during unload or unmount, so the request can finish after the page goes away.
  const flushSave = useCallback((options: { keepalive?: boolean } = {}) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    // Saves run one at a time, so a call waits for an earlier PUT before it reads the dirty flag.
    const path = activePath.current;
    const save = saveQueue.current.then(async () => {
      // A queued save for a file that is no longer open has nothing left to write; openFile saved it first.
      // With no open file there is nowhere to write these edits, so drop the flag or the openFile loop never ends.
      if (!path) {
        dirty.current = false;
        return true;
      }
      if (!dirty.current || activePath.current !== path) return true;
      const nextContent = activeContent.current;
      dirty.current = false;
      try {
        await putWorkspaceFile(path, nextContent, { keepalive: options.keepalive === true });
        fileCache.current.set(path, nextContent);
        return true;
      } catch (error) {
        dirty.current = true;
        setShellNote(error instanceof Error ? `Could not save ${path}: ${error.message}` : `Could not save ${path}`);
        return false;
      }
    });
    saveQueue.current = save;
    return save;
  }, []);

  const refreshWorkspace = useCallback(async (seedIfEmpty = false): Promise<void> => {
    if (loadingWorkspace.current) {
      // The running load may not seed, so wait for it and then seed.
      if (seedIfEmpty) {
        await workspaceLoad.current;
        return refreshWorkspace(true);
      }
      queuedWorkspaceRefresh.current = true;
      return;
    }
    loadingWorkspace.current = true;
    let finishLoad = () => {};
    workspaceLoad.current = new Promise<void>((resolve) => { finishLoad = resolve; });
    // Only an empty tree is a loading state; the bundled demo already fills it at first paint.
    const showLoading = treeRef.current.length === 0;
    if (showLoading) setWorkspaceLoading(true);
    try {
      const loadListings = async () => {
        const listings = new Map<string, TreeNode[]>();
        const dirs = [...loadedFolders.current];
        // The API accepts at most 32 directories per request.
        for (let index = 0; index < dirs.length; index += 32) {
          const chunk = dirs.slice(index, index + 32);
          const result = await listFileDirectories(chunk);
          for (const dir of chunk) listings.set(dir, workspaceNodes(result.directories[dir]?.entries ?? [], dir));
        }
        return listings;
      };
      let listings = await loadListings();
      let files = listings.get("") ?? [];
      // Seed when the project is not initialized yet, and never overwrite a learner's existing file.
      if (seedIfEmpty && !(await workspaceFileExists(`${DEMO_DIRECTORY}/package.json`))) {
        await Promise.all(DEMO_PROJECT_FILES.map(async ({ path, content }) => {
          if (!(await workspaceFileExists(path))) await putWorkspaceFile(path, content);
        }));
        loadedFolders.current.add(DEMO_DIRECTORY);
        loadedFolders.current.add(`${DEMO_DIRECTORY}/src`);
        listings = await loadListings();
        files = listings.get("") ?? [];
      }
      if (files.some((node) => node.name === DEMO_DIRECTORY)) {
        loadedFolders.current.add(DEMO_DIRECTORY);
        loadedFolders.current.add(`${DEMO_DIRECTORY}/src`);
        if (seedIfEmpty) await ensureWebPreviewFiles();
        loadedFolders.current.add(`${DEMO_DIRECTORY}/web`);
        if (!listings.has(DEMO_DIRECTORY) || !listings.has(`${DEMO_DIRECTORY}/src`) || seedIfEmpty) listings = await loadListings();
      }
      const isInitial = treeRef.current.length === 0;
      const nextTree = sortTree(mergeWorkspaceTree(treeRef.current, listings));
      treeRef.current = nextTree;
      setTree(nextTree);
      if (isInitial) setFolders(initialOpen(nextTree));
      const paths = workspaceFiles(nextTree);
      // A file renamed or removed in the terminal keeps its unsaved buffer; the next save recreates it.
      const keepDirtyBuffer = dirty.current && activePath.current !== "";
      const selected = keepDirtyBuffer || paths.includes(activePath.current) ? activePath.current : paths.includes(DEMO_ENTRY_FILE) ? DEMO_ENTRY_FILE : (paths[0] ?? "");
      // The first refresh also reads the open file, so the bundled copy shown at first paint is replaced by the sandbox's.
      if (selected && (selected !== activePath.current || !openConfirmed.current)) {
        const request = ++openRequest.current;
        const result = await getWorkspaceFile(selected);
        // Skip the switch if the learner typed while the file loaded: replacing the buffer would drop those edits.
        if (request === openRequest.current && !dirty.current) {
          activePath.current = selected;
          activeContent.current = result.content;
          dirty.current = false;
          openConfirmed.current = true;
          setOpen(selected);
          setContent(result.content);
          void syncWebPreviewFile(selected, result.content).catch(() => {});
        }
      }
      const unsavedGone = dirty.current && activePath.current !== "" && !paths.includes(activePath.current);
      const unsavedNote = unsavedGone ? `${activePath.current} was moved or removed. Your unsaved edits stay here and are saved to that path on the next save.` : undefined;
      // A successful refresh must not hide a "Could not save" error the learner has not seen yet.
      setShellNote((current) => (current?.startsWith("Could not save") ? current : unsavedNote));
    } catch (error) {
      setShellNote(error instanceof Error ? error.message : "Could not read the sandbox workspace");
    } finally {
      loadingWorkspace.current = false;
      finishLoad();
      if (showLoading) setWorkspaceLoading(false);
      if (queuedWorkspaceRefresh.current) {
        queuedWorkspaceRefresh.current = false;
        setTimeout(() => { void refreshWorkspace(false); }, 0);
      }
    }
  }, []);

  useEffect(() => {
    const marker = "\u001b]777;learnquest-refresh\u0007";
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const subscriptions = terminals.map(({ socket }) => {
      const decoder = new TextDecoder();
      let tail = "";
      return socket.onOutput((bytes) => {
        const output = tail + decoder.decode(bytes, { stream: true });
        if (output.includes(marker)) {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => { void refreshWorkspace(false); }, 40);
        }
        tail = output.slice(-marker.length);
      });
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [refreshWorkspace, terminals]);

  useEffect(() => {
    if (shellState.kind === "open" && shellState.ready) void refreshWorkspace(true);
  }, [refreshWorkspace, shellState]);

  useEffect(() => {
    // Pause while a file is opening, so the folder poll does not queue ahead of that read.
    // Every poll is a sandbox round trip per folder, so it runs every 30 s and only while the tab is visible.
    if (shellState.kind !== "open" || !shellState.ready || fileLoading) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshWorkspace(false);
    }, 30_000);
    return () => clearInterval(timer);
  }, [fileLoading, folders, refreshWorkspace, shellState]);

  // Save pending edits when the page unmounts, and warn before a reload can drop them.
  // Unmount and pagehide saves use keepalive, so an interrupted navigation does not drop the last edit.
  useEffect(() => () => { void flushSave({ keepalive: true }); }, [flushSave]);
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = ""; // Older browsers show the prompt only when returnValue is set.
    };
    const saveOnPageHide = () => { void flushSave({ keepalive: true }); };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    window.addEventListener("pagehide", saveOnPageHide);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      window.removeEventListener("pagehide", saveOnPageHide);
    };
  }, [flushSave]);

  const showFile = (path: string, text: string) => {
    activePath.current = path;
    activeContent.current = text;
    dirty.current = false;
    setOpen(path);
    setContent(text);
    void syncWebPreviewFile(path, text).catch(() => {});
    setFolders((f) => new Set([...f, ...ancestors(path)]));
  };

  const openFile = async (path: string) => {
    // Reopening the open file has nothing to load. Replacing the buffer here would drop edits typed while the fetch was pending.
    if (path === activePath.current) return;
    setShellNote(undefined);
    const cached = fileCache.current.get(path);
    // With no unsaved edits, a cached file shows at once. The sandbox copy is re-read behind it and only replaces the view if it changed.
    if (cached !== undefined && !dirty.current) {
      const request = ++openRequest.current;
      showFile(path, cached);
      try {
        const result = await getWorkspaceFile(path);
        fileCache.current.set(path, result.content);
        if (request === openRequest.current && !dirty.current && activePath.current === path && result.content !== activeContent.current) {
          showFile(path, result.content);
        }
      } catch {
        // Keep the cached text; the next open or refresh reads the sandbox again.
      }
      return;
    }
    setFileLoading(true);
    try {
      // A failed save keeps the current buffer open, so its unsaved edits are not replaced.
      if (!(await flushSave())) return;
      const request = ++openRequest.current;
      const result = await getWorkspaceFile(path);
      fileCache.current.set(path, result.content);
      if (request !== openRequest.current) return;
      // Save edits typed while the file loaded, so the new content does not replace them.
      while (dirty.current) {
        if (!(await flushSave()) || request !== openRequest.current) return;
      }
      showFile(path, result.content);
      openConfirmed.current = true;
    } catch (error) {
      setShellNote(error instanceof Error ? error.message : `Could not open ${path}`);
    } finally {
      setFileLoading(false);
    }
  };

  const toggleWorkspaceFolder = async (path: string) => {
    if (folders.has(path)) {
      setFolders((current) => toggleFolder(current, path));
      return;
    }
    if (!loadedFolders.current.has(path)) {
      try {
        const { entries } = await listFiles(path);
        const children = entries.filter((entry) => entry.type === "file" || entry.type === "dir")
          .sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          .map((entry) =>
          entry.type === "dir" ? { name: entry.name, children: [] } : { name: entry.name },
        );
        setTree((current) => {
          const replace = (nodes: TreeNode[], parent = ""): TreeNode[] => nodes.map((node) => {
            const currentPath = joinPath(parent, node.name);
            if (currentPath === path) return { ...node, children };
            return node.children ? { ...node, children: replace(node.children, currentPath) } : node;
          });
          const next = replace(current);
          treeRef.current = next;
          return next;
        });
        loadedFolders.current.add(path);
      } catch (error) {
        setShellNote(error instanceof Error ? error.message : `Could not list ${path}`);
        return;
      }
    }
    setFolders((current) => toggleFolder(current, path));
  };

  const changeContent = (next: string) => {
    activeContent.current = next;
    dirty.current = true;
    setContent(next);
    void syncWebPreviewFile(activePath.current, next).catch((error: unknown) => {
      setShellNote(error instanceof Error ? `Preview file sync failed: ${error.message}` : "Preview file sync failed");
    });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, 2500);
  };

  const check = () => setStatus({ text: "Check needs a real lesson", tone: "error" });

  const centerPreview = () => {
    const rect = previewWindowRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPreviewPosition({
      left: Math.max(8, (window.innerWidth - rect.width) / 2),
      top: Math.max(8, (window.innerHeight - rect.height) / 2),
    });
  };

  const movePreview = (event: ReactPointerEvent<HTMLElement>) => {
    const start = previewDragStart.current;
    const rect = previewWindowRef.current?.getBoundingClientRect();
    if (!start || !rect) return;
    setPreviewPosition({
      left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, start.left + event.clientX - start.pointerX)),
      top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, start.top + event.clientY - start.pointerY)),
    });
  };

  const sendPreviewCommand = (type: string, payload: Record<string, unknown> = {}) => {
    previewFrameRef.current?.contentWindow?.postMessage({ __learnquestPreviewCommand: true, type, ...payload }, browserPreview.url ? new URL(browserPreview.url).origin : "*");
  };

  const startPreview = useCallback(async () => {
    if (previewStarting.current) return;
    previewStarting.current = true;
    setBrowserPreview({ state: "starting" });
    setShellNote(undefined);
    try {
      await flushSave();
      // Preview the saved workspace. With no sandbox yet, fall back to the bundled demo.
      let sources: PreviewFile[] = [];
      try {
        const saved = await savedProjectFiles();
        sources = saved.files;
        for (const file of sources) fileCache.current.set(file.path, file.content);
        if (saved.binarySkipped) setShellNote("Preview skips binary files such as images and fonts.");
      } catch (error) {
        // Say so when the demo stands in for the saved project, so edits are not silently hidden.
        setShellNote(error instanceof Error ? `Previewing the bundled demo. The saved project could not be read: ${error.message}` : "Previewing the bundled demo. The saved project could not be read.");
      }
      if (!sources.length) sources = DEMO_PROJECT_FILES.map((file) => ({ path: file.path, content: file.content }));
      if (activePath.current && dirty.current) {
        const active = sources.find((file) => file.path === activePath.current);
        if (active) active.content = activeContent.current;
      }
      const { url } = await startWebPreview(sources);
      // Edits typed while the preview booted were skipped by changeContent, so push the current buffer now.
      if (activePath.current) {
        void syncWebPreviewFile(activePath.current, activeContent.current).catch((error: unknown) => {
          setShellNote(error instanceof Error ? `Preview file sync failed: ${error.message}` : "Preview file sync failed");
        });
      }
      setBrowserPreview({ state: "ready", url });
      setPreviewOpen(true);
    } catch (error) {
      setBrowserPreview({ state: "error", message: error instanceof Error ? error.message : "Could not start the browser preview" });
    } finally {
      previewStarting.current = false;
    }
  }, [flushSave]);

  useEffect(() => {
    if (previewAutoStarted.current) return;
    previewAutoStarted.current = true;
    void (async () => {
      // Only the workspace loads on open. The preview starts when the learner clicks Run or Preview, not by itself.
      await refreshWorkspace(true);
    })();
  }, [refreshWorkspace]);

  const run = async () => {
    panel.dispatch({ type: "open" });
    if (!shell) {
      setShellNote("Open a terminal first. Select + in the terminal panel.");
      return;
    }
    if (!open) return;
    const extension = open.slice(open.lastIndexOf(".") + 1).toLowerCase();
    const runLanguage = extension === "py" ? "python" : ["js", "mjs", "cjs"].includes(extension) ? "javascript" : null;
    if (!runLanguage) {
      setShellNote("Run supports JavaScript and Python files in this workspace.");
      return;
    }
    setShellNote(undefined);
    try {
      if (!(await flushSave())) return;
      if (open === DEMO_ENTRY_FILE) {
        await runShellCommand({
          command: `cd "$HOME/${DEMO_DIRECTORY}" && npm start`,
          panel: { open: () => panel.dispatch({ type: "open" }) },
          socket: shell,
        });
        return;
      }
      if (open.startsWith(`${DEMO_DIRECTORY}/`)) {
        // Run the saved file where it lives, so its relative imports resolve.
        await runShellCommand({
          command: `${runLanguage === "python" ? "python3" : "node"} "$HOME/${open}"`,
          panel: { open: () => panel.dispatch({ type: "open" }) },
          socket: shell,
        });
        return;
      }
      await runInShell({
        language: runLanguage,
        code: content,
        panel: { open: () => panel.dispatch({ type: "open" }) },
        socket: shell,
        putFile,
        refreshTree: () => {},
      });
    } catch (error) {
      setShellNote(error instanceof RunInShellError ? error.message : error instanceof Error ? error.message : String(error));
    }
  };

  const paletteFiles = workspaceFiles(tree).map((p) => {
    const at = p.lastIndexOf("/");
    return { id: p, title: p.slice(at + 1), sub: p.slice(0, at) };
  });
  const paletteDocs = DOCS.map((d) => ({ id: d.id, title: d.title, sub: d.src }));
  const paletteCommands = [
    { id: "run", title: "Run", run },
    { id: "check", title: "Check", run: check },
  ];

  const createWorkspaceFile = () => setDraftEntry("file");
  const createWorkspaceFolder = () => setDraftEntry("folder");

  // Runs when the name field is submitted: Enter creates, Escape or leaving the field cancels.
  const commitDraftEntry = async (kind: "file" | "folder", rawName: string) => {
    setDraftEntry(null);
    const name = rawName.trim().replace(/^\/+/, "");
    if (!name) return;
    const path = `${DEMO_DIRECTORY}/${name}`;
    if (path.split("/").some((part) => !part || part === "." || part === "..")) {
      toast.error(`Use a ${kind} name inside the project folder.`);
      return;
    }
    try {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index++) loadedFolders.current.add(parts.slice(0, index).join("/"));
      if (kind === "file") {
        // Create only: an existing file keeps its contents.
        if (await workspaceFileExists(path)) {
          toast.error(`${path} already exists. Open it from the file list instead.`);
          return;
        }
        await putWorkspaceFile(path, "");
        await refreshWorkspace(false);
        await openFile(path);
        toast.success(`Created ${path}`);
        return;
      }
      // Workspace writes create parent directories. A hidden marker keeps a newly created folder visible to the file listing.
      await putWorkspaceFile(`${path}/.learnquest-folder`, "");
      loadedFolders.current.add(path);
      setFolders((current) => new Set([...current, DEMO_DIRECTORY, path]));
      await refreshWorkspace(false);
      toast.success(`Created folder ${path}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not create the ${kind}`);
    }
  };

  const moveWorkspaceEntry = async (source: string, targetDir: string) => {
    if (source.slice(0, source.lastIndexOf("/")) === targetDir) return;
    try {
      if (!(await flushSave())) return;
      const destination = `${targetDir}/${source.split("/").at(-1)}`;
      await moveWorkspaceFile(source, targetDir);
      const wasOpen = activePath.current === source;
      // Read now, before the awaits below, so a file opened meanwhile cannot leak its content into this path.
      const movedContent = wasOpen ? activeContent.current : undefined;
      if (wasOpen) {
        activePath.current = destination;
        // openFile skips the reopen of the active path, so set the visible path here; Run and the title must follow the move.
        setOpen(destination);
      }
      const parent = targetDir;
      for (let index = 1; index <= parent.split("/").length; index++) loadedFolders.current.add(parent.split("/").slice(0, index).join("/"));
      await refreshWorkspace(false);
      if (activePath.current === destination) await openFile(destination);
      try {
        await removeWebPreviewFile(source);
        if (destination.startsWith(`${DEMO_DIRECTORY}/`)) {
          await syncWebPreviewFile(destination, movedContent ?? (await getWorkspaceFile(destination)).content);
        }
      } catch (error) {
        setShellNote(error instanceof Error ? `Preview file sync failed: ${error.message}` : "Preview file sync failed");
      }
    } catch (error) {
      setShellNote(error instanceof Error ? error.message : "Could not move file");
    }
  };

  const navigator = (
    <div className="min-w-0">
      {workspaceLoading && tree.length === 0 ? <p className="px-2 py-1 text-xs text-[var(--mu)]">Loading container files…</p> : tree.length === 0 ? <p className="px-2 py-1 text-xs text-[var(--mu)]">Open the terminal to load its files.</p> : (
        <>
        {draftEntry && (
          <input
            autoFocus
            aria-label={draftEntry === "file" ? "New file name" : "New folder name"}
            placeholder={draftEntry === "file" ? "New file, e.g. src/utils.js" : "New folder, e.g. src/components"}
            className="mx-1 mb-1 w-[calc(100%-0.5rem)] rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-[var(--tx)]"
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitDraftEntry(draftEntry, event.currentTarget.value);
              else if (event.key === "Escape") setDraftEntry(null);
            }}
            onBlur={() => setDraftEntry(null)}
          />
        )}
        <FileTreeView
          label="Workspace files"
          nodes={tree}
          open={folders}
          selected={open}
          onToggle={(p) => void toggleWorkspaceFolder(p)}
          onSelect={(p) => void openFile(p)}
          onMoveFile={(source, target) => void moveWorkspaceEntry(source, target)}
          rootActions={<span className="flex flex-none items-center gap-0.5 pr-2">
            <button type="button" className="wb-tb wb-n34" aria-label="New folder" title="New folder" onClick={() => void createWorkspaceFolder()}><FolderPlus size={14} aria-hidden="true" /></button>
            <button type="button" className="wb-tb wb-n34" aria-label="New file" title="New file" onClick={() => void createWorkspaceFile()}><FilePlus2 size={14} aria-hidden="true" /></button>
            <button type="button" className="wb-tb wb-n34" aria-label="Refresh files" title="Refresh files" onClick={() => void refreshWorkspace(false)}><RefreshCw size={14} aria-hidden="true" /></button>
          </span>}
        />
        </>
      )}
    </div>
  );

  const actions = (
    <>
      <button ref={runRef} type="button" className="wb-tb wb-primary" onClick={run} title="Run" disabled={!open || !["py", "js", "mjs", "cjs"].includes(open.slice(open.lastIndexOf(".") + 1).toLowerCase())}>
        <Play size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        Run
      </button>
      <button type="button" className="wb-tb wb-outline" onClick={check}>
        <Check size={15} strokeWidth={1.75} aria-hidden="true" />
        Check
      </button>
      {browserPreview.state === "error" && <button type="button" className="wb-tb wb-outline" onClick={() => void startPreview()}>
        <RefreshCw size={13} aria-hidden="true" />
        Retry preview
      </button>}
    </>
  );

  const docs = <DocsPanel selected={selectedDoc} onSelect={setSelectedDoc} />;

  const shellMessage = shellNote ?? (shellState.kind === "closed" ? shellState.message : shellState.kind === "connecting" ? "Connecting to the sandbox…" : undefined);
  const activeTerminalIndex = terminals.findIndex((terminal) => terminal.id === activeTerminalId);
  const secondaryTerminal = terminals[activeTerminalIndex === terminals.length - 1 ? activeTerminalIndex - 1 : activeTerminalIndex + 1];
  const visibleTerminalIds = splitTerminals && secondaryTerminal
    ? new Set([activeTerminalId, secondaryTerminal.id])
    : new Set([activeTerminalId]);
  const reorderTerminals = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setTerminals((current) => {
      const from = current.findIndex((terminal) => terminal.id === sourceId);
      const to = current.findIndex((terminal) => terminal.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const bottom = (
    <div className="flex h-full min-h-0 min-w-0 bg-[var(--code)] text-[var(--tx)]">
      <div className={`relative grid min-h-0 min-w-0 flex-1 ${splitTerminals && secondaryTerminal ? "grid-cols-2 gap-1" : "grid-cols-1"}`}>
        {shellMessage && <div role="status" aria-live="polite" className="absolute left-2 top-1 z-10 flex items-center gap-1.5 rounded-md bg-[var(--pane)]/90 px-2 py-1 font-sans text-xs text-[var(--mu)] shadow-sm">{shellState.kind === "connecting" && <LoaderCircle size={12} aria-hidden="true" className="motion-safe:animate-spin" />}{shellMessage}</div>}
        {terminals.map((terminal) => {
          const visible = visibleTerminalIds.has(terminal.id);
          const column = splitTerminals && secondaryTerminal ? (terminal.id === activeTerminalId ? 1 : terminal.id === secondaryTerminal.id ? 2 : 0) : 1;
          return <div key={terminal.id} className="relative min-h-0 min-w-0 p-1" style={visible ? { gridColumn: column, gridRow: 1 } : { position: "absolute", inset: 0, visibility: "hidden", pointerEvents: "none" }}>
            <TerminalView shell={terminal.socket} active={panel.state.open && visible} fitKey={`${terminals.length}-${splitTerminals}-${activeTerminalId}`} />
            {visible && <button type="button" className="wb-tb wb-n34 absolute right-2 top-2 z-10 h-7 w-7 rounded-full border border-[var(--line)] bg-[var(--pane)]/95 p-0 shadow-sm" aria-label={`Close ${terminal.label}`} title={`Close ${terminal.label}`} onClick={() => closeTerminal(terminal.id)}>
              <X size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>}
          </div>;
        })}
      </div>
      {terminals.length > 1 && <aside className="flex w-12 flex-none justify-center border-l-0 bg-transparent px-1 py-3" aria-label="Terminal sessions">
        <div className="wb-pill flex h-fit flex-col gap-1 rounded-full p-1 shadow-[0_1px_2px_rgba(20,30,70,.1)]" role="group" aria-label="Terminal sessions">
          {terminals.map((terminal, index) => <button
            key={terminal.id}
            type="button"
            draggable
            aria-label={`Terminal ${index + 1}`}
            aria-pressed={activeTerminalId === terminal.id}
            title={`${terminal.label} · drag to reorder`}
            onClick={() => activeTerminalId !== terminal.id && setActiveTerminalId(terminal.id)}
            onDragStart={(event) => { event.dataTransfer.setData("text/plain", terminal.id); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
            onDrop={(event) => { event.preventDefault(); reorderTerminals(event.dataTransfer.getData("text/plain"), terminal.id); }}
            className={`flex h-8 min-w-8 cursor-grab items-center justify-center rounded-full px-2 font-mono text-[10px] font-semibold transition-colors active:cursor-grabbing ${activeTerminalId === terminal.id ? "bg-[var(--ac)] text-white shadow-sm" : "text-[var(--mu)] hover:bg-[var(--hover)] hover:text-[var(--tx)]"}`}
          >T{index + 1}</button>)}
        </div>
      </aside>}
      {terminals.length === 0 && <div className="absolute inset-0 grid place-items-center text-sm text-[var(--mu)]">No terminal open. Select + to start one.</div>}
    </div>
  );
  const terminalControls = {
    items: terminals.map(({ id, label }) => ({ id, label })),
    activeId: activeTerminalId,
    onSelect: setActiveTerminalId,
    onNew: addTerminal,
    split: splitTerminals,
    onToggleSplit: () => {
      if (splitTerminals) {
        setSplitTerminals(false);
        return;
      }
      if (terminals.length === 0) addTerminal();
      if (terminals.length < 2) addTerminal();
      setSplitTerminals(true);
    },
  };

  const openLang = languageOf(open, "javascript");

  return (
    <>
    <Workbench
      title="Task tracker project (test page)"
      fileName={open}
      crumbs={open.split("/").slice(0, -1)}
      symbol={undefined}
      language={openLang === "python" ? "python" : openLang === "typescript" ? "typescript" : "javascript"}
      navigator={navigator}
      editor={open ? <WorkbenchEditor
        key={open}
        transportRef={runRef}
        edit={{ value: content, language: openLang, onChange: changeContent }}
      /> : <div role={workspaceLoading || shellState.kind === "connecting" ? "status" : undefined} aria-live={workspaceLoading || shellState.kind === "connecting" ? "polite" : undefined} className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-[var(--mu)]">
        {workspaceLoading || shellState.kind === "connecting" ? <><LoaderCircle size={15} aria-hidden="true" className="motion-safe:animate-spin" />{workspaceLoading ? "Loading workspace files…" : "Connecting to the sandbox…"}</> : "Open the terminal to load container files."}
      </div>}
      bottom={bottom}
      bottomTitle="Terminal"
      terminalSessions={terminalControls}
      docs={docs}
      actions={actions}
      paletteFiles={paletteFiles}
      paletteCommands={paletteCommands}
      paletteDocs={paletteDocs}
      onOpenFile={openFile}
      onOpenDoc={setSelectedDoc}
      status={workspaceStatus}
      gitBranch={__LEARNQUEST_GIT_BRANCH__}
      languageLabel={LANGUAGE_LABELS[openLang]}
      noCursor={!open}
      panel={panel}
      showPlanned
      aiContext={{ fileName: open.slice(open.lastIndexOf("/") + 1), filePath: open, projectRoot: DEMO_DIRECTORY, code: content, language: openLang }}
    />
    {previewHost && browserPreview.url && createPortal(
      <section
        ref={previewWindowRef}
        className={`wb-preview-float${previewMinimized ? " wb-preview-minimized" : ""}${previewMaximized ? " wb-preview-maximized" : ""}`}
        aria-label="Floating browser preview window"
        inert={!previewOpen}
        hidden={!previewOpen}
        style={previewPosition && !previewMaximized ? { left: previewPosition.left, top: previewPosition.top, right: "auto", bottom: "auto" } : undefined}
      >
        <header
          className="wb-preview-float-head"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button, select, input")) return;
            const rect = previewWindowRef.current?.getBoundingClientRect();
            if (!rect) return;
            previewDragStart.current = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={movePreview}
          onPointerUp={(event) => {
            previewDragStart.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { previewDragStart.current = null; }}
        >
          <span className="wb-preview-mac-dots" role="group" aria-label="Preview window controls">
            <button type="button" className="wb-preview-dot wb-preview-dot-close" aria-label="Close preview window" title="Close" onClick={() => { setPreviewOpen(false); setPreviewMinimized(false); setPreviewMaximized(false); }} />
            <button type="button" className="wb-preview-dot wb-preview-dot-minimize" aria-label={previewMinimized ? "Restore preview window" : "Minimize preview window"} title={previewMinimized ? "Restore" : "Minimize"} onClick={() => setPreviewMinimized((value) => !value)} />
            <button type="button" className="wb-preview-dot wb-preview-dot-maximize" aria-label={previewMaximized ? "Restore preview window size" : "Maximize preview window"} title={previewMaximized ? "Restore size" : "Maximize"} onClick={() => { setPreviewMaximized((value) => !value); setPreviewMinimized(false); }}>
              {previewMaximized ? <Minimize2 size={7} aria-hidden="true" /> : null}
            </button>
          </span>
          <span className="wb-preview-float-title"><MonitorPlay size={14} aria-hidden="true" /> Tiny Task Tracker</span>
          <span className="wb-preview-float-actions">
            <label className="wb-preview-device" title="Preview viewport size">
              {previewDevice === "mobile" ? <Smartphone size={13} aria-hidden="true" /> : previewDevice === "tablet" ? <Tablet size={13} aria-hidden="true" /> : <Monitor size={13} aria-hidden="true" />}
              <select aria-label="Preview device size" value={previewDevice} onChange={(event) => setPreviewDevice(event.target.value as PreviewDevice)}>
                <option value="responsive">Responsive</option><option value="mobile">Mobile · 375px</option><option value="tablet">Tablet · 768px</option>
              </select>
            </label>
            <button type="button" className="wb-tb wb-n34" aria-label="Toggle devtools" title="Toggle devtools" aria-pressed={devtoolsOpen} onClick={() => setDevtoolsOpen((value) => !value)}><span className="wb-preview-devtools-mark">›_</span></button>
            <button type="button" className="wb-tb wb-n34" aria-label="Refresh browser preview" title="Refresh preview" onClick={() => setPreviewRefresh((value) => value + 1)}><RefreshCw size={13} aria-hidden="true" /></button>
            <button type="button" className="wb-tb wb-n34" aria-label="Move preview to center" title="Move to center" onClick={centerPreview}><Maximize2 size={13} aria-hidden="true" /></button>
            <button type="button" className="wb-tb wb-n34" aria-label="Open preview in new tab" title="Open in new tab" onClick={() => window.open(browserPreview.url, "_blank", "noopener,noreferrer")}><ExternalLink size={13} aria-hidden="true" /></button>
          </span>
        </header>
        <div className="wb-preview-address"><span className="wb-preview-secure-dot" />{browserPreview.url}</div>
        <div className={`wb-preview-viewport wb-preview-viewport-${previewDevice}`}>
          <iframe
            ref={previewFrameRef}
            key={`${browserPreview.url}-${previewRefresh}`}
            title="Tiny Task Tracker interactive website"
            src={browserPreview.url}
            allow="cross-origin-isolated"
            className="wb-preview-float-frame"
            style={previewDevice === "mobile" ? { width: 375 } : previewDevice === "tablet" ? { width: 768 } : undefined}
          />
        </div>
        {devtoolsOpen && <section className="wb-preview-devtools" aria-label="Preview developer tools">
          <div className="wb-preview-devtools-tabs" role="tablist" aria-label="Developer tools">
            <button role="tab" aria-selected={devtoolsTab === "console"} onClick={() => setDevtoolsTab("console")}>Console</button>
            <button role="tab" aria-selected={devtoolsTab === "elements"} onClick={() => { setDevtoolsTab("elements"); sendPreviewCommand("inspect", { enabled: true }); }}>Elements</button>
            <button className="wb-preview-inspect-toggle" aria-pressed={inspecting} onClick={() => sendPreviewCommand("inspect", { enabled: !inspecting })}>Select element</button>
            <button className="wb-preview-clear" onClick={() => setPreviewLogs([])}>Clear</button>
          </div>
          {devtoolsTab === "console" ? <div className="wb-preview-console" role="log" aria-live="polite">
            {previewLogs.length ? previewLogs.map((log, index) => <div className={`wb-preview-log wb-preview-log-${log.level}`} key={`${log.time}-${index}`}><time>{log.time}</time><code>{log.args.join(" ")}</code></div>) : <div className="wb-preview-empty">Console is ready. Browser errors and console messages will appear here.</div>}
          </div> : <div className="wb-preview-elements">
            {inspectedElement ? <><code>&lt;{inspectedElement.tag}{inspectedElement.id ? ` id="${inspectedElement.id}"` : ""}{inspectedElement.classes ? ` class="${inspectedElement.classes}"` : ""}&gt;</code><span>{inspectedElement.size}</span>{inspectedElement.text && <p>{inspectedElement.text}</p>}</> : <span>Choose “Select element”, then click something in the page.</span>}
          </div>}
        </section>}
      </section>,
      previewHost,
    )}
    {previewHost && browserPreview.url && !previewOpen && createPortal(
      <button type="button" className="wb-preview-reopen" onClick={() => setPreviewOpen(true)}>
        <MonitorPlay size={14} aria-hidden="true" /> Preview
      </button>,
      previewHost,
    )}
    <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
