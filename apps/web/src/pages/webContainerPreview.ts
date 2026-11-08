import { WebContainer, type FileSystemTree } from "@webcontainer/api";
import { DEMO_DIRECTORY } from "./testEditorDemo";

export type PreviewFile = { path: string; content: string };

type RuntimeWindow = typeof globalThis & {
  __learnquestWebContainer?: Promise<WebContainer>;
  __learnquestPreviewMounted?: boolean;
  __learnquestPreviewInstall?: Promise<void>;
  __learnquestPreviewServer?: Promise<string>;
};

const runtimeWindow = globalThis as RuntimeWindow;

// Forward console output and DOM inspection requests from the isolated preview
// back to the editor's devtools panel. The bridge stays inside the preview.
const PREVIEW_BRIDGE = `<script>
(() => {
  const send = (payload) => parent.postMessage({ __learnquestPreview: true, ...payload }, '*');
  const format = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') {
      try { return Function.prototype.toString.call(value); } catch { return '[Function ' + (value.name || 'anonymous') + ']'; }
    }
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { send({ type: 'console', level, args: args.map(format) }); original(...args); };
  }
  addEventListener('error', (event) => send({ type: 'console', level: 'error', args: [event.message + ' (' + event.filename + ':' + event.lineno + ')'] }));
  addEventListener('unhandledrejection', (event) => send({ type: 'console', level: 'error', args: ['Unhandled promise rejection: ' + format(event.reason)] }));
  addEventListener('message', (event) => {
    if (!event.data || event.data.__learnquestPreviewCommand !== true) return;
    if (event.data.type === 'inspect') {
      document.documentElement.classList.toggle('__learnquest-inspecting', Boolean(event.data.enabled));
      send({ type: 'inspect-state', enabled: Boolean(event.data.enabled) });
    }
  });
  addEventListener('click', (event) => {
    if (!document.documentElement.classList.contains('__learnquest-inspecting')) return;
    event.preventDefault(); event.stopPropagation();
    const node = event.target;
    if (!(node instanceof Element)) return;
    node.style.outline = '2px solid #3565e8';
    setTimeout(() => { node.style.outline = ''; }, 900);
    send({ type: 'element', tag: node.tagName.toLowerCase(), id: node.id, classes: typeof node.className === 'string' ? node.className : '', text: (node.textContent || '').trim().slice(0, 180), size: Math.round(node.getBoundingClientRect().width) + ' × ' + Math.round(node.getBoundingClientRect().height) });
  }, true);
})();
</script>`;

