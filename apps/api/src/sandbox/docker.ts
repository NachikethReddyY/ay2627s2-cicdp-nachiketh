import { execFile, spawn as spawnProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import pty from "node-pty";
import { env } from "../env.ts";
import {
  LIST_MAX_ENTRIES,
  SandboxBusyError,
  SandboxNotRunningError,
  type DirEntry,
  type DirListing,
  type SandboxBackend,
} from "./backend.ts";

type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr?: string }>;
const run: Exec = promisify(execFile);
const IDLE_MS = 15 * 60_000;

// pnpm unpacks node-pty's prebuilt spawn-helper without the exec bit, which makes every spawn fail with posix_spawnp.
try {
  const dir = createRequire(import.meta.url).resolve("node-pty/package.json").replace(/package\.json$/, "");
  for (const arch of ["darwin-arm64", "darwin-x64"]) chmodSync(`${dir}prebuilds/${arch}/spawn-helper`, 0o755);
} catch {
  // Not present on this platform (Linux builds compile it with the right mode).
}

/**
 * Creates the shell network if it is missing. Inter-container traffic is off, so learners cannot reach each other.
 * Egress to the internet stays open for pip/npm. Docker cannot block the cloud metadata address or private ranges
 * on its own: the host needs the DOCKER-USER rules in services/sandbox/README.md.
 */
export async function ensureNetwork(name: string, exec: Exec = run): Promise<void> {
  if (await exec("docker", ["network", "inspect", name]).then(() => true, () => false)) return;
  try {
    await exec("docker", ["network", "create", "--driver", "bridge", "-o", "com.docker.network.bridge.enable_icc=false", name]);
  } catch (err) {
    // Another API process created it between our inspect and create.
    const msg = `${(err as { stderr?: string }).stderr ?? ""} ${(err as Error).message ?? ""}`;
    if (!/already exists/i.test(msg)) throw err;
  }
}

/** The `docker run` call for a learner's shell container. */
export function shellRunArgs(name: string, opts: { image: string; network: string; runtime?: string }): string[] {
  return [
    "run", "-d", "--name", name,
    "--network", opts.network,
    ...(opts.runtime ? ["--runtime", opts.runtime] : []),
    "--cpus", "1", "--memory", "1g", "--pids-limit", "256",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    // Read-only root plus RAM-backed home and /tmp caps disk use (tmpfs also counts against --memory); files are lost on idle stop, the editor re-syncs them.
    "--read-only",
    "--tmpfs", "/home/learner:rw,exec,size=512m,uid=1001,gid=1001,mode=0700",
    "--tmpfs", "/tmp:rw,exec,size=64m",
    // The venv under /opt is read-only now, so pip installs into home.
    "-e", "PIP_TARGET=/home/learner/.pip", "-e", "PYTHONPATH=/home/learner/.pip",
    opts.image, "sleep", "infinity",
  ];
}

type Spawn = typeof pty.spawn;
type SpawnChild = typeof spawnProcess;

const HOME = "/home/learner";
const LEARNER_UID = "1001";
const PIPE_MAX_BYTES = 64 * 1024;
const PIPE_TIMEOUT_MS = 10_000;
// Exit code the listing script uses for "not a directory", distinct from the docker exec codes (125 to 127).
const NOT_A_DIR = 3;
const LIST_SCRIPT = `test -d "$1" && ! test -L "$1" || exit ${NOT_A_DIR}; exec find -P "$1" -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%f\\0'`;

export function containerName(learnerId: string): string {
  return `lq-sbx-${createHash("sha256").update(learnerId).digest("hex").slice(0, 32)}`;
}

const FIND_TYPES: Record<string, DirEntry["type"]> = { f: "file", d: "dir", l: "link" };

