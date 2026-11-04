// `node src/gen/main.ts` writes the generated files; `--check` exits 1 if any committed one is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { BLOCKS } from "../core/parse.ts";
import { catalog, jsonSchema } from "./build.ts";

export const OUTPUTS: Record<string, string> = {
  "visual.schema.json": jsonSchema(BLOCKS),
  "visual.catalog.md": catalog(BLOCKS),
};

export const fileUrl = (name: string) => new URL(`../../${name}`, import.meta.url);

const read = (name: string) => {
  try {
    return readFileSync(fileUrl(name), "utf8");
  } catch {
    return undefined;
  }
};

export const stale = (): string[] => Object.keys(OUTPUTS).filter((name) => read(name) !== OUTPUTS[name]);

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const bad = stale();
    if (bad.length) {
      console.error(`stale: ${bad.join(", ")}. Run \`pnpm --filter @learnquest/ui-catalog gen\`.`);
      process.exit(1);
    }
    console.log("generated files are up to date");
  } else {
    for (const [name, body] of Object.entries(OUTPUTS)) writeFileSync(fileUrl(name), body);
    console.log(`wrote ${Object.keys(OUTPUTS).join(", ")}`);
  }
}
