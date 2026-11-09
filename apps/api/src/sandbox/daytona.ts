import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { LIST_MAX_ENTRIES, SandboxBusyError, SandboxFileTooLargeError, SandboxNotRunningError, type DirEntry, type RunHandle, type RunLimits, type SandboxBackend } from "./backend.ts";

// Narrow views of @daytonaio/sdk, so tests pass a fake and nothing here depends on SDK internals.
export interface DaytonaPty {
  sendInput(data: string | Uint8Array): Promise<void>;
  resize(cols: number, rows: number): Promise<unknown>;
  kill(): Promise<void>;
  disconnect(): Promise<void>;
  wait(): Promise<{ exitCode?: number }>;
  waitForConnection(): Promise<void>;
}
export interface DaytonaSandbox {
  id: string;
  state?: string;
  start(timeout?: number): Promise<void>;
  waitUntilStarted(timeout?: number): Promise<void>;
  waitUntilStopped(timeout?: number): Promise<void>;
  setAutostopInterval(minutes: number): Promise<void>;
  process: {
    createPty(o: { id: string; cwd?: string; envs?: Record<string, string>; cols: number; rows: number; onData: (d: Uint8Array) => void | Promise<void> }): Promise<DaytonaPty>;
    createSession(id: string): Promise<void>;
    executeSessionCommand(session: string, req: { command: string; runAsync?: boolean; suppressInputEcho?: boolean }): Promise<{ cmdId?: string }>;
    getSessionCommandLogs(session: string, cmd: string, onStdout: (c: string) => void, onStderr: (c: string) => void): Promise<void>;
    getSessionCommand(session: string, cmd: string): Promise<{ exitCode?: number }>;
    sendSessionCommandInput(session: string, cmd: string, data: string): Promise<void>;
    executeCommand(command: string, cwd?: string, env?: Record<string, string>, timeout?: number): Promise<{ exitCode?: number; result?: string }>;
  };
  getUserHomeDir(): Promise<string | undefined>;
  fs: {
    createFolder(path: string, mode: string): Promise<void>;
    uploadFile(file: Buffer, remotePath: string): Promise<void>;
    downloadFile?(remotePath: string): Promise<Buffer>;
    listFiles(path: string): Promise<Array<{ name: string; isDir: boolean; size: number; mode: string }>>;
    getFileDetails(path: string): Promise<{ isDir: boolean; mode?: string }>;
    /** Removes the path itself; like unlink, it does not follow a symlink. */
    deleteFile(path: string, recursive?: boolean): Promise<void>;
  };
}
export interface DaytonaClient {
  create(params: Record<string, unknown>, options?: { timeout?: number }): Promise<DaytonaSandbox>;
  list(query: { labels?: Record<string, string> }): AsyncIterableIterator<DaytonaSandbox>;
  delete(sandbox: DaytonaSandbox): Promise<void>;
}

export const APP_LABEL = { app: "learnquest" } as const;
const SHELL_ROLE = "shell";
const RUNNER_ROLE = "runner";
const DAYTONA_ZSH_RC = readFileSync(new URL("./learner-zshrc", import.meta.url));
const BROKEN = new Set(["error", "build_failed", "destroyed", "destroying"]);

/** The label value for a learner: a hash, so no learner id is stored at Daytona. Same hash Docker uses for container names. */
export const learnerHash = (learnerId: string) => createHash("sha256").update(learnerId).digest("hex");

// The program goes in a private directory made per run (see runInSandbox), never at a fixed name in /tmp.
const FILE: Record<"python" | "javascript" | "typescript", { name: string; cmd: (path: string) => string[] }> = {
  python: { name: "main.py", cmd: (p) => ["python3", "-I", "-u", p] },
  javascript: { name: "main.js", cmd: (p) => ["node", p] },
  typescript: { name: "main.ts", cmd: (p) => ["node", p] },
};

const shQuote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