/** Parses `find -printf '%y\t%s\t%f\0'` output. Names may hold tabs and newlines, so records split on NUL and only the first two tabs. */
export function parseFindOutput(out: string, max: number): DirListing {
  const records = out.split("\0");
  records.pop(); // after the last NUL: empty, or a record cut off by the output cap
  const entries: DirEntry[] = [];
  for (const rec of records) {
    const a = rec.indexOf("\t");
    const b = a < 0 ? -1 : rec.indexOf("\t", a + 1);
    if (b < 0) continue;
    entries.push({ name: rec.slice(b + 1), type: FIND_TYPES[rec.slice(0, a)] ?? "other", size: Number(rec.slice(a + 1, b)) || 0 });
  }
  return { entries: entries.slice(0, max), truncated: entries.length > max };
}

export function dockerBackend(opts: {
  image: string;
  idleMs?: number;
  network?: string;
  runtime?: string;
  exec?: Exec;
  spawn?: Spawn;
  spawnChild?: SpawnChild;
  timeoutMs?: number;
  maxContainers?: () => number;
}): SandboxBackend {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const exec = opts.exec ?? run;
  const spawn = opts.spawn ?? pty.spawn;
  const spawnChild = opts.spawnChild ?? spawnProcess;
  const timeoutMs = opts.timeoutMs ?? PIPE_TIMEOUT_MS;
  const maxContainers = opts.maxContainers ?? (() => env.SANDBOX_MAX_SHELLS);
  // Containers that are running or being started. A closed terminal leaves its container up until the idle stop,
  // so the server-wide cap counts these, not open sockets.
  const live = new Set<string>();
  const network = opts.network ?? env.SANDBOX_NETWORK;
  const runtime = opts.runtime ?? env.SANDBOX_RUNTIME;
  const attached = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  const starting = new Map<string, Promise<void>>();
  const stopping = new Map<string, Promise<void>>();
  let netReady: Promise<void> | null = null;

  async function ensureRunning(name: string) {
    const state = await exec("docker", ["inspect", "-f", "{{.State.Running}}", name]).then(
      (r) => r.stdout.trim(),
      () => null,
    );
    if (state === "true") return;
    // A stopped container holds nothing (root is read-only, home is tmpfs), so it is recreated rather than restarted:
    // that way one created before a flag change (network, runtime) never comes back with the old settings.
    if (state === "false") await exec("docker", ["rm", "-f", name]);
    netReady ??= ensureNetwork(network, exec).catch((err) => {
      netReady = null; // retry on the next connect
      throw err;
    });
    await netReady;
    await exec("docker", shellRunArgs(name, { image: opts.image, network, runtime }));
  }

  // Counted from the moment a start is decided, so concurrent first connects can't overshoot the cap.
  function claim(name: string) {
    if (live.has(name)) return;
    if (live.size >= maxContainers()) throw new SandboxBusyError();
    live.add(name);
  }

  // Concurrent connects for one learner share a single create/start.
  function ensure(name: string) {
    let p = starting.get(name);
    if (!p) {
      p = ensureRunning(name).finally(() => starting.delete(name));
      starting.set(name, p);
    }
    return p;
  }

  // Never starts a container: only one this process already counts as live and docker still reports running.
  async function isRunning(name: string) {
    if (!live.has(name)) return false;
    const state = await exec("docker", ["inspect", "-f", "{{.State.Running}}", name]).then((r) => r.stdout.trim(), () => null);
    return state === "true";
  }

  // Argv only, never a shell string. Stdout is capped: past the cap the child is killed and the result flagged.
  function pipe(args: string[], input?: string) {
    return new Promise<{ code: number | null; stdout: string; capped: boolean }>((resolve, reject) => {
      const child = spawnChild("docker", args, { stdio: ["pipe", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let capped = false;
      let done = false;
      let timedOut = false;
      const finish = (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (timedOut) return reject(new Error("sandbox command timed out"));
        resolve({ code, stdout: Buffer.concat(chunks).toString("utf8"), capped });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      timer.unref();
      child.stdout!.on("data", (d: Buffer) => {
        if (capped) return;
        const room = PIPE_MAX_BYTES - bytes;
        chunks.push(d.length > room ? d.subarray(0, room) : d);
        bytes += Math.min(d.length, room);
        if (d.length > room) {
          capped = true;
          child.kill();
          finish(null);
        }
      });
      child.on("error", (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => finish(code));
      child.stdin!.on("error", () => {}); // the child may exit before reading its input
      child.stdin!.end(input);
    });
  }

  // A non-zero exit is an error, never "missing". A docker-level code right after the idle stop means the shell is gone.
  async function failed(name: string, what: string, code: number | null): Promise<Error> {
    if ((code === 125 || code === 126 || code === 127) && !(await isRunning(name))) return new SandboxNotRunningError();
    return new Error(`${what} failed (exit ${code})`);
  }

  return {
    async writeFile(learnerId, fileName, content) {
      const name = containerName(learnerId);
      if (!(await isRunning(name))) throw new SandboxNotRunningError();
      const r = await pipe(["exec", "-i", "-u", LEARNER_UID, name, "sh", "-c", 'cat > "$1"', "sh", `${HOME}/${fileName}`], content);
      if (r.code !== 0) throw await failed(name, `writing ${fileName}`, r.code);
    },

    async listDir(learnerId, relDir) {
      const name = containerName(learnerId);
      if (!(await isRunning(name))) throw new SandboxNotRunningError();
      const dir = relDir ? `${HOME}/${relDir}` : HOME;
      const r = await pipe(["exec", "-u", LEARNER_UID, name, "sh", "-c", LIST_SCRIPT, "sh", dir]);
      if (r.capped) return { ...parseFindOutput(r.stdout, LIST_MAX_ENTRIES), truncated: true };
      if (r.code === NOT_A_DIR) return null;
      if (r.code !== 0) throw await failed(name, "listing", r.code);
      return parseFindOutput(r.stdout, LIST_MAX_ENTRIES);
    },

    async openShell(learnerId, { cols, rows }) {
      const name = containerName(learnerId);
      claim(name); // before anything else, so a refused learner holds nothing
      clearTimeout(timers.get(name));
      attached.set(name, (attached.get(name) ?? 0) + 1);
      const release = () => {
        const n = (attached.get(name) ?? 1) - 1;
        attached.set(name, n);
        if (n > 0) return;
        attached.delete(name);
        // Only the open-shell count is watched: a process left running in the background does not keep the container up.
        const t = setTimeout(() => {
          // A failed stop leaves the container counted: better to refuse a shell than to overshoot the cap.
          const p = exec("docker", ["stop", "-t", "2", name])
            .then(() => void live.delete(name), () => {})
            .finally(() => stopping.delete(name));
          stopping.set(name, p);
        }, idleMs);
        t.unref();
        timers.set(name, t);
      };
      try {
        // A stop already in flight can't be cancelled, so let it finish before starting the container again.
        await stopping.get(name);
        claim(name); // a stop that just finished uncounted it
        await ensure(name);
      } catch (err) {
        release();
        if (!attached.has(name)) live.delete(name); // nothing started, or the start failed: it holds no slot
        throw err;
      }
      let term: ReturnType<typeof pty.spawn>;
      try {
        term = spawn("docker", ["exec", "-it", name, "bash", "-l"], {
          name: "xterm-256color",
          cols,
          rows,
          encoding: null,
          env: process.env as Record<string, string>,
        });
      } catch (err) {
        release();
        throw err;
      }
      let released = false;
      const once = () => {
        if (!released) {
          released = true;
          release();
        }
      };
      term.onExit(once);
      return {
        write: (d) => term.write(d as string | Buffer),
        resize: (c, r) => term.resize(c, r),
        kill: () => {
          term.kill();
          once();
        },
        onData: (cb) => term.onData((d) => cb(d as unknown as Buffer)),
        onExit: (cb) => term.onExit((e) => cb(e.exitCode)),
      };
    },
  };
}
