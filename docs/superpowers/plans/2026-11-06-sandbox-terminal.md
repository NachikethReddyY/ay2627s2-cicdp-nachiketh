# Sandbox Terminal Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the practice screen's fake terminal with a real xterm.js shell panel, make Run execute the editor file inside that shell, and show the learner's home folder as a read-only tree.

**Architecture:** WP1 adds `PUT /api/sandbox/files/:name` and `GET /api/sandbox/files` (`apps/api/src/sandbox/files.ts`) backed by two new optional `SandboxBackend` methods implemented for Docker and Daytona; they never start a container. WP2 adds a pure-TS WebSocket client with a reconnect state machine (`shellSocket.ts`), a persisted panel reducer (`usePanel.ts`) and lazy-loaded xterm components, mounted in `PracticeView` beside the old Run path. WP3 makes Run write the file and type the command into the shell (`runInShell.ts`) while Check keeps its server-judged one-shot path.

**Tech Stack:** Fastify 5 + zod (API), node-pty / `docker exec`, `@daytonaio/sdk` (narrow views), React 19 + Vite 8, `@xterm/xterm` + `@xterm/addon-fit`, `node --test` with Node 26 type stripping (both apps).

**Spec:** `docs/superpowers/specs/2026-11-06-sandbox-terminal-design.md`

## Corrections to the spec (code wins)

1. **Docker unit tests are not in `sandbox.test.ts`.** That file only tests the WebSocket route with a fake backend. `dockerBackend` unit tests live in `apps/api/test/sec-hardening.test.ts`. This plan puts the new Docker tests in a new `apps/api/test/sandbox-docker.test.ts` using the no-database preamble from `sandbox-run.test.ts`.
2. **`dockerBackend`'s `spawn` option is `node-pty`'s `pty.spawn`, and `exec` is a promisified `execFile` with no stdin.** Neither can carry file content on stdin. The plan adds a third injectable option, `spawnChild?: typeof import("node:child_process").spawn`, used by both `writeFile` and `listDir`.
3. **`find -printf '%y\t%s\t%f\n'` breaks on names that contain a newline.** The plan uses `'%y\t%s\t%f\0'` (NUL-terminated records) and the parser splits on `\0`.
4. **`learnerFor` is a closure inside `sandboxRunRoute` and is not exported.** The spec makes `run.ts` a non-goal, so `files.ts` defines its own guard with identical answers (503 `unavailable`, 401 `unauthorized`). `run.ts` is not touched.
5. **A browser `WebSocket` cannot see the HTTP status of a refused upgrade.** A refused handshake surfaces only as `close` with code 1006. To tell 503 (disabled) and 401 (signed out) apart, `shellSocket` probes `GET /api/sandbox/files` after a close that never reached `open`: 503 → disabled, 401 → signed out, anything else (including 404 before WP1 lands) → normal backoff. `/api/sandbox/shell` is not usable as a probe: it checks Origin before auth, and browsers omit Origin on same-origin GETs.
6. **`ready: Promise<void>` cannot describe a socket that reconnects.** A resolved promise stays resolved after a drop, so Run would type into a dead socket. The plan exposes `whenReady(timeoutMs)`, which resolves once the *current* connection has produced output.
7. **Close code 4000 ("replaced") is not in the spec's state machine.** The same lesson open in two browser tabs uses tab id `practice` twice, and each reconnect would replace the other forever. The plan treats 4000 as terminal (`closed("replaced")`) with a "Try again" button and no automatic retry.
8. **`practiceActions` cannot be exported from `PracticeView.tsx` and still be tested.** The web test runner loads `.ts` only. It lives in `apps/web/src/player/live/practiceActions.ts`, with its test beside it (`practiceActions.test.ts`, not `src/player/practiceView.test.ts`).
9. **Check needs its input line.** `run.ts` gives a Check 60 s "long enough for a learner to type answers", and the current input form is shown for Check runs too. A read-only Check block would hang every `input()` lesson until the timeout. The one-shot block (Check, plus Run when the sandbox is off) keeps the one-line input and a Stop button.
10. **`listFiles` is needed in WP2, not WP3.** `FileTree` (WP2) calls `GET /api/sandbox/files`. `listFiles` lands in Task 6 and `putFile` in Task 7. Both go in `runPython.ts`, whose private `call` is widened to take a full path.
11. **`getUserHomeDir()` returns `Promise<string | undefined>`** in the installed SDK. When it returns `undefined`, the plan falls back to `/home/learner`, which matches Docker. The SDK `FileInfo` has `isDir`, `size` and `mode` and no symlink flag, so a Daytona entry is a `link` when `mode` starts with `L` (Go `FileMode` string).
12. **`resize(px)` needs the container height** to clamp to 70 %. The action is `{ type: "resize", px, container }`.
13. **A missing directory is not covered by the spec.** `listDir` returns `null` when `dir` does not exist or is not a directory, and the route answers `404 not_found`. Without this, a stale tree would surface as a 500.
14. **16 KiB `bodyLimit` versus "anything that can be Checked can be Run".** `run.ts` uses Fastify's default 1 MiB limit. JSON escapes a control character to 6 bytes, so 4000 such characters (about 24 KB) are valid for Check but get 413 here. Normal code fits: 4000 three-byte characters are 12 KB. The plan keeps 16 KiB as specified and pins that 4000 CJK characters pass. The control-character case is listed for the owner's decision.

## Global Constraints

- `content` ≤ `MAX_CODE` = **4000** characters (import `MAX_CODE` from `apps/api/src/sandbox/run.ts`; do not redefine it).
- File names: exactly **`solution.py`** or **`solution.js`** (allowlist, not a pattern).
- `dir`: up to **4** segments joined by `/`, each `^[A-Za-z0-9._-]{1,64}$`, never `.` or `..`; else 400.
- Listing: ≤ **200** entries, ≤ **64 KiB** read from `find` stdout, names truncated to **64** characters.
- Rate limits: **30 writes** and **60 lists** per learner per minute (fixed window), `429 rate_limited`. At most one backend file call per learner at a time.
- PUT route `bodyLimit`: **16 KiB** (`16 * 1024`). WebSocket `maxPayload` stays 64 KiB.
- Error bodies: `409 { error: { code: "no_shell", message: "Open the terminal first" } }`; `501` when the backend lacks the methods.
- Panel height: min **120 px**, max **70 %** of the code window; default **240 px**; keyboard step **16 px**. Storage key **`lq.terminal`**.
- Shell tab id: **`practice`**. URL `/api/sandbox/shell?tab=practice&cols=…&rows=…`.
- Close codes **4029** (too many tabs) and **4503** (server busy): no auto retry. Backoff **1, 2, 4, 8, 15 s, then every 15 s**, only while the panel is open.
- Run: ready budget **15 s**; `\x03`, wait **100 ms**, then `cd ~ && python3 solution.py\r` or `cd ~ && node solution.js\r`.
- Resize debounce **100 ms**. File tree width **180 px**, hidden below **640 px** wide.
- Answers never reach the client: Run never sends `lessonId`; Check's request and response shapes are unchanged.
- No auth, deployment, CSP or `vercel.json` changes. No new personal data. Writes and lists run as uid 1001 (Docker), never root.
- Commits: Conventional Commits, `type(scope): description`, body wrapped at 72 characters. End each message with the trailer `Co-Authored-By: <name of the model that wrote the change>` with no email address and no Claude Code footer.
- Before any push run `TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test pnpm exec turbo run lint test build` (set your own port, such as 5433, if your test Postgres runs elsewhere). Do not push on partial checks.

