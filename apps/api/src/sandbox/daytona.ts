import { createHash, randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { SandboxBusyError, type RunHandle, type RunLimits, type SandboxBackend } from "./backend.ts";

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
  setAutostopInterval(minutes: number): Promise<void>;
  process: {
    createPty(o: { id: string; cols: number; rows: number; onData: (d: Uint8Array) => void | Promise<void> }): Promise<DaytonaPty>;
    createSession(id: string): Promise<void>;
    executeSessionCommand(session: string, req: { command: string; runAsync?: boolean }): Promise<{ cmdId?: string }>;
    getSessionCommandLogs(session: string, cmd: string, onStdout: (c: string) => void, onStderr: (c: string) => void): Promise<void>;
    getSessionCommand(session: string, cmd: string): Promise<{ exitCode?: number }>;
    sendSessionCommandInput(session: string, cmd: string, data: string): Promise<void>;
  };
  fs: { uploadFile(file: Buffer, remotePath: string): Promise<void> };
}
export interface DaytonaClient {
  create(params: Record<string, unknown>, options?: { timeout?: number }): Promise<DaytonaSandbox>;
  list(query: { labels?: Record<string, string> }): AsyncIterableIterator<DaytonaSandbox>;
  delete(sandbox: DaytonaSandbox): Promise<void>;
}

export const APP_LABEL = { app: "learnquest" } as const;
const SHELL_ROLE = "shell";
const RUNNER_ROLE = "runner";

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
  const attached = new Map<string, number>(); // open terminals per learner on this API instance
  let openTerminals = 0;

  async function findOrCreate(learnerId: string): Promise<DaytonaSandbox> {
    const labels = { ...APP_LABEL, role: SHELL_ROLE, learner: learnerHash(learnerId) };
    let sbx: DaytonaSandbox | undefined;
    for await (const s of client.list({ labels })) {
      sbx = s;
      break;
    }
    sbx ??= await client.create({
      ...base,
      labels,
      // Daytona stops an idle sandbox itself, so this holds across restarts and several API instances.
      autoStopInterval: autoStop,
    });
    if (sbx.state !== "started") await sbx.start();
    return sbx;
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
      const key = learnerHash(learnerId);
      attached.set(key, (attached.get(key) ?? 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        openTerminals--;
        const n = (attached.get(key) ?? 1) - 1;
        if (n > 0) attached.set(key, n);
        else attached.delete(key);
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
  let sbx: DaytonaSandbox | undefined;
  let cmd: string | undefined;
  const session = `run-${randomUUID()}`;
  let killed = false;
  let ended = false;
  const pending: string[] = [];
  let sending = Promise.resolve(); // input lines go out in order

  const sendLine = (line: string) => {
    sending = sending.then(() => sbx!.process.sendSessionCommandInput(session, cmd!, `${line}\n`)).catch(() => {});
  };
  const cleanup = async () => {
    if (!sbx) return;
    const s = sbx;
    sbx = undefined;
    await client.delete(s).catch(() => {});
  };
  const end = (code: number | null, error?: string) => {
    if (ended) return;
    ended = true;
    // The slot is released only after the sandbox is gone, same as Docker's `rm -f`.
    void cleanup().finally(() => { for (const cb of exits) cb(code, error); });
  };

  void (async () => {
    try {
      const created = await client.create({
        ...(o.snapshot ? { snapshot: o.snapshot } : {}),
        labels: { ...APP_LABEL, role: RUNNER_ROLE, learner: o.learner },
        networkBlockAll: true,
        ephemeral: true, // deleted as soon as it stops
        autoStopInterval: o.stopMinutes, // backstop if this process dies before deleting it
      });
      sbx = created;
      if (killed) return void end(null);
      const f = FILE[language];
      await created.fs.uploadFile(Buffer.from(code), f.path);
      await created.process.createSession(session);
      const res = await created.process.executeSessionCommand(session, {
        command: `timeout -s KILL ${limits.timeoutS} ${f.cmd.join(" ")}`,
        runAsync: true,
      });
      cmd = res.cmdId;
      if (!cmd) throw new Error("no command id");
      for (const l of pending.splice(0)) sendLine(l);
      await created.process.getSessionCommandLogs(session, cmd, (c) => out.forEach((cb) => cb(c)), (c) => err.forEach((cb) => cb(c)));
      const info = await created.process.getSessionCommand(session, cmd);
      end(killed ? null : (info.exitCode ?? null), killed ? undefined : info.exitCode === undefined ? "The code stopped with an error." : undefined);
    } catch {
      end(null, killed ? undefined : "Could not run the code");
    }
  })();

  return {
    onStdout: (cb) => void out.push(cb),
    onStderr: (cb) => void err.push(cb),
    writeLine: (line) => (cmd && sbx ? sendLine(line) : void pending.push(line)),
    kill: async () => {
      killed = true;
      if (ended) return;
      await cleanup();
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
