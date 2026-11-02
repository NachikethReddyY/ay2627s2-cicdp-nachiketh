import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import pty from "node-pty";
import type { SandboxBackend } from "./backend.ts";

const run = promisify(execFile);
const IDLE_MS = 15 * 60_000;

// pnpm unpacks node-pty's prebuilt spawn-helper without the exec bit, which makes every spawn fail with posix_spawnp.
try {
  const dir = createRequire(import.meta.url).resolve("node-pty/package.json").replace(/package\.json$/, "");
  for (const arch of ["darwin-arm64", "darwin-x64"]) chmodSync(`${dir}prebuilds/${arch}/spawn-helper`, 0o755);
} catch {
  // Not present on this platform (Linux builds compile it with the right mode).
}

export function dockerBackend(opts: { image: string; idleMs?: number }): SandboxBackend {
  const idleMs = opts.idleMs ?? IDLE_MS;
  const attached = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  const starting = new Map<string, Promise<void>>();
  const stopping = new Map<string, Promise<void>>();

  async function ensureRunning(name: string) {
    const state = await run("docker", ["inspect", "-f", "{{.State.Running}}", name]).then(
      (r) => r.stdout.trim(),
      () => null,
    );
    if (state === "true") return;
    if (state === "false") {
      await run("docker", ["start", name]);
      return;
    }
    await run("docker", [
      "run", "-d", "--name", name,
      "--cpus", "1", "--memory", "1g", "--pids-limit", "256",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      // Read-only root plus RAM-backed home and /tmp caps disk use (tmpfs also counts against --memory); files are lost on idle stop, the editor re-syncs them.
      "--read-only",
      "--tmpfs", "/home/learner:rw,exec,size=512m,uid=1001,gid=1001,mode=0700",
      "--tmpfs", "/tmp:rw,exec,size=64m",
      // The venv under /opt is read-only now, so pip installs into home.
      "-e", "PIP_TARGET=/home/learner/.pip", "-e", "PYTHONPATH=/home/learner/.pip",
      opts.image, "sleep", "infinity",
    ]);
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
      clearTimeout(timers.get(name));
      attached.set(name, (attached.get(name) ?? 0) + 1);
      const release = () => {
        const n = (attached.get(name) ?? 1) - 1;
        attached.set(name, n);
        if (n > 0) return;
        attached.delete(name);
        // Only the open-shell count is watched: a process left running in the background does not keep the container up.
        const t = setTimeout(() => {
          const p = run("docker", ["stop", "-t", "2", name]).then(() => {}, () => {}).finally(() => stopping.delete(name));
          stopping.set(name, p);
        }, idleMs);
        t.unref();
        timers.set(name, t);
      };
      try {
        // A stop already in flight can't be cancelled, so let it finish before starting the container again.
        await stopping.get(name);
        await ensure(name);
      } catch (err) {
        release();
        throw err;
      }
      let term: ReturnType<typeof pty.spawn>;
      try {
        term = pty.spawn("docker", ["exec", "-it", name, "bash", "-l"], {
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
