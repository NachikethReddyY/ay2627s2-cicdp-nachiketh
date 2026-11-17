import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ServiceName = "fake-llm" | "api" | "engine" | "web";

export type ServiceRecord = {
  pid: number;
  port: number;
  url: string;
  log: string;
  engine?: boolean;
};

export type State = {
  startedAt: string;
  database: string;
  engine: boolean;
  services: Partial<Record<ServiceName, ServiceRecord>>;
};

export type Layout = {
  root: string;
  dir: string;
  stateFile: string;
  logsDir: string;
  shotsDir: string;
  authState: string;
  authCookies: string;
};

export const SERVICE_NAMES: ServiceName[] = ["fake-llm", "engine", "api", "web"];

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function layoutFor(root: string): Layout {
  const dir = join(root, ".validator");
  return {
    root,
    dir,
    stateFile: join(dir, "state.json"),
    logsDir: join(dir, "logs"),
    shotsDir: join(dir, "shots"),
    authState: join(dir, "auth-state.json"),
    authCookies: join(dir, "auth-cookies.json"),
  };
}

export function ensureLayout(layout: Layout): void {
  mkdirSync(layout.logsDir, { recursive: true });
  mkdirSync(layout.shotsDir, { recursive: true });
  const ignore = join(layout.dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
}

export function emptyState(database: string, engine: boolean, now: Date = new Date()): State {
  return { startedAt: now.toISOString(), database, engine, services: {} };
}

export function parseState(text: string): State | null {
  try {
    const value = JSON.parse(text) as Partial<State>;
    if (typeof value !== "object" || value === null) return null;
    if (typeof value.database !== "string" || typeof value.services !== "object" || value.services === null) return null;
    return {
      startedAt: String(value.startedAt ?? ""),
      database: value.database,
      engine: value.engine === true,
      services: value.services,
    };
  } catch {
    return null;
  }
}

export function readState(layout: Layout): State | null {
  if (!existsSync(layout.stateFile)) return null;
  return parseState(readFileSync(layout.stateFile, "utf8"));
}

export function writeState(layout: Layout, state: State): void {
  ensureLayout(layout);
  writeFileSync(layout.stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export function removeState(layout: Layout): void {
  rmSync(layout.stateFile, { force: true });
  rmSync(layout.authState, { force: true });
  rmSync(layout.authCookies, { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
