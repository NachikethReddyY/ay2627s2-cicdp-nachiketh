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

// Forward console output, DOM, styles, network and sources from the isolated preview back to the editor's
// devtools panel. The bridge stays inside the preview. Message shapes: see previewDevtoolsProtocol.ts.
// This is a raw <script> in the preview page: plain JavaScript only, no backticks, no template placeholders,
// no backslashes (the whole thing sits inside a template literal).
export const PREVIEW_BRIDGE = `<script>
(() => {
  const send = (payload) => {
    try { parent.postMessage({ __learnquestPreview: true, ...payload }, '*'); } catch (e) { /* the preview must keep working */ }
  };
  const format = (value) => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') {
      try { return Function.prototype.toString.call(value); } catch (e) { return '[Function ' + (value.name || 'anonymous') + ']'; }
    }
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { send({ type: 'console', level, args: args.map(format) }); original(...args); };
  }
  addEventListener('error', (event) => send({ type: 'console', level: 'error', args: [event.message + ' (' + event.filename + ':' + event.lineno + ')'] }));
  addEventListener('unhandledrejection', (event) => send({ type: 'console', level: 'error', args: ['Unhandled promise rejection: ' + format(event.reason)] }));

  // Node ids: one per node, assigned the first time it is sent, never reused.
  let nextNodeId = 1;
  const nodesById = new Map();
  const idsByNode = new WeakMap();
  // Hold nodes weakly where WeakRef exists, so detached DOM can be collected. Otherwise hold them strongly.
  let weak = false;
  try { weak = typeof WeakRef === 'function'; } catch (e) { weak = false; }
  const remember = (id, node) => {
    try { nodesById.set(id, weak ? new WeakRef(node) : node); } catch (e) { nodesById.set(id, node); }
  };
  const recall = (id) => {
    const held = nodesById.get(id);
    if (held === undefined) return undefined;
    if (!weak) return held;
    let node;
    try { node = held.deref(); } catch (e) { node = undefined; }
    if (node === undefined) nodesById.delete(id);
    return node;
  };
  const idFor = (node) => {
    let id = idsByNode.get(node);
    if (id === undefined) { id = nextNodeId++; idsByNode.set(node, id); remember(id, node); }
    return id;
  };
  const elementFor = (id) => {
    const node = recall(id);
    return node && node.nodeType === 1 && node.isConnected ? node : null;
  };

  // Highlight overlay: one fixed div, so the page's own style attributes stay untouched.
  let overlay = null;
  const highlight = (element) => {
    try {
      if (!element) { if (overlay) overlay.style.display = 'none'; return; }
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;outline:2px solid #3565e8;background:rgba(53,101,232,0.12);display:none';
        document.documentElement.appendChild(overlay);
      }
      const rect = element.getBoundingClientRect();
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      overlay.style.display = 'block';
    } catch (e) { /* ignore */ }
  };

  // DOM tree.
  const MAX_NODES = 3000;
  const MAX_DEPTH = 60;
  const sendDom = () => {
    let count = 0;
    let truncated = false;
    const walk = (element, depth) => {
      count++;
      const attrs = {};
      for (const attr of Array.from(element.attributes)) attrs[attr.name] = attr.value;
      const tag = element.tagName.toLowerCase();
      const node = { id: idFor(element), tag, attrs, children: [] };
      if (tag === 'script' || tag === 'style') return node;
      if (depth >= MAX_DEPTH) { if (element.childNodes.length > 0) truncated = true; return node; }
      for (const child of Array.from(element.childNodes)) {
        if (child === overlay) continue;
        if (child.nodeType !== 1 && child.nodeType !== 3) continue;
        if (count >= MAX_NODES) { truncated = true; break; }
        if (child.nodeType === 1) {
          node.children.push(walk(child, depth + 1));
        } else {
          const text = (child.nodeValue || '').trim();
          if (!text) continue;
          count++;
          node.children.push({ id: idFor(child), tag: '#text', attrs: {}, text, children: [] });
        }
      }
      return node;
    };
    send({ type: 'dom', root: walk(document.documentElement, 0), truncated });
  };

  // Styles.
  const declarations = (style) => {
    const list = [];
    for (let i = 0; i < style.length; i++) {
      const property = style.item(i);
      list.push({ property, value: style.getPropertyValue(property), important: style.getPropertyPriority(property) === 'important' });
    }
    return list;
  };
  const sheetSource = (sheet) => {
    try {
      const owner = sheet.ownerNode;
      if (owner && owner.tagName) {
        const tag = owner.tagName.toLowerCase();
        return sheet.href ? tag + ' ' + sheet.href : tag === 'style' ? 'inline <style>' : tag;
      }
      return sheet.href || '';
    } catch (e) { return ''; }
  };
  const collectRules = (rules, element, source, out) => {
    let list;
    try { list = Array.from(rules); } catch (e) { return; }
    for (const rule of list) {
      try {
        if (typeof rule.selectorText === 'string') {
          if (element.matches(rule.selectorText)) out.push({ selector: rule.selectorText, source, declarations: declarations(rule.style) });
        } else if (rule.cssRules) {
          if (rule.media && !matchMedia(rule.media.mediaText).matches) continue;
          collectRules(rule.cssRules, element, source, out);
        }
      } catch (e) { /* unreadable or unsupported selector */ }
    }
  };
  const sendStyles = (nodeId) => {
    const element = elementFor(nodeId);
    if (!element) return;
    const rules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try { collectRules(sheet.cssRules, element, sheetSource(sheet), rules); } catch (e) { /* cross-origin sheet */ }
    }
    const computed = {};
    const computedStyle = getComputedStyle(element);
    for (let i = 0; i < computedStyle.length; i++) {
      const name = computedStyle.item(i);
      computed[name] = computedStyle.getPropertyValue(name);
    }
    send({ type: 'styles', styles: { nodeId, inline: declarations(element.style), rules, computed } });
  };

  // Sources.
  const SOURCE_LIMIT = 500000;
  const origFetch = window.fetch;
  const sendSources = () => {
    const entries = [];
    const seen = new Set();
    const add = (url, kind) => { if (url && !seen.has(kind + url)) { seen.add(kind + url); entries.push({ url, kind }); } };
    for (const script of Array.from(document.scripts)) if (script.src) add(script.src, 'script');
    for (const link of Array.from(document.querySelectorAll('link[rel~=stylesheet]'))) if (link.href) add(link.href, 'style');
    add(location.href, 'document');
    send({ type: 'sources', entries });
  };
  const sendSource = (url) => {
    // The original fetch is used on purpose, so reading a source is not logged as network traffic.
    Promise.resolve().then(() => origFetch.call(window, url)).then((response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      return response.text();
    }).then((text) => {
      if (text.length > SOURCE_LIMIT) text = text.slice(0, SOURCE_LIMIT) + String.fromCharCode(10) + '/* cut at ' + SOURCE_LIMIT + ' characters */';
      send({ type: 'source', url, text });
    }, (error) => {
      send({ type: 'source', url, error: error && error.message ? error.message : String(error) });
    });
  };

  // Network.
  let nextRequestId = 1;
  const absolute = (url) => { try { return new URL(String(url), location.href).href; } catch (e) { return String(url); } };
  const beginRequest = (method, url, kind) => {
    const entry = { id: nextRequestId++, method: String(method || 'GET').toUpperCase(), url: absolute(url), kind, startedAt: Date.now() };
    const t0 = performance.now();
    send({ type: 'network', entry: { ...entry } });
    return (result) => send({ type: 'network', entry: { ...entry, ...result, durationMs: Math.round(performance.now() - t0) } });
  };
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let finish = null;
      try {
        const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
        const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
        finish = beginRequest(method, url, 'fetch');
      } catch (e) { finish = null; }
      const pending = origFetch.apply(this, arguments);
      if (finish) {
        pending.then((response) => {
          try {
            const length = Number(response.headers.get('content-length'));
            finish({ status: response.status, statusText: response.statusText, size: length > 0 ? length : undefined });
          } catch (e) { /* ignore */ }
        }, (error) => {
          try { finish({ error: error && error.message ? error.message : String(error) }); } catch (e) { /* ignore */ }
        });
      }
      return pending;
    };
  }
  if (typeof XMLHttpRequest === 'function') {
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    proto.open = function (method, url) {
      try { this.__learnquestRequest = { method, url }; } catch (e) { /* ignore */ }
      return origOpen.apply(this, arguments);
    };
    proto.send = function () {
      try {
        const info = this.__learnquestRequest;
        if (info) {
          const finish = beginRequest(info.method, info.url, 'xhr');
          this.addEventListener('loadend', () => {
            try {
              if (this.status === 0) { finish({ error: 'Network error' }); return; }
              let size;
              const length = Number(this.getResponseHeader('content-length'));
              if (length > 0) size = length;
              else if (this.responseType === '' || this.responseType === 'text') size = (this.responseText || '').length;
              finish({ status: this.status, statusText: this.statusText, size });
            } catch (e) { /* ignore */ }
          });
        }
      } catch (e) { /* ignore */ }
      return origSend.apply(this, arguments);
    };
  }
  // Resources the page loads itself (scripts, styles, images) never pass through fetch or XHR.
  const kinds = { script: 'script', link: 'style', css: 'style', img: 'img', fetch: 'fetch', xmlhttprequest: 'xhr' };
  const reportResource = (item) => {
    try {
      // fetch and XHR are already reported, with a real start and finish, by the patches above.
      if (item.initiatorType === 'fetch' || item.initiatorType === 'xmlhttprequest') return;
      const entry = {
        id: nextRequestId++, method: 'GET', url: item.name, kind: kinds[item.initiatorType] || 'other',
        startedAt: Math.round(performance.timeOrigin + item.startTime), durationMs: Math.round(item.duration),
      };
      if (item.responseStatus > 0) entry.status = item.responseStatus;
      const size = item.transferSize || item.encodedBodySize;
      if (size > 0) entry.size = size;
      send({ type: 'network', entry });
    } catch (e) { /* ignore */ }
  };
  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) {
      const entry = { id: nextRequestId++, method: 'GET', url: location.href, kind: 'document', startedAt: Math.round(performance.timeOrigin + navigation.startTime), durationMs: Math.round(navigation.duration) };
      if (navigation.responseStatus > 0) entry.status = navigation.responseStatus;
      if (navigation.transferSize > 0) entry.size = navigation.transferSize;
      send({ type: 'network', entry });
    }
    performance.getEntriesByType('resource').forEach(reportResource);
    if (typeof PerformanceObserver === 'function') {
      new PerformanceObserver((list) => list.getEntries().forEach(reportResource)).observe({ entryTypes: ['resource'] });
    }
  } catch (e) { /* not supported */ }

  // Commands from the panel.
  addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__learnquestPreviewCommand !== true) return;
    try {
      switch (data.type) {
        case 'inspect':
          document.documentElement.classList.toggle('__learnquest-inspecting', Boolean(data.enabled));
          if (!data.enabled) {
            if (hoverFrame) { cancelAnimationFrame(hoverFrame); hoverFrame = 0; }
            hoverTarget = null;
            highlight(null);
          }
          send({ type: 'inspect-state', enabled: Boolean(data.enabled) });
          break;
        case 'dom-request': sendDom(); break;
        case 'styles-request': sendStyles(data.nodeId); break;
        case 'set-style': {
          const element = elementFor(data.nodeId);
          if (!element) break;
          if (data.value === '') element.style.removeProperty(data.property);
          else element.style.setProperty(data.property, data.value, data.important ? 'important' : '');
          sendStyles(data.nodeId);
          break;
        }
        case 'highlight': highlight(data.nodeId === null ? null : elementFor(data.nodeId)); break;
        case 'sources-request': sendSources(); break;
        case 'source-request': sendSource(String(data.url)); break;
      }
    } catch (e) { /* a bad command must not break the page */ }
  });
  // Live hover box while inspecting, one update per animation frame.
  let hoverFrame = 0;
  let hoverTarget = null;
  addEventListener('mousemove', (event) => {
    if (!document.documentElement.classList.contains('__learnquest-inspecting')) return;
    const target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    hoverTarget = target;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (hoverTarget && document.documentElement.classList.contains('__learnquest-inspecting')) highlight(hoverTarget);
    });
  }, true);
  addEventListener('click', (event) => {
    if (!document.documentElement.classList.contains('__learnquest-inspecting')) return;
    event.preventDefault(); event.stopPropagation();
    const node = event.target;
    if (!(node instanceof Element)) return;
    try {
      highlight(node);
      const rect = node.getBoundingClientRect();
      send({ type: 'element', nodeId: idFor(node), tag: node.tagName.toLowerCase(), id: node.id, classes: typeof node.className === 'string' ? node.className : '', text: (node.textContent || '').trim().slice(0, 180), size: Math.round(rect.width) + ' × ' + Math.round(rect.height) });
    } catch (e) { /* ignore */ }
  }, true);
  // The editor draws its own menu (Reload, Inspect, Developer tools) instead of the browser's frame menu.
  addEventListener('contextmenu', (event) => {
    event.preventDefault();
    send({ type: 'contextmenu', x: event.clientX, y: event.clientY });
  });
  addEventListener('pointerdown', () => send({ type: 'pointerdown' }));
  send({ type: 'ready' });
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
export async function startWebPreview(
  files: PreviewFile[],
  options: { onStage?(stage: string): void } = {},
): Promise<{ container: WebContainer; url: string }> {
  const container = await boot();
  if (!runtimeWindow.__learnquestPreviewMounted) {
    await container.mount(toFileTree(files));
    runtimeWindow.__learnquestPreviewMounted = true;
  } else if (await syncPreviewWorkspace(container, files)) {
    // A changed package.json needs its own install; the cached install promise only covers the previous one.
    runtimeWindow.__learnquestPreviewInstall = undefined;
  }

  if (!runtimeWindow.__learnquestPreviewInstall) {
    options.onStage?.("Installing packages…");
    runtimeWindow.__learnquestPreviewInstall = (async () => {
      const install = await container.spawn("npm", ["install"], { output: false });
      const exitCode = await install.exit;
      if (exitCode !== 0) {
        // Remount on the next attempt, so a retry does not keep a demo mounted before the saved project was read.
        runtimeWindow.__learnquestPreviewMounted = false;
        runtimeWindow.__learnquestPreviewInstall = undefined;
        throw new Error(`Dependency installation exited with code ${exitCode}`);
      }
    })();
  }
  await runtimeWindow.__learnquestPreviewInstall;

  if (!runtimeWindow.__learnquestPreviewServer) options.onStage?.("Starting the dev server…");
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
