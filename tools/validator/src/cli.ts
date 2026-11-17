import { parseArgs } from "./args.ts";
import { browse, CliError, down, envLines, logs, reset, smoke, status, up } from "./commands.ts";
import { layoutFor, repoRoot } from "./state.ts";

const USAGE = `usage: validator <command>
  up [--engine] [--fresh]   start Postgres data, fake-llm, API, web (and engine) and sign in a test learner
  down [--drop]             stop everything, keep the database unless --drop
  status [--json]           show which services are healthy
  logs <service> [--tail N] print a service log
  reset [--hard]            clear learner data, keep seeded lessons
  smoke                     check web, API and a signed-in home call
  browse <args...>          run agent-browser in the validator session; "browse login" opens the app signed in
  env                       print export lines for the URLs`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const layout = layoutFor(repoRoot());
  switch (args.command) {
    case "up":
      return up(layout, args);
    case "down":
      return down(layout, args);
    case "status":
      return status(layout, args);
    case "logs":
      return logs(layout, args);
    case "reset":
      return reset(layout, args);
    case "smoke":
      return smoke(layout);
    case "browse":
      return browse(layout, argv.slice(1));
    case "env":
      return envLines();
    default:
      process.stderr.write(`${USAGE}\n`);
      return args.command === "help" ? 0 : 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`validator: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(error instanceof CliError ? 1 : 2);
  },
);
