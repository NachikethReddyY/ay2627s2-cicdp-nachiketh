import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { bin } from "../../../scripts/bin.ts";

const LOCAL_ROLE = "learnquest";

export const DEFAULT_DATABASE_URL = `postgres://${LOCAL_ROLE}:${process.env.VALIDATOR_DB_PASSWORD ?? LOCAL_ROLE}@localhost:5432/learnquest_validator`;

export const LEARNER_DATA_TABLES = [
  "step_progress",
  "attempts",
  "hint_events",
  "mastery",
  "recommendations",
  "game_attempts",
  "game_completions",
  "part_completions",
  "check_results",
  "enrollments",
];

const VALIDATOR_DATABASE_NAME = /^learnquest_validator[a-z0-9_]*$/;

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};
type PgModule = { Client: new (config: { connectionString: string }) => PgClient };

export function databaseUrl(env: Record<string, string | undefined>): string {
  return env.VALIDATOR_DATABASE_URL || DEFAULT_DATABASE_URL;
}

export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`database name "${name}" must match [A-Za-z0-9_]+`);
  return name;
}

export function assertSafeDatabase(url: string): string {
  const name = databaseName(url);
  if (!VALIDATOR_DATABASE_NAME.test(name) || name.endsWith("_test")) {
    throw new Error(`refusing to manage database "${name}"; the validator only manages databases named learnquest_validator or learnquest_validator_<suffix>`);
  }
  return name;
}

export function adminUrl(url: string, env: Record<string, string | undefined> = process.env): string {
  if (env.VALIDATOR_ADMIN_URL) return env.VALIDATOR_ADMIN_URL;
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

export function ownerRole(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function truncateStatement(tables: string[]): string {
  return `TRUNCATE TABLE ${tables.map(quoteIdent).join(", ")} RESTART IDENTITY`;
}

export function postgresStartHint(url: string): string {
  const host = new URL(url).host;
  return `Postgres is not reachable at ${host}. Start it with one of: (1) docker compose up -d --wait postgres (needs ENGINE_TOKEN set to any 40+ char value), (2) brew services start postgresql@16, (3) point VALIDATOR_DATABASE_URL at a running server. The role in the URL must be able to create databases, or set VALIDATOR_ADMIN_URL to a superuser URL such as postgres://you@localhost:5432/postgres.`;
}

export function loadPg(root: string): PgModule {
  return createRequire(join(root, "apps", "api", "package.json"))("pg") as PgModule;
}

async function withClient<T>(root: string, url: string, run: (client: PgClient) => Promise<T>): Promise<T> {
  const pg = loadPg(root);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function canConnect(root: string, url: string): Promise<boolean> {
  try {
    await withClient(root, adminUrl(url), (c) => c.query("SELECT 1"));
    return true;
  } catch {
    return false;
  }
}

export function dockerAvailable(): boolean {
  try {
    execFileSync(bin("docker"), ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export function startDockerPostgres(root: string, engineToken: string): void {
  execFileSync(bin("docker"), ["compose", "up", "-d", "--wait", "postgres"], {
    cwd: root,
    stdio: ["ignore", process.stderr, process.stderr],
    env: { ...process.env, ENGINE_TOKEN: engineToken },
  });
}

export async function ensureDatabase(root: string, url: string): Promise<boolean> {
  const name = assertSafeDatabase(url);
  return withClient(root, adminUrl(url), async (client) => {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rows.length > 0) return false;
    await client.query(`CREATE DATABASE ${quoteIdent(name)} OWNER ${quoteIdent(ownerRole(url))}`);
    return true;
  });
}

export async function dropDatabase(root: string, url: string): Promise<void> {
  const name = assertSafeDatabase(url);
  await withClient(root, adminUrl(url), async (client) => {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [name]);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
  });
}

export async function resetLearnerData(root: string, url: string): Promise<string[]> {
  assertSafeDatabase(url);
  return withClient(root, url, async (client) => {
    const present = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)", [
      LEARNER_DATA_TABLES,
    ]);
    const tables = present.rows.map((r) => String(r.table_name));
    if (tables.length > 0) await client.query(truncateStatement(tables));
    return tables;
  });
}
