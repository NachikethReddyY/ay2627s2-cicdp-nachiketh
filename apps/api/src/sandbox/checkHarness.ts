// The program that runs inside the sandbox container for one Check (passed to `node -e`).
// It reads {token, language, code, tests: [{stdin}]} as JSON on stdin, runs the code once per test, and prints ONE JSON line:
//   {"token":string,"results":[{"exit":number|null,"timedOut":boolean,"overflow":boolean,"stdout":string,"stderr":string}]}
// The token is a per-check random value the host sends in the stdin JSON and requires back, so a line the learner forges cannot pass.
// The harness runs as root and starts each learner interpreter as uid/gid 1001 through setpriv, so the learner cannot open
// /proc/<harness pid>/fd or read its memory (which holds the token and the hidden test stdin).
// It never sees the expected output: the host classifies the results, so learner code cannot read an answer key from this process.
// The source is a string so it can ship to the container and be unit tested with a fake spawn (see test/sandbox-check.test.ts).

export const TEST_TIMEOUT_MS = 5000;
export const MAX_STDOUT = 4000;
export const MAX_STDERR = 500;
export const TOTAL_MS = 24000; // tests not started by then count as timed out, so the host budget (~30 s) is never overrun

export const HARNESS_SOURCE = String.raw`
const TEST_TIMEOUT_MS = ${TEST_TIMEOUT_MS};
const MAX_STDOUT = ${MAX_STDOUT};
const MAX_STDERR = ${MAX_STDERR};
const TOTAL_MS = ${TOTAL_MS};
const COMMANDS = {
  python: ["python3", ["-I", "-u", "solution.py"], "solution.py"],
  javascript: ["node", ["solution.js"], "solution.js"],
  typescript: ["node", ["solution.ts"], "solution.ts"],
};
// Drops root before exec: uid/gid 1001, no supplementary groups, and no effective, permitted or inheritable capabilities.
// --bounding-set=-all needs CAP_SETPCAP, which the harness does not hold, so the bounding set keeps KILL, SETGID and SETUID.
// That is harmless: the learner cannot raise them, because no-new-privileges is set and its own sets are empty.
const DROP = ["--reuid=1001", "--regid=1001", "--clear-groups", "--inh-caps=-all", "--bounding-set=-all", "--"];

function runOne(deps, cmd, args, cwd, stdin) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    let settled = false;
    let child;
    const done = (exit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit, timedOut, overflow, stdout, stderr });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
      setTimeout(() => done(null), 200); // a child that ignores the kill must not hold the whole check
    }, TEST_TIMEOUT_MS);
    try {
      child = deps.spawn("setpriv", [...DROP, cmd, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: "/tmp", PYTHONDONTWRITEBYTECODE: "1" } });
    } catch {
      return done(null);
    }
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_STDOUT) stdout += d.toString();
      if (stdout.length > MAX_STDOUT) { stdout = stdout.slice(0, MAX_STDOUT); overflow = true; }
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_STDERR) stderr = (stderr + d.toString()).slice(0, MAX_STDERR);
    });
    child.stdin.on("error", () => {});
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
    child.stdin.end(stdin);
  });
}

async function runHarness(deps) {
  const input = JSON.parse(await deps.readStdin());
  const cmd = COMMANDS[input.language];
  if (!cmd) throw new Error("unknown language");
  const dir = "/tmp/work";
  deps.mkdir(dir);
  deps.writeFile(dir + "/" + cmd[2], input.code); // root-owned and world-readable: the learner can run it but not edit it
  const results = [];
  const start = Date.now();
  for (const t of input.tests) {
    if (Date.now() - start > TOTAL_MS) { results.push({ exit: null, timedOut: true, overflow: false, stdout: "", stderr: "" }); continue; }
    results.push(await runOne(deps, cmd[0], cmd[1], dir, String(t.stdin || "")));
  }
  deps.write(JSON.stringify({ token: input.token, results }) + "\n");
}

if (!globalThis.__LQ_HARNESS_TEST__) {
  const fs = require("node:fs");
  runHarness({
    spawn: require("node:child_process").spawn,
    readStdin: () => new Promise((resolve) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => resolve(s)); }),
    mkdir: (d) => fs.mkdirSync(d, { recursive: true, mode: 0o755 }),
    writeFile: (p, c) => fs.writeFileSync(p, c, { mode: 0o644 }),
    write: (s) => process.stdout.write(s, () => process.exit(0)),
  }).catch(() => process.exit(2));
}
`;