export function daytonaBackend(opts: {
  client: DaytonaClient;
  snapshot?: string;
  autoStopMinutes?: number;
  maxShells?: () => number;
  /** Runner sandboxes outlive a run by at most this long if the API dies before deleting them. */
  runnerStopMinutes?: number;
}): SandboxBackend {
  const { client } = opts;
  const autoStop = opts.autoStopMinutes ?? 15;
  const maxShells = opts.maxShells ?? (() => env.SANDBOX_MAX_SHELLS);
  const base = opts.snapshot ? { snapshot: opts.snapshot } : {};
  const finding = new Map<string, Promise<DaytonaSandbox>>();
  let openTerminals = 0;

  // One label set for finding and creating shell sandboxes, so the two cannot drift.
  const shellLabels = (learnerId: string) => ({ ...APP_LABEL, role: SHELL_ROLE, learner: learnerHash(learnerId) });

  async function findOrCreate(learnerId: string): Promise<DaytonaSandbox> {
    const labels = shellLabels(learnerId);
    let sbx: DaytonaSandbox | undefined;
    for await (const s of client.list({ labels })) {
      sbx = s;
      break;
    }
    // A sandbox that failed to build or crashed can never start again: replace it rather than lock the learner out.
    if (sbx && BROKEN.has(sbx.state ?? "")) {
      await client.delete(sbx).catch(() => {});
      sbx = undefined;
    }
    sbx ??= await client.create({
      ...base,
      labels,
      // Daytona stops an idle sandbox itself, so this holds across restarts and several API instances.
      autoStopInterval: autoStop,
    });
    const st = sbx.state ?? "";
    if (st === "started") return sbx;
    // Another API instance may be mid-transition; wait for it instead of asking Daytona to start a sandbox it is already moving.
    if (st === "starting" || st === "creating" || st === "restoring") await sbx.waitUntilStarted();
    else {
      if (st === "stopping" || st === "archiving") await sbx.waitUntilStopped();
      await sbx.start();
    }
    return sbx;
  }

  /** The learner's running shell sandbox. Never creates or starts one: a missing or non-started sandbox is "no shell". */
  async function findShell(learnerId: string): Promise<DaytonaSandbox> {
    const it = client.list({ labels: shellLabels(learnerId) });
    try {
      const first = await it.next();
      if (first.done || first.value.state !== "started") throw new SandboxNotRunningError();
      return first.value;
    } finally {
      await it.return?.(); // only the first match matters; release the iterator
    }
  }

  // Home directory per sandbox id: it does not change for a sandbox's life.
  const homes = new Map<string, string>();
  async function homeOf(sbx: DaytonaSandbox): Promise<string> {
    let h = homes.get(sbx.id);
    if (!h) {
      h = (await sbx.getUserHomeDir()) ?? "/home/learner";
      homes.set(sbx.id, h);
    }
    return h;
  }

  function shellSandbox(learnerId: string) {
    const key = learnerHash(learnerId);
    let p = finding.get(key);
    if (!p) {
      p = findOrCreate(learnerId).finally(() => finding.delete(key));
      finding.set(key, p);
    }
    return p;
  }

  return {
    async readWorkspaceFile(learnerId, relPath) {
      const sbx = await findShell(learnerId);
      const parts = relPath.split("/");
      let path = await homeOf(sbx);
      let size: number | undefined;
      for (const [index, part] of parts.entries()) {
        path += `/${part}`;
        let info: { isDir: boolean; mode?: string; size?: number } | undefined;
        try {
          info = await sbx.fs.getFileDetails(path);
        } catch (err) {
          if ((err as { statusCode?: number } | null)?.statusCode === 404) return null;
          throw err;
        }
        if (info.mode?.startsWith("L") || (index < parts.length - 1 ? !info.isDir : info.isDir)) return null;
        size = info.size;
      }
      // Refuse from the reported size first, so a large learner file is never buffered in full. The SDK types size as
      // required; if it is missing, refuse rather than download unbounded (downloadFile has no range option).
      if (size === undefined || size > 64 * 1024) throw new SandboxFileTooLargeError();
      if (!sbx.fs.downloadFile) throw new Error("Workspace file reading is not supported by this Daytona SDK");
      const content = await sbx.fs.downloadFile(path);
      if (content.byteLength > 64 * 1024) throw new SandboxFileTooLargeError();
      return content.toString("utf8");
    },

    async writeWorkspaceFile(learnerId, relPath, content) {
      const sbx = await findShell(learnerId);
      const parts = relPath.split("/");
      const home = await homeOf(sbx);
      let parent = home;
      for (const part of parts.slice(0, -1)) {
        parent += `/${part}`;
        let info: { isDir: boolean; mode?: string };
        try {
          info = await sbx.fs.getFileDetails(parent);
        } catch (err) {
          if ((err as { statusCode?: number } | null)?.statusCode !== 404) throw err;
          await sbx.fs.createFolder(parent, "755");
          info = await sbx.fs.getFileDetails(parent);
        }
        if (!info.isDir || info.mode?.startsWith("L")) throw new Error("Workspace path is not a regular file path");
      }
      const path = `${parent}/${parts.at(-1)}`;
      const info = await sbx.fs.getFileDetails(path).catch((err) => {
        if ((err as { statusCode?: number } | null)?.statusCode === 404) return undefined;
        throw err;
      });
      if (info?.isDir) throw new Error("Workspace path is not a regular file path");
      if (info?.mode?.startsWith("L")) await sbx.fs.deleteFile(path);
      await sbx.fs.uploadFile(Buffer.from(content), path);
    },

    async moveWorkspaceFile(learnerId, source, targetDir) {
      const sbx = await findShell(learnerId);
      const parts = source.split("/");
      const home = await homeOf(sbx);
      let parent = home;
      for (const part of parts.slice(0, -1)) {
        parent += `/${part}`;
        const info = await sbx.fs.getFileDetails(parent);
        if (!info.isDir || info.mode?.startsWith("L")) throw new Error("Workspace file is unavailable");
      }
      const sourcePath = `${parent}/${parts.at(-1)}`;
      const sourceInfo = await sbx.fs.getFileDetails(sourcePath);
      if (sourceInfo.isDir || sourceInfo.mode?.startsWith("L")) throw new Error("Workspace file is unavailable");
      let destination = home;
      for (const part of targetDir.split("/")) {
        destination += `/${part}`;
        const info = await sbx.fs.getFileDetails(destination);
        if (!info.isDir || info.mode?.startsWith("L")) throw new Error("Destination folder is unavailable");
      }
      const destinationPath = `${destination}/${parts.at(-1)}`;
      try {
        await sbx.fs.getFileDetails(destinationPath);
        throw new Error("A file with that name already exists in the destination folder");
      } catch (error) {
        if ((error as { statusCode?: number } | null)?.statusCode !== 404) throw error;
      }
      // One rename inside the sandbox: mv -n never overwrites, and within one filesystem the rename is atomic, so a
      // terminal save either lands before the move (and moves with the file) or after it (a new file at the source).
      // The trailing test fails if mv skipped the move, so a destination that appeared meanwhile is reported, not lost.
      const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
      const res = await sbx.process.executeCommand(
        `mv -n -T -- ${q(sourcePath)} ${q(destinationPath)} && test ! -e ${q(sourcePath)}`,
        undefined,
        undefined,
        30,
      );
      if (res.exitCode !== 0) throw new Error("Could not move the file: a file with that name may already exist");
    },

    async openShell(learnerId, { cols, rows }) {
      if (openTerminals >= maxShells()) throw new SandboxBusyError();
      openTerminals++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        openTerminals--;
      };
      try {
        const sbx = await shellSandbox(learnerId);
        const home = await homeOf(sbx);
        const workspace = `${home}/task-tracker`;
        let workspaceInfo: { isDir: boolean; mode?: string } | undefined;
        try {
          workspaceInfo = await sbx.fs.getFileDetails(workspace);
        } catch (err) {
          if ((err as { statusCode?: number } | null)?.statusCode !== 404) throw err;
          await sbx.fs.createFolder(workspace, "755");
          workspaceInfo = await sbx.fs.getFileDetails(workspace);
        }
        if (!workspaceInfo.isDir || workspaceInfo.mode?.startsWith("L")) {
          throw new Error("Workspace path is not a regular directory");
        }
        const zshDir = `${home}/.learnquest-zsh`;
        let zshDirInfo: { isDir: boolean; mode?: string } | undefined;
        try {
          zshDirInfo = await sbx.fs.getFileDetails(zshDir);
        } catch (err) {
          if ((err as { statusCode?: number } | null)?.statusCode !== 404) throw err;
          await sbx.fs.createFolder(zshDir, "755");
          zshDirInfo = await sbx.fs.getFileDetails(zshDir);
        }
        if (!zshDirInfo.isDir || zshDirInfo.mode?.startsWith("L")) {
          throw new Error("Terminal config path is not a regular directory");
        }
        await sbx.fs.uploadFile(DAYTONA_ZSH_RC, `${zshDir}/.zshrc`);
        const dataCbs: Array<(d: Uint8Array) => void> = [];
        const early: Uint8Array[] = []; // output that arrives before the route attaches its listener
        const pty = await sbx.process.createPty({
          id: `lq-${randomUUID()}`,
          cwd: workspace,
          envs: { TERM: "xterm-256color", ZDOTDIR: zshDir },
          cols,
          rows,
          onData: (d) => {
            if (dataCbs.length === 0) early.push(d);
            else for (const cb of dataCbs) cb(d);
          },
        });
        await pty.waitForConnection();
        const exitCbs: Array<(code: number) => void> = [];
        let exited: number | undefined;
        void pty.wait().then(
          (r) => r.exitCode ?? 0,
          () => 1,
        ).then((code) => {
          exited = code;
          release();
          for (const cb of exitCbs) cb(code);
        });
        return {
          write: (d) => void pty.sendInput(d).catch(() => {}),
          resize: (c, r) => void pty.resize(c, r).catch(() => {}),
          kill: () => {
            // Leaves the PTY's shell gone but the sandbox up: Daytona's auto-stop reclaims it when idle.
            void pty.kill().catch(() => {});
            void pty.disconnect().catch(() => {});
            release();
          },
          onData: (cb) => {
            dataCbs.push(cb);
            for (const d of early.splice(0)) cb(d);
          },
          onExit: (cb) => {
            if (exited !== undefined) cb(exited);
            else exitCbs.push(cb);
          },
        };
      } catch (err) {
        release();
        throw err;
      }
    },

    async writeFile(learnerId, name, content) {
      const sbx = await findShell(learnerId);
      const path = `${await homeOf(sbx)}/${name}`;
      // The toolbox may run as root, and the learner can leave a symlink at this name (ln -sf /etc/passwd ~/solution.py)
      // that an upload would follow. Remove anything that is not a plain file first (delete does not follow links).
      // A TOCTOU window remains between this check and the upload; the real fix is confirming the toolbox runs as
      // the `learner` user (manual check against a real Daytona key, see services/sandbox/README.md).
      let info: { isDir: boolean; mode?: string } | undefined;
      try {
        info = await sbx.fs.getFileDetails(path);
      } catch (err) {
        if ((err as { statusCode?: number } | null)?.statusCode !== 404) throw err;
      }
      if (info && (info.isDir || info.mode?.startsWith("L") || (info.mode !== undefined && !info.mode.startsWith("-")))) {
        await sbx.fs.deleteFile(path);
      }
      await sbx.fs.uploadFile(Buffer.from(content), path);
    },

    async listDir(learnerId, relDir) {
      const sbx = await findShell(learnerId);
      const home = await homeOf(sbx);
      const path = relDir ? `${home}/${relDir}` : home;
      let files;
      try {
        files = await sbx.fs.listFiles(path);
      } catch (err) {
        // Missing folder: 404 (duck-typed so the SDK is not imported).
        if ((err as { statusCode?: number } | null)?.statusCode === 404) return null;
        // A file path fails listFiles with some other error: confirm it is a file, else it is a real failure.
        const info = await sbx.fs.getFileDetails(path).catch(() => undefined);
        if (info && info.isDir === false) return null;
        throw err;
      }
      const entries = files.slice(0, LIST_MAX_ENTRIES).map((f): DirEntry => ({
        name: f.name,
        type: f.mode.startsWith("L") ? "link" : f.isDir ? "dir" : "file",
        size: f.size,
      }));
      return { entries, truncated: files.length > LIST_MAX_ENTRIES };
    },

    runCode(learnerId, language, code, limits: RunLimits): RunHandle {
      return runInSandbox(client, { ...base, learner: learnerHash(learnerId), stopMinutes: opts.runnerStopMinutes ?? 2 }, language, code, limits);
    },
  };
}

