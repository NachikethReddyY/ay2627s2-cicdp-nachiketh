import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cookieHeader, realPost, signInValidator, storageStateOf } from "./auth.ts";
import type { Cookie } from "./auth.ts";
import type { ParsedArgs } from "./args.ts";
import { flagCount, tailLines } from "./args.ts";
import { loginArgs, resolveScreenshotPath, runBrowser, browserArgs } from "./browse.ts";
import {
  assertSafeDatabase,
  canConnect,
  databaseUrl,
  dockerAvailable,
  dropDatabase,
  ensureDatabase,
  postgresStartHint,
  resetLearnerData,
  startDockerPostgres,
} from "./db.ts";
import { foreignPortMessage, judgePort, listenersOnPort, processTree } from "./ports.ts";
import type { ServiceSpec } from "./services.ts";
import { API_ORIGIN, VALIDATOR_EMAIL, VALIDATOR_ENGINE_TOKEN, VALIDATOR_PASSWORD, WEB_ORIGIN, appEnv, serviceSpecs, spawnDetached, stopProcess, isValidatorCommand } from "./services.ts";
import type { Layout, State } from "./state.ts";
import { SERVICE_NAMES, emptyState, ensureLayout, isAlive, readState, removeState, writeState } from "./state.ts";
import { realClock, waitForHttp } from "./wait.ts";
import { bin } from "./bin.ts";

export class CliError extends Error {}

const log = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

function pnpmApi(layout: Layout, script: string, env: Record<string, string>): void {
  execFileSync(bin("pnpm"), ["--filter", "@learnquest/api", "run", script], {
    cwd: layout.root,
    stdio: ["ignore", process.stderr, process.stderr],
    env: { ...process.env, ...env },
  });
}

async function ensurePostgres(layout: Layout, url: string): Promise<void> {
  if (await canConnect(layout.root, url)) return;
  if (dockerAvailable()) {
    log("postgres unreachable, starting it with docker compose");
    startDockerPostgres(layout.root, VALIDATOR_ENGINE_TOKEN);
    if (await canConnect(layout.root, url)) return;
  }
  throw new CliError(postgresStartHint(url));
}

async function stopRecorded(layout: Layout, state: State, names: string[]): Promise<void> {
  for (const name of names) {
    const record = state.services[name as keyof State["services"]];
    if (!record) continue;
    const outcome = await stopProcess(record.pid, realClock, 5000, (command) => command !== null && isValidatorCommand(command, layout.root));
    log(`${name}: ${outcome}`);
    delete state.services[name as keyof State["services"]];
  }
}

function checkPort(spec: ServiceSpec, state: State): "reuse" | "start" {
  const record = state.services[spec.name];
  const alive = record !== undefined && isAlive(record.pid);
  const verdict = judgePort(listenersOnPort(spec.port), alive ? processTree(record.pid) : []);
  if (verdict.kind === "foreign") throw new CliError(foreignPortMessage(spec.port, verdict.owner));
  if (verdict.kind === "ours") return "reuse";
  if (alive) return "reuse";
  return "start";
}

async function waitHealthy(spec: ServiceSpec): Promise<void> {
  const accept = (status: number) => (spec.name === "web" ? status >= 200 && status < 400 : status >= 200 && status < 300);
  const result = await waitForHttp({ url: spec.healthUrl, timeoutMs: spec.timeoutMs, intervalMs: 500, fetch, clock: realClock, accept });
  if (!result.ok) throw new CliError(`${spec.name} did not become healthy at ${spec.healthUrl} (${result.lastError}). See .validator/logs/${spec.name}.log`);
}

