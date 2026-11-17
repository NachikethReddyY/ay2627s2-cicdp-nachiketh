export type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
};

const VALUE_FLAGS = new Set(["tail"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (VALUE_FLAGS.has(name) && i + 1 < rest.length) {
      flags.set(name, rest[i + 1]);
      i += 1;
    } else flags.set(name, true);
  }
  return { command, positionals, flags };
}

export function flagCount(args: ParsedArgs, name: string, fallback: number): number {
  const value = args.flags.get(name);
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} needs a positive integer`);
  return parsed;
}

export function tailLines(text: string, count: number): string {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-count).join("\n");
}