function withPreviewBridge(content: string): string {
  if (!/<html\b/i.test(content) || content.includes("__learnquestPreview: true")) return content;
  return content.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_BRIDGE}`);
}

/** Path inside the container, relative to the demo project folder. */
function relativePreviewPath(path: string): string {
  const relative = path.startsWith(`${DEMO_DIRECTORY}/`) ? path.slice(DEMO_DIRECTORY.length + 1) : path;
  return relative.split("/").filter(Boolean).join("/");
}

function previewContent(relative: string, content: string): string {
  return relative.toLowerCase().endsWith(".html") ? withPreviewBridge(content) : content;
}

function toFileTree(files: PreviewFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const file of files) {
    const relative = relativePreviewPath(file.path);
    const parts = relative.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const existing = directory[part];
      if (!existing || !("directory" in existing)) directory[part] = { directory: {} };
      directory = (directory[part] as { directory: FileSystemTree }).directory;
    }
    const name = parts.at(-1);
    if (name) directory[name] = { file: { contents: previewContent(relative, file.content) } };
  }
  return root;
}

/** Every file under the project folder, skipping node_modules (installed packages are not part of the snapshot). */
async function listPreviewFiles(container: WebContainer, directory = "."): Promise<string[]> {
  const entries = await container.fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listPreviewFiles(container, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function readPreviewFile(container: WebContainer, relative: string): Promise<string | undefined> {
  try {
    return await container.fs.readFile(relative, "utf-8");
  } catch {
    return undefined;
  }
}

/** A project-relative path may be touched only if it stays inside the project and outside node_modules. */
function isProjectPath(relative: string): boolean {
  return relative.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part !== "node_modules");
}

async function entryKind(container: WebContainer, relative: string): Promise<"file" | "directory" | undefined> {
  const slash = relative.lastIndexOf("/");
  const parent = slash > 0 ? relative.slice(0, slash) : ".";
  let entries;
  try {
    entries = await container.fs.readdir(parent, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const entry = entries.find((candidate) => candidate.name === relative.slice(slash + 1));
  if (!entry) return undefined;
  if (entry.isDirectory()) return "directory";
  return entry.isFile() ? "file" : undefined;
}

/**
 * Remove the one entry that blocks writing `relative`: a regular file where a parent folder is needed, or a
 * folder where the file goes. Returns false when nothing safe to remove was found.
 */
async function clearConflict(
  container: WebContainer,
  relative: string,
  snapshot: ReadonlyMap<string, string>,
): Promise<boolean> {
  const parts = relative.split("/");
  for (let index = 1; index < parts.length; index++) {
    const ancestor = parts.slice(0, index).join("/");
    if (!isProjectPath(ancestor)) return false;
    if ((await entryKind(container, ancestor)) === "file") {
      if (snapshot.has(ancestor)) return false;
      await container.fs.rm(ancestor, { force: true });
      return true;
    }
  }

  if (!isProjectPath(relative) || (await entryKind(container, relative)) !== "directory") return false;
  // Removing this folder must not take any snapshot file with it.
  const prefix = `${relative}/`;
  for (const key of snapshot.keys()) if (key.startsWith(prefix)) return false;
  await container.fs.rm(relative, { recursive: true, force: true });
  return true;
}

/** Write one project file and its folders. If a conflicting entry blocks it, remove that entry and retry once. */
async function writeProjectFile(
  container: WebContainer,
  relative: string,
  content: string,
  snapshot: ReadonlyMap<string, string>,
): Promise<void> {
  const write = async () => {
    // writeFile does not create parent folders, so a new file in a new folder needs its folder first.
    const slash = relative.lastIndexOf("/");
    if (slash > 0) await container.fs.mkdir(relative.slice(0, slash), { recursive: true });
    await container.fs.writeFile(relative, content);
  };
  try {
    await write();
  } catch (error) {
    if (!(await clearConflict(container, relative, snapshot))) throw error;
    await write();
  }
}

/**
 * Make the running workspace match the snapshot: write files that differ, then remove files the snapshot
 * no longer has. Returns true when package.json changed, so the caller can install again.
 */
async function syncPreviewWorkspace(container: WebContainer, files: PreviewFile[]): Promise<boolean> {
  const snapshot = new Map<string, string>();
  for (const file of files) {
    const relative = relativePreviewPath(file.path);
    if (relative) snapshot.set(relative, previewContent(relative, file.content));
  }

  let packageChanged = false;
  for (const [relative, content] of snapshot) {
    if ((await readPreviewFile(container, relative)) === content) continue;
    if (relative === "package.json") packageChanged = true;
    await writeProjectFile(container, relative, content, snapshot);
  }

  for (const relative of await listPreviewFiles(container)) {
    // npm writes the lock file during install, so it is never part of the snapshot and must not be removed.
    if (!snapshot.has(relative) && relative !== "package-lock.json") await container.fs.rm(relative, { force: true });
  }
  return packageChanged;
}

function boot() {
  if (!runtimeWindow.__learnquestWebContainer) {
    const pending = WebContainer.boot({
      workdirName: DEMO_DIRECTORY,
      coep: "require-corp",
    });
    runtimeWindow.__learnquestWebContainer = pending;
    // Drop a failed boot so the next Preview retries. The catch is handled, so callers still see the rejection.
    pending.catch(() => {
      if (runtimeWindow.__learnquestWebContainer === pending) {
        runtimeWindow.__learnquestWebContainer = undefined;
      }
    });
  }
  return runtimeWindow.__learnquestWebContainer;
}

/** Mount the editor workspace, install its packages once, and return the dev-server URL. */
export async function startWebPreview(files: PreviewFile[]): Promise<{ container: WebContainer; url: string }> {
  const container = await boot();
  if (!runtimeWindow.__learnquestPreviewMounted) {
    await container.mount(toFileTree(files));
    runtimeWindow.__learnquestPreviewMounted = true;
  } else if (await syncPreviewWorkspace(container, files)) {
    // A changed package.json needs its own install; the cached install promise only covers the previous one.
    runtimeWindow.__learnquestPreviewInstall = undefined;
  }

  runtimeWindow.__learnquestPreviewInstall ??= (async () => {
    const install = await container.spawn("npm", ["install"], { output: false });
    const exitCode = await install.exit;
    if (exitCode !== 0) {
      // Remount on the next attempt, so a retry does not keep a demo mounted before the saved project was read.
      runtimeWindow.__learnquestPreviewMounted = false;
      runtimeWindow.__learnquestPreviewInstall = undefined;
      throw new Error(`Dependency installation exited with code ${exitCode}`);
    }
  })();
  await runtimeWindow.__learnquestPreviewInstall;

  runtimeWindow.__learnquestPreviewServer ??= new Promise<string>((resolve, reject) => {
    let removeReady = () => {};
    removeReady = container.on("server-ready", (_port, url) => {
      removeReady();
      resolve(url);
    });
    void container.spawn("npm", ["run", "dev"], { output: false }).then((process) => {
      void process.exit.then((code) => {
        removeReady();
        runtimeWindow.__learnquestPreviewServer = undefined;
        reject(new Error(`The web dev server exited with code ${code}`));
      });
    }).catch((error: unknown) => {
      removeReady();
      runtimeWindow.__learnquestPreviewServer = undefined;
      reject(error);
    });
  });

  return { container, url: await runtimeWindow.__learnquestPreviewServer };
}

export async function syncWebPreviewFile(path: string, content: string): Promise<void> {
  const containerPromise = runtimeWindow.__learnquestWebContainer;
  if (!containerPromise || !runtimeWindow.__learnquestPreviewMounted || !path.startsWith(`${DEMO_DIRECTORY}/`)) return;
  const relative = path.slice(DEMO_DIRECTORY.length + 1);
  const container = await containerPromise;
  await writeProjectFile(
    container,
    relative,
    relative.toLowerCase().endsWith(".html") ? withPreviewBridge(content) : content,
    new Map([[relative, content]]),
  );
  if (relative === "package.json") {
    // The cached install covers the previous manifest. Clear it so the next Preview runs npm install again.
    runtimeWindow.__learnquestPreviewInstall = undefined;
  }
}

export async function removeWebPreviewFile(path: string): Promise<void> {
  const containerPromise = runtimeWindow.__learnquestWebContainer;
  if (!containerPromise || !runtimeWindow.__learnquestPreviewMounted || !path.startsWith(`${DEMO_DIRECTORY}/`)) return;
  const relative = path.slice(DEMO_DIRECTORY.length + 1);
  await (await containerPromise).fs.rm(relative, { force: true });
}