## Review Focus

1. **The same lesson in two browser windows.** Both use tab `practice`, so each reconnect replaces the other in an endless loop. Expected: the window that gets close code 4000 stops and shows "The terminal is open in another window" with a Try again button. Pinned in Task 4.
2. **Run during a reconnect, or after the shell exited.** Expected: Run waits for the new connection's first output (up to 15 s) and never types into a dead socket. Pinned in Task 4 (`whenReady` after a drop) and Task 7.
3. **File names with a tab, a newline, spaces or non-ASCII characters** in `~`. Expected: they list correctly and do not shift or split rows. Pinned in Task 2.
4. **Expanding a folder that was deleted from the shell, or a path that is a file.** Expected: 404, and the tree shows "Could not list files" for that folder only, not a 500. Pinned in Tasks 1 and 2.
5. **A corrupted or out-of-range `lq.terminal` value** (non-JSON, `height: -5`, `height: 99999`, `open: "yes"`), or a smaller window than last time. Expected: defaults or a clamped height, never a broken layout. Pinned in Task 5.

---

## Dependency map and models

| Task | Depends on | Parallel with | Model |
|---|---|---|---|
| 1 API contract + files route | none | 4, 5 | sonnet |
| 2 Docker writeFile/listDir | 1 | 3, 4, 5 | sonnet |
| 3 Daytona writeFile/listDir + README | 1 | 2, 4, 5 | sonnet |
| 4 shellSocket + deps + Vite ws | none | 1, 2, 3, 5 | sonnet |
| 5 usePanel reducer + toggle key | none | 1–4 | sonnet |
| 6 Panel UI, FileTree, mount in PracticeView | 4, 5 | 2, 3 | sonnet |
| 7 putFile + runInShell | 4 (types), 1 (contract) | none | sonnet |
| 8 Run integration in PracticeView + docs | 6, 7 | none | sonnet |
| 9 Manual verification + full CI | all | none | haiku |

WP1 = Tasks 1–3, WP2 = Tasks 4–6, WP3 = Tasks 7–8. WP1 and WP2 are independent and can be built and merged in either order.

---

### Task 1: Backend contract and files route (WP1)

**Files:**
- Modify: `apps/api/src/sandbox/backend.ts` (types, error, optional methods)
- Create: `apps/api/src/sandbox/files.ts`
- Modify: `apps/api/src/app.ts` (import and `api.register(sandboxFilesRoute)` after `api.register(sandboxRunRoute)` at line 100)
- Test: `apps/api/test/sandbox-files.test.ts` (new)

**Interfaces:**
- Consumes: `resolveLearnerId(headers)` from `apps/api/src/auth/guards.ts`; `MAX_CODE` from `apps/api/src/sandbox/run.ts`; `getBackend()`/`setBackend()` from `backend.ts`; `signUp(app, email?)` from `apps/api/test/helpers.ts`.
- Produces (in `backend.ts`):
  ```ts
  export const SANDBOX_FILES = ["solution.py", "solution.js"] as const;
  export type SandboxFileName = (typeof SANDBOX_FILES)[number];
  export type DirEntry = { name: string; type: "file" | "dir" | "link" | "other"; size: number };
  export type DirListing = { entries: DirEntry[]; truncated: boolean };
  export const LIST_MAX_ENTRIES = 200;
  export class SandboxNotRunningError extends Error {}   // message "no running shell"
  // on SandboxBackend:
  writeFile?(learnerId: string, name: SandboxFileName, content: string): Promise<void>;
  /** relDir is "" for home or a validated "a/b"; null when it does not exist or is not a directory. */
  listDir?(learnerId: string, relDir: string): Promise<DirListing | null>;
  ```
- Produces (in `files.ts`): `export async function sandboxFilesRoute(app: FastifyInstance): Promise<void>`; `export function parseDir(raw: unknown): string | null` (`""` for absent/empty, `null` for invalid).

- [ ] **Step 1: Write the failing tests** in `apps/api/test/sandbox-files.test.ts`

Shape: `buildApp()`, `env.SANDBOX_ENABLED = true`, `after(() => { setBackend(null); return app.close(); })`. A `fakeFiles(opts?: { throwNotRunning?: boolean; entries?: number; missing?: boolean; omit?: boolean })` calls `setBackend({ openShell: async () => { throw new Error("unused"); }, writeFile, listDir })` and records `{ writes: {learnerId,name,content}[], lists: {learnerId,relDir}[] }`. `put(cookie, name, body, origin = env.PUBLIC_ORIGIN)` and `list(cookie, dir?)` wrap `app.inject`.

```ts
test("signed out is 401 and a disabled sandbox is 503", async () => {
  fakeFiles();
  assert.equal((await put("", "solution.py", { content: "x" })).statusCode, 401);
  assert.equal((await list("")).statusCode, 401);
  env.SANDBOX_ENABLED = false;
  try { assert.equal((await list(await signUp(app))).statusCode, 503); } finally { env.SANDBOX_ENABLED = true; }
});

test("only the two allowlisted names can be written", async () => {
  const cookie = await signUp(app); const f = fakeFiles();
  for (const n of ["main.py", "solution.PY", "..%2fsolution.py", "%2e%2e", ".bashrc", "solution.py.bak"])
    assert.equal((await put(cookie, n, { content: "x" })).statusCode, 400, n);
  assert.equal((await put(cookie, "solution.js", { content: "console.log(1)" })).statusCode, 204);
  assert.deepEqual(f.writes.map((w) => w.name), ["solution.js"]);
});

test("dir must be up to 4 safe segments", async () => {
  const cookie = await signUp(app); const f = fakeFiles();
  for (const d of ["..", "a/../b", "/etc", "%2e%2e", "a//b", "a/b/c/d/e", "a b", "x".repeat(65), "."])
    assert.equal((await list(cookie, d)).statusCode, 400, d);
  assert.equal((await list(cookie, "a/b.c/d_e/f-g")).statusCode, 200);
  assert.equal((await list(cookie)).statusCode, 200);
  assert.deepEqual(f.lists.map((l) => l.relDir), ["a/b.c/d_e/f-g", ""]);
});

test("content over MAX_CODE is 400; 4000 three-byte characters fit the body limit", async () => {
  const cookie = await signUp(app); fakeFiles();
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(4001) })).statusCode, 400);
  assert.equal((await put(cookie, "solution.py", { content: "界".repeat(4000) })).statusCode, 204);
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(17 * 1024) })).statusCode, 413);
});

test("a foreign origin is 403 on PUT", async () => {
  fakeFiles();
  assert.equal((await put(await signUp(app), "solution.py", { content: "x" }, "https://evil.example")).statusCode, 403);
});

test("no running shell is 409 no_shell; a backend without the methods is 501", async () => {
  const cookie = await signUp(app);
  fakeFiles({ throwNotRunning: true });
  const r = await put(cookie, "solution.py", { content: "x" });
  assert.equal(r.statusCode, 409);
  assert.deepEqual(r.json(), { error: { code: "no_shell", message: "Open the terminal first" } });
  assert.equal((await list(cookie)).statusCode, 409);
  fakeFiles({ omit: true });
  assert.equal((await list(cookie)).statusCode, 501);
});

test("a missing directory is 404", async () => {           // Review Focus 4
  fakeFiles({ missing: true });
  assert.equal((await list(await signUp(app), "gone")).statusCode, 404);
});

test("the 31st write and the 61st list in a minute are 429", async () => {
  const cookie = await signUp(app); fakeFiles();
  for (let i = 0; i < 30; i++) assert.equal((await put(cookie, "solution.py", { content: "x" })).statusCode, 204);
  assert.equal((await put(cookie, "solution.py", { content: "x" })).statusCode, 429);
  for (let i = 0; i < 60; i++) assert.equal((await list(cookie)).statusCode, 200);
  assert.equal((await list(cookie)).statusCode, 429);
});

test("each learner's calls carry only their own id", async () => {
  const a = await signUp(app), b = await signUp(app, "files-b@example.com"); const f = fakeFiles();
  await put(a, "solution.py", { content: "a" }); await put(b, "solution.py", { content: "b" });
  assert.equal(new Set(f.writes.map((w) => w.learnerId)).size, 2);
  assert.notEqual(f.writes[0]!.learnerId, f.writes[1]!.learnerId);
});

test("a listing is capped at 200 entries and names at 64 characters", async () => {
  fakeFiles({ entries: 250 });                                 // fake names are "f".repeat(80)+i
  const body = (await list(await signUp(app))).json();
  assert.equal(body.entries.length, 200);
  assert.equal(body.truncated, true);
  assert.ok(body.entries.every((e: { name: string }) => e.name.length <= 64));
});

test("a learner's backend calls run one at a time", async () => {
  // fake writeFile awaits a 20 ms timer and tracks max in-flight per learner
  const cookie = await signUp(app); const f = fakeFiles();
  await Promise.all([1, 2, 3].map(() => put(cookie, "solution.py", { content: "x" })));
  assert.equal(f.maxInFlight, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test node --test test/sandbox-files.test.ts`
