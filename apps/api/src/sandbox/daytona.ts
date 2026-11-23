import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "../env.ts";
import { checkHarnessSource } from "./checkHarness.ts";
import { BUDGET_S, CheckUnavailableError, encodeCheckInput, readCheckResults } from "./checkRunner.ts";
import { LIST_MAX_ENTRIES, SandboxBusyError, SandboxFileTooLargeError, SandboxNotRunningError, type DirEntry, type RunHandle, type RunLimits, type SandboxBackend } from "./backend.ts";

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
  labels?: Record<string, string>;
  state?: string;
  networkBlockAll?: boolean;
  updateNetworkSettings(settings: { networkBlockAll: boolean }): Promise<void>;
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
    uploadFile(file: Buffer, remotePath: string, timeout?: number): Promise<void>;
    downloadFile?(remotePath: string): Promise<Buffer>;
    listFiles(path: string): Promise<Array<{ name: string; isDir: boolean; size: number; mode: string }>>;
    getFileDetails(path: string): Promise<{ isDir: boolean; mode?: string }>;
    deleteFile(path: string, recursive?: boolean): Promise<void>;
  };
}
export interface DaytonaClient {
  create(params: Record<string, unknown>, options?: { timeout?: number }): Promise<DaytonaSandbox>;
  get(idOrName: string): Promise<DaytonaSandbox>;
  list(query: { labels?: Record<string, string> }): AsyncIterableIterator<DaytonaSandbox>;
  delete(sandbox: DaytonaSandbox, timeout?: number): Promise<void>;
}

export const APP_LABEL = { app: "learnquest" } as const;
const SHELL_ROLE = "shell";
const RUNNER_ROLE = "runner";
const SANDBOX_START_S = 25;
const SANDBOX_FILE_S = 10;
const CHECK_LEARNER_UID = 10_001;
const DAYTONA_ZSH_RC = readFileSync(new URL("./learner-zshrc", import.meta.url));
const BROKEN = new Set(["error", "build_failed", "destroyed", "destroying"]);