/**
 * One practice run in its own throwaway sandbox: no network, deleted when the program ends. A separate sandbox keeps a
 * graded run out of reach of whatever the learner changed in their own shell (LQ-75).
 */
function runInSandbox(
  client: DaytonaClient,
  o: { snapshot?: string; learner: string; stopMinutes: number },
  language: "python" | "javascript" | "typescript",
  code: string,
  limits: RunLimits,
): RunHandle {
  const out: Array<(s: string) => void> = [];
  const err: Array<(s: string) => void> = [];
  const exits: Array<(c: number | null, e?: string) => void> = [];
  const starts: Array<() => void> = [];
  let sbx: DaytonaSandbox | undefined;
  let cmd: string | undefined;
  const session = `run-${randomUUID()}`;
  let killed = false;
  let ended = false;
  const pending: string[] = [];
  let sending = Promise.resolve(); // input lines go out in order
  let cleaning: Promise<void> | undefined;

  const sendLine = (line: string) => {
    sending = sending.then(() => sbx!.process.sendSessionCommandInput(session, cmd!, `${line}\n`)).catch(() => {});
  };
  // One delete, shared: every caller waits on the same in-flight call, so "gone" means gone.
  const cleanup = (): Promise<void> => {
    if (!sbx) return cleaning ?? Promise.resolve();
    const s = sbx;
    // Bounded retries; a delete that still fails is logged and left to the sandbox's auto-stop + ephemeral delete,
    // and `cleaning` is cleared so a later call tries again.
    return (cleaning ??= (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          return await client.delete(s);
        } catch (err) {
          if (i === 2) console.error(`daytona: could not delete runner sandbox ${s.id}`, err);
          else await new Promise((r) => setTimeout(r, 200 * (i + 1)));
        }
      }
      cleaning = undefined;
    })());
  };
  const end = (code: number | null, error?: string) => {
    if (ended) return;
    ended = true;
    // The slot is released only after the sandbox is gone, same as Docker's `rm -f`.
    void cleanup().finally(() => { for (const cb of exits) cb(code, error); });
  };

  // The exit code can lag the end of the log stream, so wait briefly for it.
  const exitCodeOf = async (s: DaytonaSandbox, id: string) => {
    for (let i = 0; i < 10; i++) {
      const { exitCode } = await s.process.getSessionCommand(session, id);
      if (exitCode !== undefined) return exitCode;
      await new Promise((r) => setTimeout(r, 200));
    }
    return undefined;
  };

  // Settles when the sandbox exists (or failed to), so a stop only ever waits for that, never for the program.
  const createP = client.create({
        ...(o.snapshot ? { snapshot: o.snapshot } : {}),
        labels: { ...APP_LABEL, role: RUNNER_ROLE, learner: o.learner },
        networkBlockAll: true,
        ephemeral: true, // deleted as soon as it stops
        autoStopInterval: o.stopMinutes, // backstop if this process dies before deleting it
      }).then((c) => (sbx = c));
  const createSettled = createP.then(() => {}, () => {});
  void (async () => {
    let created: DaytonaSandbox | undefined;
    let dir: string | undefined;
    let result: { code: number | null; error?: string } | undefined;
    try {
      created = await createP;
      if (killed) return void end(null); // stopped while it was being created: delete it now
      const f = FILE[language];
      // mktemp -d makes a 0700 directory with a random name, so no other process can pre-create or swap the file.
      const made = await created.process.executeCommand("mktemp -d", undefined, undefined, 30);
      const madeDir = made.result?.trim();
      if (made.exitCode !== 0 || !madeDir || !madeDir.startsWith("/") || madeDir.includes("\n")) throw new Error("mktemp failed");
      dir = madeDir;
      const path = `${dir}/${f.name}`;
      await created.fs.uploadFile(Buffer.from(code), path);
      await created.process.createSession(session);
      const res = await created.process.executeSessionCommand(session, {
        command: `timeout -s KILL ${limits.timeoutS} ${f.cmd(shQuote(path)).join(" ")}`,
        runAsync: true,
        suppressInputEcho: true, // typed answers must not come back as program output
      });
      cmd = res.cmdId;
      if (!cmd) throw new Error("no command id");
      if (killed) return void end(null);
      for (const cb of starts) cb();
      for (const l of pending.splice(0)) sendLine(l);
      await created.process.getSessionCommandLogs(session, cmd, (c) => out.forEach((cb) => cb(c)), (c) => err.forEach((cb) => cb(c)));
      const exitCode = await exitCodeOf(created, cmd);
      result = killed
        ? { code: null }
        : exitCode === undefined
          ? { code: null, error: "The code stopped with an error." }
          : { code: exitCode };
    } catch {
      result = { code: null, error: killed ? undefined : "Could not run the code" };
    } finally {
      // Best effort: the sandbox is deleted next anyway, so a failed removal is ignored.
      if (created && dir && !killed) {
        await created.process.executeCommand(`rm -rf -- ${shQuote(dir)}`, undefined, undefined, 10).catch(() => {});
      }
    }
    if (result) end(result.code, result.error);
  })();

  return {
    onStdout: (cb) => void out.push(cb),
    onStderr: (cb) => void err.push(cb),
    onStart: (cb) => void starts.push(cb),
    writeLine: (line) => (cmd && !ended ? sendLine(line) : void pending.push(line)),
    kill: async () => {
      killed = true;
      // A create still in flight finishes first, so the sandbox it returns is deleted, not leaked; the program is not waited on.
      await createSettled;
      await cleanup(); // deleting the sandbox stops the program, even one blocked on input
      end(null);
    },
    onExit: (cb) => void exits.push(cb),
  };
}

/** Builds the real backend from env. The SDK is imported here so it only loads when SANDBOX_BACKEND=daytona. */
export async function daytonaBackendFromEnv(): Promise<SandboxBackend> {
  if (!env.DAYTONA_API_KEY) throw new Error("SANDBOX_BACKEND=daytona needs DAYTONA_API_KEY");
  const { Daytona } = await import("@daytonaio/sdk");
  const client = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    ...(env.DAYTONA_API_URL && { apiUrl: env.DAYTONA_API_URL }),
    ...(env.DAYTONA_TARGET && { target: env.DAYTONA_TARGET }),
  }) as unknown as DaytonaClient;
  return daytonaBackend({ client, snapshot: env.DAYTONA_SNAPSHOT, autoStopMinutes: env.DAYTONA_AUTO_STOP_MINUTES });
}