Expected: FAIL. TypeScript-stripped import of `SandboxNotRunningError`/routes missing → `404` instead of `401`/`204` (route not registered) and `SyntaxError: ... does not provide an export named 'SandboxNotRunningError'`.

- [ ] **Step 3: Implement the contract in `backend.ts`** (exports listed under Produces).

- [ ] **Step 4: Implement `sandboxFilesRoute(app)` and `parseDir(raw)` in `files.ts`; register it in `app.ts`**

Order per request: guard (503/401) → per-learner fixed window (`Map<string, { start: number; n: number }>` per kind, 60 000 ms) → validate (zod body `{ content: z.string().max(MAX_CODE) }`, name in `SANDBOX_FILES`, `parseDir`) → backend method present else 501 `{ code: "not_implemented" }` → run inside a per-learner promise chain (`Map<string, Promise<unknown>>`, entry deleted when the chain is idle) → map `SandboxNotRunningError` to 409, `null` listing to 404 `not_found`, rethrow anything else. The route caps `entries` at `LIST_MAX_ENTRIES` (sets `truncated`) and slices names to 64. PUT route options: `{ bodyLimit: 16 * 1024 }`. PUT answers `reply.status(204).send()`.

- [ ] **Step 5: Run to verify it passes**

Run: same command as Step 2, then `node --test test/sandbox-run.test.ts test/sandbox.test.ts` (Check untouched).
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sandbox/backend.ts apps/api/src/sandbox/files.ts apps/api/src/app.ts apps/api/test/sandbox-files.test.ts
git commit -m "feat(api): add sandbox file write and list endpoints (LQ-39)"
```

---

### Task 2: Docker backend `writeFile` and `listDir` (WP1)

**Files:**
- Modify: `apps/api/src/sandbox/docker.ts` (extract `containerName`, add `spawnChild` option, two methods, a running check)
- Test: `apps/api/test/sandbox-docker.test.ts` (new; no-DB preamble copied from `sandbox-run.test.ts` lines 1–4)

**Interfaces:**
- Consumes: Task 1's `SandboxNotRunningError`, `SandboxFileName`, `DirListing`, `LIST_MAX_ENTRIES`.
- Produces:
  ```ts
  export function containerName(learnerId: string): string   // `lq-sbx-${sha256(learnerId).hex.slice(0, 32)}`; openShell uses it
  export function parseFindOutput(out: string, max: number): DirListing   // NUL-separated `%y\t%s\t%f` records
  // new dockerBackend option:
  spawnChild?: typeof import("node:child_process").spawn
  ```

- [ ] **Step 1: Write the failing tests**

Setup: `exec` fake that answers `inspect` with `{ stdout: "true\n" }` and records args; `spawn` (pty) fake as in `sec-hardening.test.ts` line 75; `spawnChild` fake returning an `EventEmitter` with `stdout`, `stdin: Writable` (records chunks), `kill`, and a scripted `close` code / stdout. Call `await backend.openShell("learner-a", {cols: 80, rows: 24})` first so the container is in `live`.

```ts
test("writeFile passes argv exactly and the content only on stdin", async () => {
  await b.writeFile!("learner-a", "solution.py", "print('$(rm -rf ~)')\n");
  assert.deepEqual(child.calls[0]!.args, ["exec", "-i", "-u", "1001", containerName("learner-a"),
    "sh", "-c", 'cat > "$1"', "sh", "/home/learner/solution.py"]);
  assert.equal(child.calls[0]!.stdin, "print('$(rm -rf ~)')\n");
  assert.ok(!child.calls[0]!.args.some((a) => a.includes("rm -rf")));
});

test("listDir runs find as uid 1001 and parses names with spaces, tabs, newlines and non-ASCII", async () => {   // Review Focus 3
  child.next({ code: 0, stdout: "d\t4096\tmy dir\0f\t12\ta\tb.py\0f\t3\tline\nbreak\0l\t7\tlink\0p\t0\tfifo\0f\t5\tnaïve.py\0" });
  const r = await b.listDir!("learner-a", "proj");
  assert.deepEqual(child.calls.at(-1)!.args, ["exec", "-u", "1001", containerName("learner-a"),
    "find", "-P", "/home/learner/proj", "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\\t%s\\t%f\\0"]);
  assert.deepEqual(r!.entries, [
    { name: "my dir", type: "dir", size: 4096 }, { name: "a\tb.py", type: "file", size: 12 },
    { name: "line\nbreak", type: "file", size: 3 }, { name: "link", type: "link", size: 7 },
    { name: "fifo", type: "other", size: 0 }, { name: "naïve.py", type: "file", size: 5 }]);
  assert.equal(r!.truncated, false);
});

test("home lists /home/learner itself", async () => {
  child.next({ code: 0, stdout: "" });
  await b.listDir!("learner-a", "");
  assert.ok(child.calls.at(-1)!.args.includes("/home/learner"));
});

test("a missing or non-directory path is null, not an error", async () => {   // Review Focus 4
  child.next({ code: 1, stdout: "", stderr: "find: '/home/learner/gone': No such file or directory" });
  assert.equal(await b.listDir!("learner-a", "gone"), null);
});