export const learnerHash = (learnerId: string) => createHash("sha256").update(learnerId).digest("hex");

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
  runnerStopMinutes?: number;
}): SandboxBackend {
  const { client } = opts;
  const autoStop = opts.autoStopMinutes ?? 3;
  const maxShells = opts.maxShells ?? (() => env.SANDBOX_MAX_SHELLS);
  const base = opts.snapshot ? { snapshot: opts.snapshot } : {};
  const isolated = { ...base, networkBlockAll: true };
  const finding = new Map<string, Promise<DaytonaSandbox>>();
  let openTerminals = 0;

  const shellLabels = (learnerId: string) => ({ ...APP_LABEL, role: SHELL_ROLE, learner: learnerHash(learnerId) });
  const shellName = (learner: string) => `learnquest-shell-${learner.slice(0, 40)}`;
  type ShellLabels = ReturnType<typeof shellLabels>;

  async function namedShell(labels: ShellLabels): Promise<DaytonaSandbox | undefined> {
    const sbx = await client.get(shellName(labels.learner)).catch((error: unknown) => {
      if ((error as { statusCode?: number } | null)?.statusCode === 404) return undefined;
      throw error;
    });
    if (sbx && !Object.entries(labels).every(([key, value]) => sbx.labels?.[key] === value)) {
      throw new Error("Daytona shell has unexpected ownership labels");
    }
    return sbx;
  }

  async function existingShell(labels: ShellLabels): Promise<DaytonaSandbox | undefined> {
    const named = await namedShell(labels);
    if (named) return named;
    for await (const sbx of client.list({ labels })) return sbx;
  }

  async function findOrCreate(learnerId: string): Promise<DaytonaSandbox> {
    const labels = shellLabels(learnerId);
    let sbx = await existingShell(labels);
    if (sbx && BROKEN.has(sbx.state ?? "")) {
      await client.delete(sbx).catch(() => {});
      sbx = undefined;
    }
    sbx ??= await client.create({
      ...isolated,
      name: shellName(labels.learner),
      labels,
      autoStopInterval: autoStop,
    }, { timeout: SANDBOX_START_S }).catch(async (error: unknown) => {
      if ((error as { statusCode?: number } | null)?.statusCode === 409) {
        const concurrent = await namedShell(labels);
        if (concurrent) return concurrent;
      }
      throw error;
    });
    const st = sbx.state ?? "";
    if (st === "starting" || st === "creating" || st === "restoring") await sbx.waitUntilStarted(SANDBOX_START_S);
    else if (st !== "started") {
      if (st === "stopping" || st === "archiving") await sbx.waitUntilStopped(SANDBOX_START_S);
      await sbx.start(SANDBOX_START_S);
    }
    if (sbx.networkBlockAll !== true) await sbx.updateNetworkSettings({ networkBlockAll: true });
    return sbx;
  }

  async function findShell(learnerId: string): Promise<DaytonaSandbox> {
    const sbx = await existingShell(shellLabels(learnerId));
    if (sbx?.state !== "started") throw new SandboxNotRunningError();
    return sbx;
  }

  const SHELL_CACHE_MS = 10_000;
  const shells = new Map<string, { sbx: DaytonaSandbox; at: number }>();

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
      const cached = shells.get(learnerId);
      const sbx = cached && Date.now() - cached.at < SHELL_CACHE_MS ? cached.sbx : await findShell(learnerId);
      if (sbx !== cached?.sbx) shells.set(learnerId, { sbx, at: Date.now() });
      try {
        const parts = relPath.split("/");
        const home = await homeOf(sbx);
        const paths = parts.map((_, index) => [home, ...parts.slice(0, index + 1)].join("/"));
        type Stat = { info: { isDir: boolean; mode?: string; size?: number } } | { err: unknown };
        const stats: Stat[] = await Promise.all(paths.map((p) => sbx.fs.getFileDetails(p).then((info): Stat => ({ info }), (err: unknown): Stat => ({ err }))));
        let size: number | undefined;
        for (const [index, stat] of stats.entries()) {
          if ("err" in stat) {
            if ((stat.err as { statusCode?: number } | null)?.statusCode === 404) return null;
            throw stat.err;
          }
          const { info } = stat;
          if (info.mode?.startsWith("L") || (index < parts.length - 1 ? !info.isDir : info.isDir)) return null;
          size = info.size;
        }
        if (size === undefined || size > 64 * 1024) throw new SandboxFileTooLargeError();
        if (!sbx.fs.downloadFile) throw new Error("Workspace file reading is not supported by this Daytona SDK");
        const content = await sbx.fs.downloadFile(paths[paths.length - 1]);
        if (content.byteLength > 64 * 1024) throw new SandboxFileTooLargeError();
        return content.toString("utf8");
      } catch (err) {
        shells.delete(learnerId);
        throw err;
      }
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
        const early: Uint8Array[] = [];
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
        if ((err as { statusCode?: number } | null)?.statusCode === 404) return null;
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

    async runChecks(code, language, tests) {
      const token = randomUUID();
      let sbx: DaytonaSandbox | undefined;
      try {
        sbx = await client.create({
          ...isolated,
          user: "root",
          labels: { ...APP_LABEL, role: "check" },
          ephemeral: true,
          autoStopInterval: 2,
          ttlMinutes: 3,
        }, { timeout: SANDBOX_START_S });
        const dir = "/tmp/learnquest-check";
        const setup = await sbx.process.executeCommand(
          `mkdir -m 700 -- ${dir}`,
          undefined, undefined, SANDBOX_FILE_S,
        );
        if (setup.exitCode !== 0) throw new CheckUnavailableError("check setup failed");
        const input = `${dir}/input.json`;
        await sbx.fs.uploadFile(Buffer.from(encodeCheckInput(token, language, code, tests)), input, SANDBOX_FILE_S);
        const harness = `timeout -s KILL ${BUDGET_S} node -e ${shQuote(checkHarnessSource(CHECK_LEARNER_UID))}`;
        const command = `exec 3< ${input} && rm -- ${input} || exit 1
if [ "$(id -u)" = 0 ]; then exec ${harness} <&3 3<&-; fi
exec sudo -n env "PATH=$PATH" ${harness} <&3 3<&-`;
        const { exitCode, result } = await sbx.process.executeCommand(command, undefined, undefined, BUDGET_S);
        return readCheckResults(result ?? "", exitCode, token, tests.length);
      } catch (error) {
        throw new CheckUnavailableError("Daytona check failed", { cause: error });
      } finally {
        if (sbx) await client.delete(sbx, SANDBOX_FILE_S).catch(() => {});
      }
    },

    runCode(learnerId, language, code, limits: RunLimits): RunHandle {
      return runInSandbox(client, { ...base, learner: learnerHash(learnerId), stopMinutes: opts.runnerStopMinutes ?? 2 }, language, code, limits);
    },
  };
}

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
  let sending = Promise.resolve();
  let cleaning: Promise<void> | undefined;

  const sendLine = (line: string) => {
    sending = sending.then(() => sbx!.process.sendSessionCommandInput(session, cmd!, `${line}\n`)).catch(() => {});
  };
  const cleanup = (): Promise<void> => {
    if (!sbx) return cleaning ?? Promise.resolve();
    const s = sbx;
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
    void cleanup().finally(() => { for (const cb of exits) cb(code, error); });
  };

  const exitCodeOf = async (s: DaytonaSandbox, id: string) => {
    for (let i = 0; i < 10; i++) {
      const { exitCode } = await s.process.getSessionCommand(session, id);
      if (exitCode !== undefined) return exitCode;
      await new Promise((r) => setTimeout(r, 200));
    }
    return undefined;
  };

  const createP = client.create({
        ...(o.snapshot ? { snapshot: o.snapshot } : {}),
        labels: { ...APP_LABEL, role: RUNNER_ROLE, learner: o.learner },
        networkBlockAll: true,
        ephemeral: true,
        autoStopInterval: o.stopMinutes,
      }).then((c) => (sbx = c));
  const createSettled = createP.then(() => {}, () => {});
  void (async () => {
    let created: DaytonaSandbox | undefined;
    let dir: string | undefined;
    let result: { code: number | null; error?: string } | undefined;
    try {
      created = await createP;
      if (killed) return  end(null);
      const f = FILE[language];
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
        suppressInputEcho: true,
      });
      cmd = res.cmdId;
      if (!cmd) throw new Error("no command id");
      if (killed) return  end(null);
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
      await createSettled;
      await cleanup();
      end(null);
    },
    onExit: (cb) => void exits.push(cb),
  };
}

export async function daytonaBackendFromEnv(): Promise<SandboxBackend> {
  if (!env.DAYTONA_API_KEY) throw new Error("SANDBOX_BACKEND=daytona needs DAYTONA_API_KEY");
  const { Daytona } = await import("@daytonaio/sdk");
  const client = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    requestTimeoutMs: SANDBOX_START_S * 1000,
    ...(env.DAYTONA_API_URL && { apiUrl: env.DAYTONA_API_URL }),
    ...(env.DAYTONA_TARGET && { target: env.DAYTONA_TARGET }),
  }) as unknown as DaytonaClient;
  return daytonaBackend({ client, snapshot: env.DAYTONA_SNAPSHOT, autoStopMinutes: env.DAYTONA_AUTO_STOP_MINUTES });
}
