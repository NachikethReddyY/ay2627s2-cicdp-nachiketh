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

function toFileTree(files: PreviewFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const file of files) {
    const relative = file.path.startsWith(`${DEMO_DIRECTORY}/`)
      ? file.path.slice(DEMO_DIRECTORY.length + 1)
      : file.path;
    const parts = relative.split("/").filter(Boolean);
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const existing = directory[part];
      if (!existing || !("directory" in existing)) directory[part] = { directory: {} };
      directory = (directory[part] as { directory: FileSystemTree }).directory;
    }
    const name = parts.at(-1);
    if (name) directory[name] = { file: { contents: name.toLowerCase().endsWith(".html") ? withPreviewBridge(file.content) : file.content } };
  }
  return root;
}

function boot() {
  runtimeWindow.__learnquestWebContainer ??= WebContainer.boot({
    workdirName: DEMO_DIRECTORY,
    coep: "require-corp",
  });
  return runtimeWindow.__learnquestWebContainer;
}

/** Mount the editor workspace, install its packages once, and return the dev-server URL. */
export async function startWebPreview(files: PreviewFile[]): Promise<{ container: WebContainer; url: string }> {
  const container = await boot();
  if (!runtimeWindow.__learnquestPreviewMounted) {
    await container.mount(toFileTree(files));
    runtimeWindow.__learnquestPreviewMounted = true;
  }

  runtimeWindow.__learnquestPreviewInstall ??= (async () => {
    const install = await container.spawn("npm", ["install"], { output: false });
    const exitCode = await install.exit;
    if (exitCode !== 0) {
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
  await (await containerPromise).fs.writeFile(relative, relative.toLowerCase().endsWith(".html") ? withPreviewBridge(content) : content);
}
