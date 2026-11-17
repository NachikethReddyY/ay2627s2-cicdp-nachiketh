import { execFileSync } from "node:child_process";
import { bin } from "./bin.ts";

export type PortOwner = { pid: number; command: string };

export const PORTS = { web: 5173, api: 3000, fakeLlm: 8080, engine: 8000 } as const;

export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port "${value}"`);
  return port;
}

export function portOfUrl(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return parsePort(parsed.port);
  return parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 5432;
}

export function parseLsofOwners(output: string): PortOwner[] {
  const owners: PortOwner[] = [];
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("c") && pid !== null && Number.isInteger(pid)) {
      if (!owners.some((o) => o.pid === pid)) owners.push({ pid, command: line.slice(1) });
    }
  }
  return owners;
}

export function listenersOnPort(port: number): PortOwner[] {
  try {
    const out = execFileSync(bin("lsof"), ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseLsofOwners(out);
  } catch {
    return [];
  }
}

export type ProcessRow = { pid: number; ppid: number };

export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]) });
  }
  return rows;
}

export function descendantsOf(rows: ProcessRow[], root: number): number[] {
  const found = new Set<number>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (found.has(row.ppid) && !found.has(row.pid)) {
        found.add(row.pid);
        grew = true;
      }
    }
  }
  return [...found];
}

export function processTree(root: number): number[] {
  try {
    const out = execFileSync(bin("ps"), ["-axo", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return descendantsOf(parseProcessTable(out), root);
  } catch {
    return [root];
  }
}

export type PortVerdict =
  | { kind: "free" }
  | { kind: "ours" }
  | { kind: "foreign"; owner: PortOwner };

export function judgePort(owners: PortOwner[], ours: number[]): PortVerdict {
  if (owners.length === 0) return { kind: "free" };
  const foreign = owners.find((o) => !ours.includes(o.pid));
  return foreign ? { kind: "foreign", owner: foreign } : { kind: "ours" };
}

export function foreignPortMessage(port: number, owner: PortOwner): string {
  return `port ${port} is already used by ${owner.command} (pid ${owner.pid}). Stop it (kill ${owner.pid}) or free the port, then run up again.`;
}
