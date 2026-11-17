import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"];
const PNPM_DIRS = [join(homedir(), "Library", "pnpm", "bin"), join(homedir(), ".local", "share", "pnpm")];

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function bin(name: string): string {
  const override = process.env[`${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_BIN`];
  if (override) return override;
  const dirs = name === "pnpm" ? [...SYSTEM_DIRS, ...PNPM_DIRS] : SYSTEM_DIRS;
  const found = dirs.map((dir) => join(dir, name)).find(executable);
  if (!found) throw new Error(`${name} not found in ${dirs.join(", ")}; set ${name.toUpperCase()}_BIN to its absolute path`);
  return found;
}