async function startServices(layout: Layout, state: State, url: string, engine: boolean): Promise<void> {
  const specs = serviceSpecs(layout.root, url, engine);
  if (state.services.api && state.services.api.engine !== engine) await stopRecorded(layout, state, ["api"]);
  if (!engine) await stopRecorded(layout, state, ["engine"]);
  for (const spec of specs) {
    if (checkPort(spec, state) === "reuse") {
      log(`${spec.name}: reusing pid ${state.services[spec.name]?.pid ?? "unknown"} on port ${spec.port}`);
      continue;
    }
    state.services[spec.name] = spawnDetached(layout, spec, engine);
    writeState(layout, state);
    log(`${spec.name}: started pid ${state.services[spec.name]?.pid} on port ${spec.port}`);
  }
  for (const spec of specs) await waitHealthy(spec);
  state.engine = engine;
  writeState(layout, state);
}

function writeAuthFiles(layout: Layout, cookies: Cookie[]): void {
  writeFileSync(layout.authState, `${JSON.stringify(storageStateOf(cookies), null, 2)}\n`);
  writeFileSync(layout.authCookies, `${JSON.stringify(cookies, null, 2)}\n`);
}

function readCookies(layout: Layout): Cookie[] {
  if (!existsSync(layout.authCookies)) throw new CliError("no saved session; run up first");
  return JSON.parse(readFileSync(layout.authCookies, "utf8")) as Cookie[];
}

function summary(layout: Layout, state: State, url: string): Record<string, unknown> {
  const pids: Record<string, number> = {};
  const logs: Record<string, string> = {};
  for (const [name, record] of Object.entries(state.services)) {
    if (!record) continue;
    pids[name] = record.pid;
    logs[name] = record.log;
  }
  return {
    webUrl: WEB_ORIGIN,
    apiUrl: API_ORIGIN,
    database: url,
    learner: { email: VALIDATOR_EMAIL, password: VALIDATOR_PASSWORD },
    pids,
    logs,
    authState: layout.authState,
    authCookies: layout.authCookies,
  };
}

export async function up(layout: Layout, args: ParsedArgs): Promise<number> {
  const engine = args.flags.has("engine");
  const fresh = args.flags.has("fresh");
  const url = databaseUrl(process.env);
  assertSafeDatabase(url);
  ensureLayout(layout);
  const state = readState(layout) ?? emptyState(url, engine);
  state.database = url;
  await ensurePostgres(layout, url);
  if (fresh) {
    await stopRecorded(layout, state, [...SERVICE_NAMES]);
    log("dropping and recreating the validator database");
    await dropDatabase(layout.root, url);
  }
  if (await ensureDatabase(layout.root, url)) log("created database");
  const env = appEnv(url);
  pnpmApi(layout, "db:migrate", env);
  pnpmApi(layout, "db:seed", env);
  await startServices(layout, state, url, engine);
  const cookies = await signInValidator(realPost, Math.floor(Date.now() / 1000));
  writeAuthFiles(layout, cookies);
  process.stdout.write(`${JSON.stringify(summary(layout, state, url), null, 2)}\n`);
  return 0;
}

export async function down(layout: Layout, args: ParsedArgs): Promise<number> {
  const state = readState(layout);
  if (state) {
    runBrowser(browserArgs(["close"]));
    await stopRecorded(layout, state, [...SERVICE_NAMES].reverse());
    removeState(layout);
  } else log("nothing recorded");
  if (args.flags.has("drop")) {
    const url = databaseUrl(process.env);
    await dropDatabase(layout.root, url);
    log("dropped the validator database");
  }
  return 0;
}

async function serviceHealth(spec: ServiceSpec, state: State) {
  const record = state.services[spec.name];
  if (!record) return { name: spec.name, up: false, healthy: false, url: spec.url, pid: null };
  const up = isAlive(record.pid);
  const result = up ? await waitForHttp({ url: spec.healthUrl, timeoutMs: 1, intervalMs: 1, fetch, clock: realClock, accept: (s) => s < 400 }) : { ok: false };
  return { name: spec.name, up, healthy: result.ok, url: spec.url, pid: record.pid };
}

