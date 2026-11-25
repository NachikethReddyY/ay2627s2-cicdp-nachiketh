import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { PORTS, processTree } from "./ports.ts";
import type { Layout, ServiceName, ServiceRecord } from "./state.ts";
import { isAlive } from "./state.ts";
import type { Clock } from "./wait.ts";
import { bin } from "../../../scripts/bin.ts";

export const VALIDATOR_SECRET = "validator-secret-not-for-production-0123456789";
export const VALIDATOR_ENGINE_TOKEN = "validator-engine-token-0123456789-abcdefgh";
export const VALIDATOR_PASSWORD = "validator-pass-0123";
export const VALIDATOR_EMAIL = "agent@validator.local";
export const VALIDATOR_NAME = "Validator Agent";
export const WEB_ORIGIN = `http://localhost:${PORTS.web}`;
export const API_ORIGIN = `http://localhost:${PORTS.api}`;

const offlineAnalyticsEnv = { POSTHOG_PROJECT_TOKEN: "", POSTHOG_HOST: "" };

export type ServiceSpec = {
  name: ServiceName;
  port: number;
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  healthUrl: string;
  url: string;
  timeoutMs: number;
};

export function appEnv(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    BETTER_AUTH_SECRET: VALIDATOR_SECRET,
    PUBLIC_ORIGIN: WEB_ORIGIN,
  };
}

export function apiEnv(databaseUrl: string, engine: boolean): Record<string, string> {
  const base = {
    ...appEnv(databaseUrl),
    ...offlineAnalyticsEnv,
    PORT: String(PORTS.api),
    HOST: "127.0.0.1",
  };
  if (!engine) return base;
  return { ...base, ENGINE_URL: `http://localhost:${PORTS.engine}`, ENGINE_TOKEN: VALIDATOR_ENGINE_TOKEN };
}

export function engineEnv(): Record<string, string> {
  return {
    ...offlineAnalyticsEnv,
    LLM_MODEL: "openai/fake-llm",
    LLM_API_BASE: `http://localhost:${PORTS.fakeLlm}/v1`,
    LLM_API_KEY: "validator",
    ENGINE_TOKEN: VALIDATOR_ENGINE_TOKEN,
    LITELLM_LOCAL_MODEL_COST_MAP: "True",
  };
}

export function serviceSpecs(root: string, databaseUrl: string, engine: boolean): ServiceSpec[] {
  const specs: ServiceSpec[] = [
    {
      name: "fake-llm",
      port: PORTS.fakeLlm,
      cwd: root,
      command: process.execPath,
      args: [join(root, "e2e", "fake-llm", "server.ts")],
      env: { PORT: String(PORTS.fakeLlm), HOST: "127.0.0.1", FAKE_LLM_FIXTURE_DIR: join(root, "services", "engine", "tests", "fixtures") },
      healthUrl: `http://localhost:${PORTS.fakeLlm}/healthz`,
      url: `http://localhost:${PORTS.fakeLlm}`,
      timeoutMs: 20_000,
    },
  ];
  if (engine) {
    specs.push({
      name: "engine",
      port: PORTS.engine,
      cwd: join(root, "services", "engine"),
      command: "uv",
      args: ["run", "uvicorn", "learnquest_engine.server:app", "--port", String(PORTS.engine)],
      env: engineEnv(),
      healthUrl: `http://localhost:${PORTS.engine}/healthz`,
      url: `http://localhost:${PORTS.engine}`,
      timeoutMs: 120_000,
    });
  }
  specs.push(
    {
      name: "api",
      port: PORTS.api,
      cwd: join(root, "apps", "api"),
      command: process.execPath,
      args: [join(root, "apps", "api", "src", "server.ts")],
      env: apiEnv(databaseUrl, engine),
      healthUrl: `${API_ORIGIN}/api/healthz`,
      url: API_ORIGIN,
      timeoutMs: 60_000,
    },
    {
      name: "web",
      port: PORTS.web,
      cwd: root,
      command: "pnpm",
      args: ["--filter", "@learnquest/web", "exec", "vite", "--port", String(PORTS.web), "--host", "127.0.0.1", "--strictPort"],
      env: { ...offlineAnalyticsEnv, DEV_API_ORIGIN: API_ORIGIN },
      healthUrl: `${WEB_ORIGIN}/`,
      url: WEB_ORIGIN,
      timeoutMs: 90_000,
    },
  );
  return specs;
}

export function spawnDetached(layout: Layout, spec: ServiceSpec, engine: boolean): ServiceRecord {
  const log = join(layout.logsDir, `${spec.name}.log`);
  const fd = openSync(log, "a");
  try {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    if (child.pid === undefined) throw new Error(`could not start ${spec.name}`);
    return { pid: child.pid, port: spec.port, url: spec.url, log, engine };
  } finally {
    closeSync(fd);
  }
}

function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      continue;
    }
  }
}

export function commandLineOf(pid: number): string | null {
  try {
    return execFileSync(bin("ps"), ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

export function isValidatorCommand(command: string, root: string): boolean {
  return command.includes(root) || /uvicorn learnquest_engine|@learnquest\/web exec vite|fake-llm\/server\.ts/.test(command);
}

export async function stopProcess(
  pid: number,
  clock: Clock,
  graceMs = 5000,
  owns: (command: string | null) => boolean = () => true,
): Promise<"already-stopped" | "terminated" | "killed" | "not-ours"> {
  if (!isAlive(pid)) return "already-stopped";
  if (!owns(commandLineOf(pid))) return "not-ours";
  const tree = processTree(pid);
  signalAll(tree, "SIGTERM");
  const deadline = clock.now() + graceMs;
  while (clock.now() < deadline) {
    if (!tree.some(isAlive)) return "terminated";
    await clock.sleep(100);
  }
  signalAll(tree.filter(isAlive), "SIGKILL");
  return "killed";
}