test("output past 200 records or 64 KiB is truncated and the process is killed", async () => {
  child.next({ code: 0, stdout: Array.from({ length: 300 }, (_, i) => `f\t1\tn${i}\0`).join("") });
  const r = await b.listDir!("learner-a", "");
  assert.equal(r!.entries.length, 200); assert.equal(r!.truncated, true);
  child.next({ code: null, stdout: "f\t1\t" + "x".repeat(70 * 1024) });
  assert.equal((await b.listDir!("learner-a", ""))!.truncated, true);
  assert.equal(child.calls.at(-1)!.killed, true);
});

test("both methods throw SandboxNotRunningError and never start a container", async () => {
  await assert.rejects(b.writeFile!("learner-z", "solution.py", "x"), SandboxNotRunningError);   // not in live
  inspectState = "false";
  await assert.rejects(b.listDir!("learner-a", ""), SandboxNotRunningError);                     // live but stopped
  assert.equal(cmds.filter((c) => c.startsWith("run ") || c.startsWith("start ")).length, 1, "only the initial openShell started a container");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && node --test test/sandbox-docker.test.ts`
Expected: FAIL with `does not provide an export named 'containerName'`.

- [ ] **Step 3: Implement in `docker.ts`**

`containerName(learnerId)`; `openShell` uses it. `spawnChild` defaults to `node:child_process` `spawn`. A private `isRunning(name): Promise<boolean>` = `live.has(name)` and `docker inspect -f {{.State.Running}}` is `"true"`. A private `pipe(args: string[], input?: string): Promise<{ code: number | null; stdout: string; capped: boolean }>` collects stdout up to 64 KiB, then kills the child and marks `capped`. `writeFile` rejects on a non-zero exit. `listDir` returns `null` on exit ≠ 0 with empty stdout. `parseFindOutput(out, LIST_MAX_ENTRIES)` splits on `\0`, drops the last partial record when `capped`, splits each record on the first two `\t` only, and maps `%y`: `f`→file, `d`→dir, `l`→link, anything else→other.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && node --test test/sandbox-docker.test.ts && TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test node --test test/sec-hardening.test.ts`
Expected: PASS (`sec-hardening` proves `openShell` behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sandbox/docker.ts apps/api/test/sandbox-docker.test.ts
git commit -m "feat(api): write and list learner files in the docker sandbox"
```

---

### Task 3: Daytona backend `findShell`, `writeFile`, `listDir`, README (WP1)

**Files:**
- Modify: `apps/api/src/sandbox/daytona.ts` (narrow views, `findShell`, two methods, home cache)
- Modify: `apps/api/test/sandbox-daytona.test.ts` (extend the `fake()` `mk` with `getUserHomeDir` and `fs.listFiles`; new tests)
- Modify: `services/sandbox/README.md` (new "## File endpoint" section: routes, limits, 409/501 meaning, uid 1001, no container start)

**Interfaces:**
- Consumes: Task 1's types and error; existing `learnerHash`, `APP_LABEL`.
- Produces on `DaytonaSandbox`:
  ```ts
  getUserHomeDir(): Promise<string | undefined>;
  fs: { uploadFile(file: Buffer, remotePath: string): Promise<void>;
        listFiles(path: string): Promise<Array<{ name: string; isDir: boolean; size: number; mode: string }>> };
  ```
  Internal `findShell(learnerId): Promise<DaytonaSandbox>` throws `SandboxNotRunningError` when there is no sandbox or its `state !== "started"`.

- [ ] **Step 1: Write the failing tests** (append to `sandbox-daytona.test.ts`; the fake gains `opts.home?: string | undefined`, `opts.files?`, `opts.listStatus?: number`, and `log.homeCalls`)

```ts
test("writeFile uploads to <home>/solution.py and never creates a sandbox", async () => {
  const f = fake({ existing: [{ state: "started" }], home: "/home/daytona" });
  const b = daytonaBackend({ client: f.client });
  await b.writeFile!("learner-1", "solution.py", "print(1)");
  await b.writeFile!("learner-1", "solution.js", "1");
  assert.deepEqual(f.log.uploaded, ["/home/daytona/solution.py", "/home/daytona/solution.js"]);
  assert.equal(f.log.created.length, 0);
  assert.equal(f.log.homeCalls, 1, "home is cached per sandbox id");
});

test("no sandbox, or one that is not started, is SandboxNotRunningError and nothing is created or started", async () => {
  for (const existing of [[], [{ state: "stopped" }], [{ state: "starting" }]]) {
    const f = fake({ existing });
    const b = daytonaBackend({ client: f.client });
    await assert.rejects(b.writeFile!("learner-1", "solution.py", "x"), SandboxNotRunningError);
    await assert.rejects(b.listDir!("learner-1", ""), SandboxNotRunningError);
    assert.equal(f.log.created.length + f.log.started, 0);
  }
});

test("listDir maps FileInfo, falls back to /home/learner, and returns null on 404", async () => {
  const f = fake({ existing: [{ state: "started" }], home: undefined,
    files: [{ name: "d", isDir: true, size: 0, mode: "drwxr-xr-x" }, { name: "a.py", isDir: false, size: 3, mode: "-rw-r--r--" },
            { name: "l", isDir: false, size: 1, mode: "Lrwxrwxrwx" }] });
  const b = daytonaBackend({ client: f.client });
  assert.deepEqual((await b.listDir!("learner-1", "proj"))!.entries,
    [{ name: "d", type: "dir", size: 0 }, { name: "a.py", type: "file", size: 3 }, { name: "l", type: "link", size: 1 }]);
  assert.equal(f.log.listedPaths.at(-1), "/home/learner/proj");
  const g = fake({ existing: [{ state: "started" }], listStatus: 404 });
  assert.equal(await daytonaBackend({ client: g.client }).listDir!("learner-1", "gone"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && node --test test/sandbox-daytona.test.ts`
Expected: FAIL with `TypeError: b.writeFile is not a function` (and `tsc` errors on the fake until the views are extended).

- [ ] **Step 3: Implement in `daytona.ts`**

Extend the views. `findShell` lists by `{ ...APP_LABEL, role: SHELL_ROLE, learner: learnerHash(learnerId) }` and takes the first. Keep a `Map<string, string>` of home by sandbox id (`(await sbx.getUserHomeDir()) ?? "/home/learner"`). `writeFile` calls `sbx.fs.uploadFile(Buffer.from(content), `${home}/${name}`)`. `listDir` calls `sbx.fs.listFiles(relDir ? `${home}/${relDir}` : home)`, maps `mode.startsWith("L")`→link, `isDir`→dir, else file, caps at `LIST_MAX_ENTRIES`, and returns `null` when the thrown error has `statusCode === 404` (duck-typed, so the SDK is not imported).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && node --test test/sandbox-daytona.test.ts && pnpm --filter @learnquest/api lint`
Expected: PASS, and `tsc --noEmit` clean.

- [ ] **Step 5: Check against a real Daytona sandbox (spec open risk) and record the result in the PR**

With `SANDBOX_BACKEND=daytona` and a real key, open a shell, then `PUT /api/sandbox/files/solution.py`. In the shell, run `pwd; ls -l ~/solution.py; id`. Expected: the shell's `~` equals the upload directory, the file is listed, and its owner is noted. If the owner is not the shell user, record it as a follow-up.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sandbox/daytona.ts apps/api/test/sandbox-daytona.test.ts services/sandbox/README.md
git commit -m "feat(api): write and list learner files in daytona sandboxes"
```

---

### Task 4: Shell socket client, dependencies, Vite WebSocket proxy (WP2)

**Files:**
- Modify: `apps/web/package.json` (`pnpm --filter @learnquest/web add @xterm/xterm @xterm/addon-fit`; commit the lockfile)
- Modify: `apps/web/vite.config.ts` (`const proxy = { "/api": { target: "http://localhost:3000", ws: true } };`)
- Create: `apps/web/src/player/terminal/shellSocket.ts`
- Test: `apps/web/src/player/terminal/shellSocket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CloseReason = "disabled" | "signed_out" | "too_many_tabs" | "busy" | "replaced";
  export type ShellState =
    | { kind: "idle" } | { kind: "connecting" } | { kind: "open"; ready: boolean }
    | { kind: "reconnecting"; attempt: number; inMs: number } | { kind: "paused" }
    | { kind: "exited"; code: number } | { kind: "closed"; reason: CloseReason; message: string };
  export const BACKOFF_MS: readonly number[];          // [1000, 2000, 4000, 8000, 15000]
  export function backoffMs(attempt: number): number;   // attempt ≥ 4 → 15000
  export function shellUrl(loc: { protocol: string; host: string }, cols: number, rows: number): string;
  export class ShellNotReadyError extends Error { constructor(readonly why: "timeout" | CloseReason | "exited") }
  export interface ShellSocket {
    connect(cols: number, rows: number): void;    // no-op unless idle/closed/exited
    send(data: string): void;                     // binary frame (TextEncoder); dropped unless open. "\r" while exited reconnects.
    resize(cols: number, rows: number): void;     // {type:"resize",cols,rows} text frame when open
    whenReady(timeoutMs: number): Promise<void>;  // current connection open AND first output seen
    setActive(active: boolean): void;             // false: a drop goes to "paused", no retries; true resumes
    onOutput(cb: (bytes: Uint8Array) => void): () => void;
    onState(cb: (s: ShellState) => void): () => void;
    state(): ShellState;
    dispose(): void;
  }
  export function createShellSocket(deps?: Partial<{
    WebSocket: new (url: string) => WebSocket; location: { protocol: string; host: string };
    probe: () => Promise<number>;     // default: fetch("/api/sandbox/files", { credentials: "include" }).then(r => r.status)
  }>): ShellSocket;
  ```

- [ ] **Step 1: Write the failing tests** (fake `WebSocket` class with `static last`, `sent: (string | Uint8Array)[]`, `binaryType`, `open()`, `msg(data)`, `close(code)` helpers; `t.mock.timers.enable({ apis: ["setTimeout"] })`)

```ts
test("URL, binary keystrokes and resize frames", () => {
  assert.equal(shellUrl({ protocol: "https:", host: "x.dev" }, 100, 30), "wss://x.dev/api/sandbox/shell?tab=practice&cols=100&rows=30");
  assert.equal(shellUrl({ protocol: "http:", host: "localhost:5173" }, 80, 24), "ws://localhost:5173/api/sandbox/shell?tab=practice&cols=80&rows=24");
  const s = createShellSocket({ WebSocket: FakeWS, location }); s.connect(80, 24); FakeWS.last.open();
  assert.equal(FakeWS.last.binaryType, "arraybuffer");
  s.send("ls\r"); s.resize(120, 40);
  assert.deepEqual(new TextDecoder().decode(FakeWS.last.sent[0] as Uint8Array), "ls\r");
  assert.deepEqual(JSON.parse(FakeWS.last.sent[1] as string), { type: "resize", cols: 120, rows: 40 });
});

test("nothing connects until connect() is called", () => {
  createShellSocket({ WebSocket: FakeWS, location }); assert.equal(FakeWS.count, 0);
});

test("backoff is 1, 2, 4, 8, 15, 15 s while active", (t) => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffMs), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  // open then drop with 1006 after open → reconnecting; each tick(backoffMs(n)) creates exactly one new FakeWS
});

test("no retry on 4029, 4503 or 4000; the server's message is kept", (t) => {   // Review Focus 1 (4000)
  for (const [code, reason] of [[4029, "too_many_tabs"], [4503, "busy"], [4000, "replaced"]] as const) {
    const s = createShellSocket({ WebSocket: FakeWS, location }); s.connect(80, 24); FakeWS.last.open();
    FakeWS.last.msg(JSON.stringify({ type: "error", message: "At most 2 terminals at once" })); FakeWS.last.close(code);
    assert.equal(s.state().kind, "closed"); assert.equal((s.state() as { reason: string }).reason, reason);
    t.mock.timers.tick(60_000); /* no new FakeWS */
  }
});

test("a refused handshake probes the files endpoint: 503 disabled, 401 signed out, 404 retries", async () => {
  // close(1006) without open(); probe resolves 503 → closed("disabled"); 401 → closed("signed_out"); 404 → reconnecting
});

test("whenReady waits for the current connection's first output, including after a drop", async (t) => {   // Review Focus 2
  const s = createShellSocket({ WebSocket: FakeWS, location }); s.connect(80, 24); FakeWS.last.open();
  FakeWS.last.msg(new TextEncoder().encode("$ ").buffer); await s.whenReady(15_000);
  FakeWS.last.close(1006);                                  // drop after open → reconnecting
  let done = false; const p = s.whenReady(15_000).then(() => (done = true));
  t.mock.timers.tick(1000); FakeWS.last.open(); await Promise.resolve(); assert.equal(done, false, "open is not ready");
  FakeWS.last.msg(new TextEncoder().encode("$ ").buffer); await p; assert.equal(done, true);
});

test("whenReady rejects on timeout, on a terminal close and when exited", async () => {
  // timeout → ShellNotReadyError("timeout"); closed(disabled) → ShellNotReadyError("disabled"); {type:"exit"} → "exited"
});

test("exit frame then Enter reconnects", () => {
  // msg({type:"exit",code:0}) → state exited; send("\r") → a new FakeWS is created
});

test("inactive panel pauses retries and resumes on setActive(true)", () => {
  // setActive(false); close(1006) → state paused, tick(60s) creates nothing; setActive(true) → connecting
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/web exec node --test src/player/terminal/shellSocket.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND ... shellSocket.ts`.

- [ ] **Step 3: Implement `createShellSocket` and the helpers in `shellSocket.ts`**

Use only the `WebSocket` type and `TextEncoder` (no other DOM types). A connection "opened" flag decides between probing (close before `onopen`) and backoff (close after `onopen`). Text frames: `{type:"error"}` stores the message, `{type:"exit"}` moves to `exited`. Binary frames go to the output callbacks and mark the connection ready. `dispose()` closes with code 1000, clears timers and rejects pending `whenReady`.

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/src/player/terminal/shellSocket.ts apps/web/src/player/terminal/shellSocket.test.ts
git commit -m "feat(web): add sandbox shell socket client with reconnect (LQ-80)"
```

---

### Task 5: Panel reducer, storage and toggle key (WP2)

**Files:**
- Create: `apps/web/src/player/terminal/usePanel.ts`
- Test: `apps/web/src/player/terminal/usePanel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PANEL_KEY = "lq.terminal"; export const MIN_HEIGHT = 120; export const MAX_FRACTION = 0.7;
  export const DEFAULT_HEIGHT = 240; export const KEY_STEP = 16;
  export type PanelState = { open: boolean; height: number; everOpened: boolean };
  export type PanelAction = { type: "toggle" } | { type: "open" } | { type: "close" } | { type: "resize"; px: number; container: number };
  export function clampHeight(px: number, container: number): number;   // [120, max(120, 0.7*container)], NaN → DEFAULT_HEIGHT
  export function panelReducer(s: PanelState, a: PanelAction): PanelState;  // open/toggle-to-open sets everOpened
  export function loadPanel(store: Pick<Storage, "getItem"> | undefined): PanelState;
  export function savePanel(store: Pick<Storage, "setItem"> | undefined, s: PanelState): void;  // stores { open, height }
  export function isToggleKey(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code">): boolean;  // Ctrl + code "Backquote", no other modifiers
  export function usePanel(containerRef: RefObject<HTMLElement | null>): { state: PanelState; dispatch: Dispatch<PanelAction> };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("toggle, open and close; opening marks everOpened", () => {
  let s = panelReducer({ open: false, height: 240, everOpened: false }, { type: "toggle" });
  assert.deepEqual(s, { open: true, height: 240, everOpened: true });
  s = panelReducer(s, { type: "close" }); assert.deepEqual(s, { open: false, height: 240, everOpened: true });
});

test("resize clamps to 120 px and 70 % of the container", () => {
  const r = (px: number, container: number) => panelReducer({ open: true, height: 240, everOpened: true }, { type: "resize", px, container }).height;
  assert.equal(r(50, 1000), 120); assert.equal(r(900, 1000), 700); assert.equal(r(300, 1000), 300);
  assert.equal(r(300, 100), 120, "a tiny window still allows the minimum");
});

test("restores from lq.terminal; first load with nothing stored is closed at 240", () => {
  assert.deepEqual(loadPanel({ getItem: () => null }), { open: false, height: 240, everOpened: false });
  assert.deepEqual(loadPanel({ getItem: (k) => (k === "lq.terminal" ? '{"open":true,"height":300}' : null) }), { open: true, height: 300, everOpened: true });
});

test("a corrupted or out-of-range stored value falls back safely", () => {   // Review Focus 5
  for (const raw of ["not json", '{"open":"yes","height":300}', '{"open":true,"height":-5}', '{"open":true,"height":"big"}', "null", "[]"]) {
    const s = loadPanel({ getItem: () => raw });
    assert.equal(typeof s.open, "boolean", raw);
    assert.ok(s.height >= 120 && Number.isFinite(s.height), raw);
  }
});

test("a throwing localStorage falls back to closed and 240 and save does not throw", () => {
  assert.deepEqual(loadPanel({ getItem: () => { throw new Error("blocked"); } }), { open: false, height: 240, everOpened: false });
  assert.doesNotThrow(() => savePanel({ setItem: () => { throw new Error("quota"); } }, { open: true, height: 300, everOpened: true }));
  assert.doesNotThrow(() => savePanel(undefined, { open: true, height: 300, everOpened: true }));
});

test("Ctrl+` toggles on any keyboard layout; other modifiers do not", () => {
  const k = (o: Partial<KeyboardEvent>) => isToggleKey({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", ...o });
  assert.equal(k({ ctrlKey: true, code: "Backquote" }), true);
  assert.equal(k({ ctrlKey: true, code: "Backquote", shiftKey: true }), false);
  assert.equal(k({ metaKey: true, code: "Backquote" }), false);
  assert.equal(k({ ctrlKey: true, code: "KeyC" }), false);
});
```

The stored height is clamped again against the real container in `usePanel` on mount and on window resize. The reducer test above only checks that the value is finite and at least 120.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/web exec node --test src/player/terminal/usePanel.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `usePanel.ts`** (`useReducer(panelReducer, undefined, () => loadPanel(safeLocalStorage()))`; a save effect on `open`/`height`; a `resize` listener on `window` that re-dispatches `resize` with the current height so a smaller window re-clamps it. Reading `window.localStorage` itself can throw, so `safeLocalStorage()` wraps it in try/catch).

- [ ] **Step 4: Run to verify it passes** (same command). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/player/terminal/usePanel.ts apps/web/src/player/terminal/usePanel.test.ts
git commit -m "feat(web): add terminal panel state with persisted height"
```

---

### Task 6: Terminal panel UI, file tree, mount in PracticeView (WP2)

**Files:**
- Modify: `apps/web/src/player/runPython.ts` (widen private `call` to take a full path; add `listFiles`)
- Modify: `apps/web/src/player/runPython.test.ts` (one new test)
- Create: `apps/web/src/player/terminal/TerminalView.tsx`, `TerminalPanel.tsx`, `FileTree.tsx`
- Modify: `apps/web/src/player/live/PracticeView.tsx` (mount the panel under `EditorPane`; menu-bar toggle button in `live.footer` before Check; window `keydown` capture listener for `isToggleKey`; the old `<section aria-labelledby="out-h">` and the Run path stay untouched)

**Interfaces:**
- Consumes: Task 4 `createShellSocket`, `ShellSocket`, `ShellState`; Task 5 `usePanel`, `isToggleKey`, `KEY_STEP`, `MIN_HEIGHT`.
- Produces:
  ```ts
  // runPython.ts
  export type DirEntry = { name: string; type: "file" | "dir" | "link" | "other"; size: number };
  export const listFiles = (dir?: string) => Promise<{ entries: DirEntry[]; truncated: boolean }>;
     // GET /api/sandbox/files[?dir=<encodeURIComponent(dir)>]; throws Error(server message) on !ok
  // TerminalPanel.tsx (default export)
  type TerminalPanelProps = { shell: ShellSocket; panel: ReturnType<typeof usePanel>; badge: ReactNode; treeKey: number; onRefreshTree(): void; note?: string };
  // TerminalView.tsx (default export, loaded with React.lazy from TerminalPanel)
  type TerminalViewProps = { shell: ShellSocket };
  // FileTree.tsx (default export)
  type FileTreeProps = { refreshKey: number };
  ```

- [ ] **Step 1: Write the failing test** (add to `runPython.test.ts`)

```ts
test("listFiles asks for one directory level and encodes dir", async () => {
  const urls: string[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ entries: [], truncated: false }), { status: 200 }); }) as typeof fetch;
  try { await listFiles(); await listFiles("my dir/sub"); } finally { globalThis.fetch = real; }
  assert.deepEqual(urls, ["/api/sandbox/files", "/api/sandbox/files?dir=my%20dir%2Fsub"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/web exec node --test src/player/runPython.test.ts`
Expected: FAIL with `does not provide an export named 'listFiles'`.

- [ ] **Step 3: Implement `listFiles`, the three components and the PracticeView mount**

- `TerminalView`: imports `@xterm/xterm`, its CSS and `FitAddon`. It mounts xterm into a div, fits, then calls `shell.connect(term.cols, term.rows)`. `term.onData → shell.send`. `shell.onOutput → term.write`. A `ResizeObserver` calls `fit()` debounced by 100 ms, then `shell.resize`. `attachCustomKeyEventHandler` returns `false` for `isToggleKey` so Ctrl+\` never reaches the shell as NUL. Theme: background `#1b1b1f` (ink), foreground white. On unmount it disposes xterm only, not the socket.
- `TerminalPanel`: renders nothing until `everOpened`, then stays mounted with `hidden={!open}`. It calls `shell.setActive(open)`. Drag handle: `role="separator"`, `aria-orientation="horizontal"`, `aria-valuemin={120}`, pointer capture, ArrowUp/ArrowDown move ±16 px. Header: "Terminal", `badge`, Refresh and × buttons. Body: `FileTree` at `w-[180px] max-[640px]:hidden` and `<Suspense>`-wrapped lazy `TerminalView`. State lines come from `ShellState`, with the spec's copy: "Starting your sandbox…", "Reconnecting…", "[shell ended] Press Enter to start a new one", "The sandbox is off on this server", "Sign in to use the terminal". The server's message plus "Try again" covers 4029, 4503 and `replaced`, where the message is "The terminal is open in another window".
- `FileTree`: lists home on mount and when `refreshKey` changes. Folders start collapsed and fetch on expand. Links and other entries are not expandable. A `truncated` listing shows "…more". On error it shows "Could not list files" with Retry. A 409 shows "Open the terminal first".
- `PracticeView`: `const shell = useMemo(() => createShellSocket(), [])` with `useEffect(() => () => shell.dispose(), [shell])`. `const panel = usePanel(bodyRef)`. Add a footer button "Terminal" with `aria-pressed={panel.state.open}`. The old header badge stays where it is in this task.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @learnquest/web test && pnpm --filter @learnquest/web lint && pnpm --filter @learnquest/web build`
Expected: PASS. The build shows xterm in its own lazy chunk; confirm with `ls apps/web/dist/assets | grep -i -E 'xterm|TerminalView'`.

- [ ] **Step 5: Manual check (record in the PR):** `pnpm dev` with `SANDBOX_ENABLED=true`. In DevTools → Network → WS, first load has no socket. Ctrl+\` opens the panel, which shows a bash prompt; `ls`, `cd`, `python3`, `node` work. Drag the handle and use the arrow keys; it clamps at 120 px and 70 %. Reload: the panel state is restored. Open the same lesson in a second window: the first window shows "open in another window" and stops.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/player/runPython.ts apps/web/src/player/runPython.test.ts apps/web/src/player/terminal/TerminalView.tsx apps/web/src/player/terminal/TerminalPanel.tsx apps/web/src/player/terminal/FileTree.tsx apps/web/src/player/live/PracticeView.tsx
git commit -m "feat(web): add terminal panel and file tree to practice (LQ-80)"
```

---

### Task 7: `putFile` and `runInShell` (WP3)

**Files:**
- Modify: `apps/web/src/player/runPython.ts` (add `putFile`)
- Create: `apps/web/src/player/terminal/runInShell.ts`
- Test: `apps/web/src/player/terminal/runInShell.test.ts`

**Interfaces:**
- Consumes: Task 4 `ShellSocket` (`whenReady`, `send`), `ShellNotReadyError`; Task 1 route contract.
- Produces:
  ```ts
  // runPython.ts
  export const putFile = (name: "solution.py" | "solution.js", content: string) => Promise<void>;  // PUT /api/sandbox/files/<name>, body { content }
  // runInShell.ts
  export const READY_TIMEOUT_MS = 15_000; export const SETTLE_MS = 100;
  export function runTarget(language: "python" | "javascript"): { file: "solution.py" | "solution.js"; command: string };
  export class RunInShellError extends Error { constructor(readonly kind: "starting" | "disabled" | "unavailable" | "copy", message: string) }
  export function runInShell(o: {
    language: "python" | "javascript"; code: string;
    panel: { open(): void }; socket: Pick<ShellSocket, "whenReady" | "send">;
    putFile(name: "solution.py" | "solution.js", content: string): Promise<void>;
    refreshTree(): void; sleep?: (ms: number) => Promise<void>;
  }): Promise<void>;
  ```
  Error mapping: `ShellNotReadyError("timeout")` → `starting` ("The sandbox is still starting, press Run again"); `"disabled"` → `disabled`; any other reason → `unavailable` (the panel already shows why); a `putFile` rejection → `copy` ("Could not copy your code to the sandbox: <message>").

- [ ] **Step 1: Write the failing tests**

```ts
const harness = (over: Partial<Parameters<typeof runInShell>[0]> = {}) => {
  const log: string[] = [];
  const o = { language: "python" as const, code: "print(1)",
    panel: { open: () => void log.push("open") },
    socket: { whenReady: async (ms: number) => void log.push(`ready:${ms}`), send: (d: string) => void log.push(`send:${JSON.stringify(d)}`) },
    putFile: async (n: string, c: string) => void log.push(`put:${n}:${c}`),
    refreshTree: () => void log.push("tree"), sleep: async (ms: number) => void log.push(`sleep:${ms}`), ...over };
  return { o, log };
};

test("open, ready, PUT, Ctrl-C, settle, command, refresh, in that order", async () => {
  const { o, log } = harness(); await runInShell(o);
  assert.deepEqual(log, ["open", "ready:15000", "put:solution.py:print(1)", 'send:"\\u0003"', "sleep:100",
    'send:"cd ~ && python3 solution.py\\r"', "tree"]);
});

test("file name and command per language", () => {
  assert.deepEqual(runTarget("python"), { file: "solution.py", command: "cd ~ && python3 solution.py\r" });
  assert.deepEqual(runTarget("javascript"), { file: "solution.js", command: "cd ~ && node solution.js\r" });
});

test("a failed PUT types nothing", async () => {
  const { o, log } = harness({ putFile: async () => { throw new Error("Open the terminal first"); } });
  await assert.rejects(runInShell(o), (e: RunInShellError) => e.kind === "copy" && /Could not copy your code to the sandbox: Open the terminal first/.test(e.message));
  assert.ok(!log.some((l) => l.startsWith("send:")));
});

test("a sandbox that is not ready in 15 s, or is off, types nothing and writes nothing", async () => {   // Review Focus 2
  for (const [why, kind] of [["timeout", "starting"], ["disabled", "disabled"], ["exited", "unavailable"]] as const) {
    const { o, log } = harness({ socket: { whenReady: async () => { throw new ShellNotReadyError(why); }, send: () => void log.push("send") } });
    await assert.rejects(runInShell(o), (e: RunInShellError) => e.kind === kind);
    assert.ok(!log.some((l) => l.startsWith("put:") || l === "send"));
  }
});

test("Run never sends a lessonId", async () => {
  const bodies: string[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { bodies.push(String(init.body)); return new Response(null, { status: 204 }); }) as typeof fetch;
  try { await putFile("solution.py", "print(1)"); } finally { globalThis.fetch = real; }
  assert.deepEqual(bodies.map((b) => JSON.parse(b)), [{ content: "print(1)" }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/web exec node --test src/player/terminal/runInShell.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `putFile` and `runInShell`.** `runInShell.ts` imports `ShellNotReadyError` and the `ShellSocket` type from `./shellSocket.ts`, and nothing `.tsx`.

- [ ] **Step 4: Run to verify it passes** (same command, then `pnpm --filter @learnquest/web test`). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/player/runPython.ts apps/web/src/player/terminal/runInShell.ts apps/web/src/player/terminal/runInShell.test.ts
git commit -m "feat(web): run the editor file in the learner's shell"
```

---

### Task 8: Run integration in PracticeView and docs (WP3)

**Files:**
- Create: `apps/web/src/player/live/practiceActions.ts`
- Test: `apps/web/src/player/live/practiceActions.test.ts`
- Modify: `apps/web/src/player/live/PracticeView.tsx`
- Modify: `docs/plans/sandbox-editor-plan.md` (phase 2 "Terminal" marked done; phase 3 notes the read-only tree and file sync for `solution.*`; LQ-80/LQ-39 referenced)

**Interfaces:**
- Consumes: Task 7 `runInShell`, `RunInShellError`, `putFile`; Task 6 panel/shell wiring; `startPython`, `pollPython`, `sendPythonLine`, `stopPython`, `checkPassed` from `runPython.ts`.
- Produces:
  ```ts
  type StartArgs = Parameters<typeof startPython>;
  export type PracticeActions = { run: { via: "shell" } | { via: "oneshot"; args: StartArgs }; check: { via: "oneshot"; args: StartArgs } };
  export function practiceActions(o: { language: "python" | "javascript"; code: string; lessonId: string; sandboxEnabled: boolean }): PracticeActions;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test("Run uses the shell when the sandbox is on, and the one-shot path without a lessonId when it is off", () => {
  assert.deepEqual(practiceActions({ language: "python", code: "c", lessonId: "prac-1", sandboxEnabled: true }).run, { via: "shell" });
  const off = practiceActions({ language: "javascript", code: "c", lessonId: "prac-1", sandboxEnabled: false }).run;
  assert.deepEqual(off, { via: "oneshot", args: ["c", "javascript"] });
  assert.equal((off as { args: unknown[] }).args.length, 2, "no lessonId slot at all");
});

test("Check always uses the one-shot path with the lessonId", () => {
  for (const sandboxEnabled of [true, false])
    assert.deepEqual(practiceActions({ language: "python", code: "c", lessonId: "prac-1", sandboxEnabled }).check,
      { via: "oneshot", args: ["c", "python", "prac-1"] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/web exec node --test src/player/live/practiceActions.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `practiceActions` and rewire `PracticeView`**

- Run calls `practiceActions(...)`. For `shell` it calls `runInShell({ panel: { open: () => panel.dispatch({ type: "open" }) }, socket: shell, putFile, refreshTree: () => setTreeKey((k) => k + 1), ... })`. On `RunInShellError("disabled")` it falls back to the one-shot path. Other errors show their message in the panel header. `sandboxEnabled` is `!(shell.state().kind === "closed" && shell.state().reason === "disabled")`, tracked through `shell.onState`.
- The Run button is disabled from click until `runInShell` settles. It no longer turns into Stop for a shell run (Ctrl-C does that).
- The old `<section aria-labelledby="out-h">` becomes a "Check output" block shown only while a one-shot run exists or has output. Title "Check output", sub-line "Checked in a clean sandbox". It keeps the read-only `<pre>`, the one-line input form and a Stop button while a one-shot run is live (correction 9), and the existing polling loop. The verdict badge (`role="status" aria-live="polite"`) moves into `TerminalPanel`'s `badge` slot. The block renders the same badge when the panel has never been opened, so the live region always exists exactly once.
- Removed: Run's use of `term`/`typed`/`sid` for shell runs. Those states remain only for the one-shot block.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @learnquest/web test && pnpm --filter @learnquest/web lint && pnpm --filter @learnquest/web build`
Expected: PASS. Also run `cd apps/api && node --test test/sandbox-run.test.ts` (unchanged and green).

- [ ] **Step 5: Update `docs/plans/sandbox-editor-plan.md`** (phase 2 done; file sync and the read-only tree under phase 3; link the spec).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/player/live/practiceActions.ts apps/web/src/player/live/practiceActions.test.ts apps/web/src/player/live/PracticeView.tsx docs/plans/sandbox-editor-plan.md
git commit -m "feat(web): run practice code in the terminal panel (LQ-80, LQ-39)"
```

---

### Task 9: Manual verification and full CI

**Files:** none (results go in the PR description).

- [ ] **Step 1: Docker backend, `SANDBOX_ENABLED=true`, `pnpm dev`.** Check each spec success criterion:
  1. First load: panel closed, no WS in DevTools.
  2. Ctrl+\` and the footer button toggle the panel; × closes and reopening keeps the same shell (history intact). Drag and the arrow keys stop at 120 px and 70 %. Reload restores the panel.
  3. `ls`, `cd /tmp && cd ~`, `mkdir x`, `python3`, `node`, `pip install requests` all run.
  4. Run a program with `input()` with the panel closed. The panel opens, `~/solution.py` is written, the prompt reads keystrokes, Ctrl-C stops it, Ctrl-D sends EOF. A program that prints more than 8000 characters or runs longer than 60 s is not cut off.
  5. The tree shows `solution.py` after Run; `x/` expands; Refresh re-lists; a name with a space shows correctly.
  6. Stop the API: "Reconnecting…" appears, and the prompt returns after a restart. Open the same lesson in a second window: the first window stops with "open in another window".
  7. Check: the verdict badge shows; the Network tab shows `lessonId` only on `POST /api/sandbox/run` and no expected output in any response.
  8. Same lesson in a JavaScript practice: `solution.js` and `node solution.js`.
- [ ] **Step 2: `SANDBOX_ENABLED=false`.** The panel shows "The sandbox is off on this server". Run and Check use the one-shot block with input and Stop, as before.
- [ ] **Step 3: Full CI**

Run: `TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test pnpm exec turbo run lint test build`
Expected: every task succeeds (`Tasks: N successful, N total`). If your test Postgres runs on another port, such as 5433, use that port. Report exactly what ran and anything skipped.

- [ ] **Step 4: No commit unless a fix was needed** (then `fix(<scope>): …` with the trailer).

---

## Self-review

- **Spec coverage:**
  - Success criteria: 1 → T4 (no connect until `connect`) and T6 (manual). 2 → T5 and T6. 3 → T4 and T6. 4 → T7 and T8. 5 → T1–T3 and T6. 6 → T4. 7 → T8 and the unchanged `sandbox-run.test.ts`. 8 → T4 (probe), T7 (`disabled`) and T8 (fallback).
  - Security: allowlist, `dir` regex, argv-only, uid 1001, limits and rate limits → T1 and T2. Answers stay server-side → T7 and T8.
  - Error table: every row maps to a `ShellState` or a `RunInShellError` kind (T4, T6, T7).
  - Testing plan: each named test file exists, except the Docker tests (correction 1) and the PracticeView test (correction 8).
  - Open risks: Daytona home → T3 Step 5. Production WebSockets: no task, out of scope by the spec.
  - Idle-stop note: the `note` prop on `TerminalPanel` (T6), shown once on first connect.
- **Placeholders:** none. The only free text left to implementers is component markup, and the spec fixes its copy and dimensions.
- **Type consistency:**
  - `SandboxFileName` (API) matches the web `"solution.py" | "solution.js"` literals in `putFile` and `runTarget`.
  - `DirEntry` has the same shape in `backend.ts` and `runPython.ts`.
  - `ShellSocket.whenReady`/`send` (T4) are what `runInShell` picks (T7).
  - `ShellNotReadyError.why` values match the `RunInShellError.kind` mapping.
  - `PanelAction.resize` carries `container` in T5 and T6.
  - `containerName` (T2) is used by `openShell`.
- **Proportion:** code blocks are test assertions and signatures only. No function bodies, except `parseFindOutput`'s record format and the error mappings, which the tests alone do not fix.