export async function status(layout: Layout, args: ParsedArgs): Promise<number> {
  const state = readState(layout);
  if (!state) {
    const message = "validator is not running; run up";
    process.stdout.write(args.flags.has("json") ? `${JSON.stringify({ running: false })}\n` : `${message}\n`);
    return 1;
  }
  const specs = serviceSpecs(layout.root, state.database, state.engine).filter((s) => state.services[s.name]);
  const rows = await Promise.all(specs.map((spec) => serviceHealth(spec, state)));
  const allHealthy = rows.length > 0 && rows.every((r) => r.healthy);
  if (args.flags.has("json")) process.stdout.write(`${JSON.stringify({ running: allHealthy, database: state.database, services: rows })}\n`);
  else {
    for (const r of rows) process.stdout.write(`${r.name.padEnd(9)} ${r.healthy ? "healthy" : r.up ? "unhealthy" : "down"}  ${r.url}  pid ${r.pid}\n`);
    process.stdout.write(`database  ${state.database}\n`);
  }
  return allHealthy ? 0 : 1;
}

export function logs(layout: Layout, args: ParsedArgs): number {
  const name = args.positionals[0];
  if (!name) throw new CliError(`usage: logs <${SERVICE_NAMES.join("|")}> [--tail N]`);
  const file = `${layout.logsDir}/${name}.log`;
  if (!existsSync(file)) throw new CliError(`no log for "${name}" at ${file}`);
  process.stdout.write(`${tailLines(readFileSync(file, "utf8"), flagCount(args, "tail", 100))}\n`);
  return 0;
}

export async function reset(layout: Layout, args: ParsedArgs): Promise<number> {
  const url = readState(layout)?.database ?? databaseUrl(process.env);
  if (args.flags.has("hard")) {
    await down(layout, args);
    return up(layout, { ...args, flags: new Map([["fresh", true]]) });
  }
  const tables = await resetLearnerData(layout.root, url);
  log(`truncated ${tables.join(", ")}`);
  return 0;
}

type Check = { name: string; ok: boolean; detail: string };

async function runCheck(name: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await run() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function smoke(layout: Layout): Promise<number> {
  const cookie = cookieHeader(readCookies(layout));
  const expectStatus = async (url: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res;
  };
  const checks = [
    await runCheck("web loads", async () => {
      const html = await (await expectStatus(`${WEB_ORIGIN}/`)).text();
      if (!html.includes("<div id=")) throw new Error("no app root in html");
      return `${WEB_ORIGIN}/ 200`;
    }),
    await runCheck("api health", async () => {
      await expectStatus(`${API_ORIGIN}/api/healthz`);
      return `${API_ORIGIN}/api/healthz 200`;
    }),
    await runCheck("api reachable through the web proxy", async () => {
      await expectStatus(`${WEB_ORIGIN}/api/healthz`);
      return `${WEB_ORIGIN}/api/healthz 200`;
    }),
    await runCheck("signed-in home call", async () => {
      const res = await expectStatus(`${API_ORIGIN}/api/trpc/home.get`, { cookie });
      const body = (await res.json()) as { result?: { data?: unknown } };
      if (!body.result?.data) throw new Error("home.get returned no data");
      return "home.get returned data for the validator learner";
    }),
  ];
  for (const c of checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"} ${c.name}: ${c.detail}\n`);
  return checks.every((c) => c.ok) ? 0 : 1;
}

export function browse(layout: Layout, args: string[]): number {
  if (args[0] === "login") {
    let code = 0;
    for (const step of loginArgs(layout, WEB_ORIGIN)) code = runBrowser(step);
    return code;
  }
  return runBrowser(browserArgs(resolveScreenshotPath(args, process.cwd(), layout.shotsDir, Date.now())));
}

export function envLines(): number {
  process.stdout.write(`export VALIDATOR_WEB_URL=${WEB_ORIGIN} VALIDATOR_API_URL=${API_ORIGIN}\n`);
  return 0;
}
