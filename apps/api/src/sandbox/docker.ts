import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import pty from "node-pty";
import { env } from "../env.ts";
import { SandboxBusyError, type SandboxBackend } from "./backend.ts";

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

export function dockerBackend(opts: {
  image: string;
  idleMs?: number;
  network?: string;
  runtime?: string;
  exec?: Exec;
  spawn?: Spawn;
  maxContainers?: () => number;
}): SandboxBackend {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const exec = opts.exec ?? run;
  const spawn = opts.spawn ?? pty.spawn;
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

  return {
    async openShell(learnerId, { cols, rows }) {
      const name = `lq-sbx-${createHash("sha256").update(learnerId).digest("hex").slice(0, 32)}`;
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
