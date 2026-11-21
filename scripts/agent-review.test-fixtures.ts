import { splitDiff, type Exec } from "./agent-review.ts";

const oldId = "a".repeat(40);
const newId = "b".repeat(40);
const zeroId = "0".repeat(40);
export const indexRecord = `index ${oldId}..${newId} 100644`;
export const addedIndex = `index ${zeroId}..${newId}`;
export const diffHeader = (path: string) => `diff --git a/${path} b/${path}\n${indexRecord}\n--- a/${path}\n+++ b/${path}\n`;

export function sizedPatch(path: string, total: number) {
  const head = diffHeader(path) + "@@ -0,0 +1 @@\n+";
  return head + "x".repeat(total - head.length - 1) + "\n";
}

export function hunk(size: number, mark: string, line: number) {
  const head = `@@ -${line} +${line} @@\n-old\n+${mark}`;
  return head + "y".repeat(size - head.length - 1) + "\n";
}

export const execDiff = (patch: string, calls: string[][] = []): Exec => (file, args) => {
  calls.push([file, ...args]);
  if (file !== "git") return "";
  if (args.includes("rev-parse")) return `sha-${args.at(-1)}\n`;
  if (args.includes("--raw") || args.includes("--numstat")) {
    return splitDiff(patch).map(({ path, patch: body }) => {
      if (args.includes("--raw")) {
        const added = body.includes("\nnew file mode ");
        return `:${added ? "000000" : "100644"} 100644 ${added ? zeroId : oldId} ${newId} ${added ? "A" : "M"}\0${path}\0`;
      }
      const lines = body.slice(body.indexOf("\n@@ ")).split("\n");
      return `${lines.filter((l) => l.startsWith("+")).length}\t${lines.filter((l) => l.startsWith("-")).length}\t${path}\0`;
    }).join("");
  }
  return args.includes("diff") ? patch : "";
};
