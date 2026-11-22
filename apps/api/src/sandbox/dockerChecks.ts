import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { env } from "../env.ts";
import type { PracticeLanguage, PracticeTest } from "../parts/practice-schema.ts";
import { BUDGET_S, CheckUnavailableError, encodeCheckInput, MAX_HARNESS_OUTPUT, readCheckResults, type RawResult } from "./checkRunner.ts";
import { HARNESS_SOURCE } from "./checkHarness.ts";

const CONTAINER_LIMIT_S = BUDGET_S + 3;

type Spawn = typeof nodeSpawn;
let spawnImpl: Spawn = nodeSpawn;
export function setCheckSpawnForTests(s?: Spawn): void {
  spawnImpl = s ?? nodeSpawn;
}

export function runInContainer(code: string, language: PracticeLanguage, tests: PracticeTest[], spawn: Spawn = spawnImpl, image = env.SANDBOX_IMAGE): Promise<RawResult[]> {
  const name = `lq-check-${randomUUID()}`;
  const token = randomUUID();
  const args = [
    "run", "--rm", "-i", "--name", name, "--network", "none",
    "--cpus", "0.5", "--memory", "256m", "--pids-limit", "64",
    "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "KILL",
    "--security-opt", "no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,exec,size=16m", "--user", "0:0",
    image, "timeout", "-s", "KILL", String(CONTAINER_LIMIT_S), "node", "-e", HARNESS_SOURCE,
  ];
  return new Promise((resolve, reject) => {
    let out = "";
    let settled = false;
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const cleanup = () => {
      try { child.kill("SIGKILL"); } catch { }
      const rm = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
      rm.on("error", () => {});
      setTimeout(() => { try { rm.kill("SIGKILL"); } catch { } }, 10_000).unref();
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(backstop);
      fn();
    };
    const backstop = setTimeout(() => settle(() => { cleanup(); reject(new CheckUnavailableError("budget exceeded")); }), BUDGET_S * 1000);
    backstop.unref();
    child.stdout?.on("data", (d: Buffer) => { if (out.length <= MAX_HARNESS_OUTPUT) out = (out + d.toString()).slice(0, MAX_HARNESS_OUTPUT + 1); });
    child.stderr?.on("data", () => {});
    child.stdin?.on("error", () => {});
    child.on("error", () => settle(() => reject(new CheckUnavailableError("spawn failed"))));
    child.on("close", (code: number | null) =>
      settle(() => {
        try {
          resolve(readCheckResults(out, code, token, tests.length));
        } catch (error) {
          reject(error);
        }
      }),
    );
    child.stdin?.end(encodeCheckInput(token, language, code, tests));
  });
}
