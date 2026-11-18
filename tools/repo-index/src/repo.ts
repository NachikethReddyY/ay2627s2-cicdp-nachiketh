import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bin } from "./bin.ts";

export const INDEX_DIR_NAME = ".repo-index";
const MAX_FILE_BYTES = 200 * 1024;

const SKIPPED_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "uv.lock",
  "poetry.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
]);

const SKIPPED_PATTERNS = [
  /\.lock$/,
  /\.generated\./,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svg|pdf|mp3|mp4|mov|wav|ogg|webm|woff2?|ttf|otf|eot|zip|gz|tgz|tar|7z|wasm|sqlite|db|onnx|bin|glb|gltf|psd)$/i,
];

export type ScannedFile = { path: string; sha256: string; text: string };

export function findRepoRoot(cwd: string): string {
  return execFileSync(bin("git"), ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
}

export function currentHead(root: string): string {
  try {
    return execFileSync(bin("git"), ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function isIndexablePath(path: string): boolean {
  if (path.startsWith(`${INDEX_DIR_NAME}/`)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (SKIPPED_NAMES.has(name)) return false;
  return !SKIPPED_PATTERNS.some((pattern) => pattern.test(path));
}

function gitList(root: string, args: string[]): string[] {
  const output = execFileSync(bin("git"), ["ls-files", "-z", ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return output.split("\0").filter((entry) => entry !== "");
}

export function listCandidatePaths(root: string): string[] {
  const tracked = gitList(root, []);
  const untracked = gitList(root, ["-o", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].filter(isIndexablePath).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function sha256Of(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function readIndexable(root: string, path: string): ScannedFile | null {
  try {
    const absolute = join(root, path);
    const stats = statSync(absolute);
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    const content = readFileSync(absolute);
    if (content.includes(0)) return null;
    return { path, sha256: sha256Of(content), text: content.toString("utf8") };
  } catch {
    return null;
  }
}

export function scanRepo(root: string): ScannedFile[] {
  return listCandidatePaths(root)
    .map((path) => readIndexable(root, path))
    .filter((file): file is ScannedFile => file !== null);
}
