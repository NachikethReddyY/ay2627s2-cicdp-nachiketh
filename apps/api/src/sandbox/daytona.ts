import { createHash, randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { LIST_MAX_ENTRIES, SandboxBusyError, SandboxNotRunningError, type DirEntry, type RunHandle, type RunLimits, type SandboxBackend } from "./backend.ts";

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
    createPty(o: { id: string; cols: number; rows: number; onData: (d: Uint8Array) => void | Promise<void> }): Promise<DaytonaPty>;
    createSession(id: string): Promise<void>;
    executeSessionCommand(session: string, req: { command: string; runAsync?: boolean; suppressInputEcho?: boolean }): Promise<{ cmdId?: string }>;
    getSessionCommandLogs(session: string, cmd: string, onStdout: (c: string) => void, onStderr: (c: string) => void): Promise<void>;
    getSessionCommand(session: string, cmd: string): Promise<{ exitCode?: number }>;
    sendSessionCommandInput(session: string, cmd: string, data: string): Promise<void>;
  };
  getUserHomeDir(): Promise<string | undefined>;
  fs: {
    uploadFile(file: Buffer, remotePath: string): Promise<void>;
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
const BROKEN = new Set(["error", "build_failed", "destroyed", "destroying"]);

/** The label value for a learner: a hash, so no learner id is stored at Daytona. Same hash Docker uses for container names. */
export const learnerHash = (learnerId: string) => createHash("sha256").update(learnerId).digest("hex");

const FILE: Record<"python" | "javascript", { path: string; cmd: string[] }> = {
  python: { path: "/tmp/main.py", cmd: ["python3", "-I", "-u", "/tmp/main.py"] },
  javascript: { path: "/tmp/main.js", cmd: ["node", "/tmp/main.js"] },
};

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
    for await (const s of client.list({ labels: shellLabels(learnerId) })) {
      if (s.state !== "started") throw new SandboxNotRunningError();
      return s;
    }
    throw new SandboxNotRunningError();
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
        const dataCbs: Array<(d: Uint8Array) => void> = [];
        const early: Uint8Array[] = []; // output that arrives before the route attaches its listener
        const pty = await sbx.process.createPty({
          id: `lq-${randomUUID()}`,
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
  language: "python" | "javascript",
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
    try {
      const created = await createP;
      if (killed) return void end(null); // stopped while it was being created: delete it now
      const f = FILE[language];
      await created.fs.uploadFile(Buffer.from(code), f.path);
      await created.process.createSession(session);
      const res = await created.process.executeSessionCommand(session, {
        command: `timeout -s KILL ${limits.timeoutS} ${f.cmd.join(" ")}`,
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
      if (killed) end(null);
      else if (exitCode === undefined) end(null, "The code stopped with an error.");
      else end(exitCode);
    } catch {
      end(null, killed ? undefined : "Could not run the code");
    }
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
