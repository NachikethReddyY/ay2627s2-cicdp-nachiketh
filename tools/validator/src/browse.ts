import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Layout } from "./state.ts";

export const BROWSER_SESSION = "validator";

export function agentBrowserBinary(): string {
  return join(fileURLToPath(new URL("..", import.meta.url)), "node_modules", ".bin", "agent-browser");
}

export function browserArgs(args: string[]): string[] {
  const hasSession = args.includes("--session");
  return hasSession ? args : ["--session", BROWSER_SESSION, ...args];
}

export function resolveScreenshotPath(args: string[], cwd: string, shotsDir: string, stamp: number): string[] {
  if (args[0] !== "screenshot") return args;
  const pathIndex = args.findIndex((arg, i) => i > 0 && !arg.startsWith("-"));
  if (pathIndex === -1) return [...args, join(shotsDir, `shot-${stamp}.png`)];
  const path = args[pathIndex];
  return args.map((arg, i) => (i === pathIndex && !isAbsolute(path) ? resolve(cwd, path) : arg));
}

export function loginArgs(layout: Layout, webUrl: string): string[][] {
  return [
    ["close"],
    ["--state", layout.authState, "open", webUrl],
  ].map((a) => browserArgs(a));
}

export function runBrowser(args: string[]): number {
  const result = spawnSync(agentBrowserBinary(), args, { stdio: "inherit" });
  return result.status ?? 1;
}
