# Sandbox terminal panel: design

Date: 2026-11-06. Status: approved design (approach A), not implemented.
Tickets: LQ-80 "Terminal Experience needs to be improved", LQ-39 "Terminal folders not visible, commands are not working".
Related: `docs/plans/sandbox-editor-plan.md` (phase 2 "Terminal" and part of phase 3 "Files"), LQ-75 (graded runs stay in a separate sandbox).

## Problem

The practice screen (`apps/web/src/player/live/PracticeView.tsx`) has a "Terminal" that is not a terminal. It is a `<pre>` plus a one-line `<input>`, always visible under the editor. Run posts the editor code to `POST /api/sandbox/run` (`apps/web/src/player/runPython.ts`, `apps/api/src/sandbox/run.ts`) and polls `GET /api/sandbox/run/:id` every 300 ms. Each run is a one-shot program in a fresh container: 60 s wall clock, stdout capped at 8000 characters, stdin only as whole lines through `POST /:id/input`, and no way to send EOF or Ctrl-C. Shell commands (`ls`, `cd`, `pip`) cannot be typed at all, and a program that waits on `input()` blocks until the learner types or the 60 s limit kills it.

A real PTY already exists: `GET /api/sandbox/shell` (`apps/api/src/sandbox/route.ts`) upgrades to a WebSocket where binary frames are stdin/stdout and JSON text frames are control (`{type:"resize",cols,rows}` in; `{type:"exit",code}` and `{type:"error",message}` out). It is backed by `docker exec -it … bash -l` via node-pty (`docker.ts`) or Daytona `createPty` (`daytona.ts`), with per-learner tab caps (close code 4029) and a server-wide shell cap (close code 4503). The web app has no client for it and no xterm.js. There is no file or directory endpoint, and the editor's code never reaches the shell's home (`/home/learner`, a 512 MB tmpfs in the Docker backend).

## Goal

Replace the fake terminal with a real shell in a panel that behaves like a code editor's terminal, make Run execute the editor file inside that shell, and show the files in the learner's home.

### Success criteria (each one is a test or a manual check)

1. On first load of a practice lesson the terminal panel is closed and no WebSocket is opened.
2. The panel can be toggled (menu-bar button and Ctrl+\`), closed (× in its header) and reopened; it can be resized by dragging its top edge between 120 px and 70 % of the code window height. Open state and height are remembered per browser (`localStorage`, key `lq.terminal`) and restored on the next lesson.
3. The first open connects to `/api/sandbox/shell?tab=practice&cols=…&rows=…` and shows the learner's bash prompt. Typed commands (`ls`, `cd`, `mkdir`, `python3`, `node`, `pip install`) run in the learner's container.
4. Run (with the panel closed or open) opens the panel, writes the editor content to `~/solution.py` or `~/solution.js`, and types `cd ~ && python3 solution.py` (or `node solution.js`) plus Enter into the shell. `input()` reads keystrokes directly; Ctrl-C stops the program; Ctrl-D sends EOF. No 60 s limit and no 8000-character cap apply to Run.
5. A file tree beside the terminal lists `~` and expands folders on click (LQ-39). After Run it shows `solution.py`/`solution.js`; a Refresh button re-lists.
6. If the socket drops, the panel shows "Reconnecting…" and reconnects with backoff (1, 2, 4, 8, 15 s, then every 15 s) while the panel is open. It stops on close codes 4029 and 4503 and on HTTP 401/503 at upgrade, and shows the reason.
7. Check is unchanged: it still uses `POST /api/sandbox/run` with `lessonId`, is judged on the server, and its verdict badge still shows. No expected output or answer key reaches the client.
8. With `SANDBOX_ENABLED=false` the panel shows "The sandbox is off on this server" and Run and Check behave exactly as today (the one-shot path).

## Non-goals

- Editor tabs, Cmd+P quick open, a full explorer (create, rename, delete, context menus), multi-file projects.
- Opening a file from the tree in the editor. The tree is read-only and informational.
- Several terminal tabs in the UI. The server supports them; the client uses one fixed tab id, `practice`.
- Changing Check, `run.ts`, the learner model, auth, or deployment config.
- Persisting files across container stops. Home is tmpfs; Run re-writes the file every time.

## Architecture

Four components, each with one purpose.

### 1. API file endpoint (`apps/api/src/sandbox/files.ts`)

Purpose: move the editor file into the learner's own shell container and list its home, nothing else.

- `PUT /api/sandbox/files/:name` with JSON body `{ content: string }`. `:name` must be exactly `solution.py` or `solution.js` (allowlist, not a pattern). `content` is at most `MAX_CODE` (4000) characters, the same limit as `run.ts`, so anything that can be Checked can be Run. Answers `204`.
- `GET /api/sandbox/files?dir=<relative path>` answers `{ entries: [{ name, type: "file" | "dir" | "link" | "other", size }], truncated: boolean }` for one directory level under the home. `dir` is optional (home itself).
- Both routes start with the same guard as `run.ts`'s `learnerFor`: 503 when `SANDBOX_ENABLED` is false, 401 without a learner from `resolveLearnerId`. The PUT is covered by the app's global origin hook (it only skips GET). No change to auth.
- New optional methods on `SandboxBackend` (`backend.ts`):
  - `writeFile(learnerId, name, content): Promise<void>`
  - `listDir(learnerId, relDir): Promise<{ entries, truncated }>`
  - A new `SandboxNotRunningError`: the learner has no running shell container. The route maps it to `409 { code: "no_shell", message: "Open the terminal first" }`, and a backend without the methods to `501`.
- Docker backend: the container name helper moves out of `openShell` into a shared `containerName(learnerId)`. Both methods first check the name is in the backend's `live` set and `docker inspect` reports it running, otherwise they throw `SandboxNotRunningError`; they never start a container. Write uses `spawn("docker", ["exec", "-i", "-u", "1001", name, "sh", "-c", 'cat > "$1"', "sh", "/home/learner/" + name])` with the content on stdin (argv only, no string interpolation into a shell). List uses `docker exec -u 1001 <name> find -P <abs dir> -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\n'` and parses at most 200 lines.
- Daytona backend: looks up the learner's shell sandbox by labels without creating it (a new `findShell` next to `findOrCreate`); not found or not `started` throws `SandboxNotRunningError`. Write uses `sbx.fs.uploadFile`, list uses `sbx.fs.listFiles` (added to the narrow `DaytonaSandbox` view). The home path comes from `sbx.getUserHomeDir()` (also added to the view), cached per sandbox id, because a Daytona snapshot's user is not guaranteed to be `learner`.

### 2. Web terminal client (`apps/web/src/player/terminal/shellSocket.ts`, `TerminalView.tsx`)

Purpose: one live xterm.js session over `/api/sandbox/shell`.

- New dependencies in `apps/web`: `@xterm/xterm` and `@xterm/addon-fit`, loaded with `React.lazy` so they only download when the panel first opens.
- `shellSocket.ts` (pure TypeScript, no DOM types beyond `WebSocket`): builds the URL (`ws(s)://<location.host>/api/sandbox/shell?tab=practice&cols&rows`), sets `binaryType = "arraybuffer"`, sends keystrokes as binary frames (`TextEncoder`), sends `{type:"resize"}` JSON frames, parses incoming JSON frames, and owns the reconnect state machine (`idle → connecting → open → reconnecting | closed(reason)`). It exposes `ready: Promise<void>` that resolves on the first output frame (the prompt), which is the signal that the container is running.
- `TerminalView.tsx`: mounts xterm, wires `onData` to the socket, `FitAddon.fit()` on a `ResizeObserver`, debounced 100 ms, then sends resize. Theme uses the existing ink and white tokens.
- `apps/web/vite.config.ts`: the `/api` proxy entry becomes `{ target: "http://localhost:3000", ws: true }`; without it the dev server does not forward the upgrade.

### 3. Panel and layout state (`apps/web/src/player/terminal/usePanel.ts`, `TerminalPanel.tsx`)

Purpose: where the terminal lives and whether it is shown.

- `usePanel.ts` is a reducer over `{ open, height, everOpened }` with actions `toggle`, `open`, `close`, `resize(px)`; `resize` clamps to [120 px, 70 % of container]. It reads and writes `localStorage["lq.terminal"]` inside try/catch, so a blocked store falls back to closed and 240 px.
- `TerminalPanel.tsx` renders under `EditorPane` inside `PracticeView`'s code `body`: a drag handle (pointer events, `role="separator"`, `aria-orientation="horizontal"`, arrow keys move it 16 px), a header with the title "Terminal", the Check verdict badge (moved here from the old header so its `aria-live` region stays), Refresh-tree and close buttons, then the file tree (left, 180 px, hidden below 640 px wide) and `TerminalView` (right).
- The panel component stays mounted once `everOpened` is true and is hidden with `hidden` when closed, so closing does not kill the shell; leaving the lesson unmounts it and closes the socket.
- File tree (`FileTree.tsx`): calls `GET /api/sandbox/files`, renders folders collapsed, fetches a folder's entries on expand, shows `truncated` as "…more". It does not reuse `Explorer.tsx`, which builds a tree from a known path list.

### 4. Run integration (`apps/web/src/player/terminal/runInShell.ts`, `PracticeView.tsx`)

Purpose: make Run mean "run my file in my shell".

- `runInShell({ language, code, panel, socket, putFile })`: opens the panel, awaits `socket.ready` (15 s budget, see cold start), awaits `putFile(name, code)`, then sends `\x03` (Ctrl-C, to drop any half-typed line or a program still waiting on input), waits 100 ms so the terminal driver finishes flushing input, then sends `cd ~ && python3 solution.py\r` or `cd ~ && node solution.js\r`. It then asks the file tree to refresh.
- `PracticeView` loses `term`, `typed`, `sid`, `starting`, the polling effect and the input form for Run. Run calls `runInShell`. The Run button is disabled while a Run is between click and command sent.
- Check keeps `startPython(code, language, lessonId)` and the polling loop, but its output goes to a small read-only "Check output" block shown above the verdict, not to the shell, because the graded run happens in a separate sandbox (LQ-75) and must not depend on the learner's shell state.
- When `SANDBOX_ENABLED` is false (upgrade answers 503 and the panel records it), Run falls back to today's one-shot `startPython` path and shows output in the same read-only block, so a server without shells keeps working.

## Data flow

```
Run click
  -> panel.open()                       (lazy-loads xterm on first open)
  -> socket connects /api/sandbox/shell  -> route.ts -> backend.openShell -> bash -l in learner container
  -> first output frame => ready
  -> PUT /api/sandbox/files/solution.py {content}
       -> files.ts guard -> backend.writeFile -> docker exec -i cat > /home/learner/solution.py  (or Daytona uploadFile)
  -> socket.send("\x03"); 100 ms; socket.send("cd ~ && python3 solution.py\r")
  -> program runs in the PTY; keystrokes and Ctrl-C/Ctrl-D go straight to it
  -> FileTree refresh -> GET /api/sandbox/files -> backend.listDir

Check click (unchanged path)
  -> POST /api/sandbox/run {code, language, lessonId} -> one-shot sandbox, server judges, records completion
  -> poll GET /api/sandbox/run/:id -> { output, done, passed } -> verdict badge
```

## Security

- **Per-learner isolation.** The learner id comes only from `resolveLearnerId` on the request; the container or sandbox is derived from its hash, as in `openShell`. No route takes a learner or container id from the client.
- **Path traversal.** Write accepts only the two allowlisted names and joins them to the home path on the server. List accepts `dir` only as up to 4 segments joined by `/`, each matching `^[A-Za-z0-9._-]{1,64}$` and not `.` or `..`; anything else is 400. `find -P` does not follow a symlink given as the start point, and symlinks inside a folder are reported as `type: "link"` and not expanded by the UI. The real boundary is the container: the learner already has a shell as uid 1001 there, so the endpoint grants nothing the shell does not, and writes and lists run as uid 1001, never root.
- **No shell interpolation.** Docker commands are argv arrays; file content travels on stdin; the name and directory are validated before use.
- **Size limits.** `content` ≤ 4000 characters (zod), Fastify `bodyLimit` of 16 KiB on the PUT route, list output ≤ 200 entries and ≤ 64 KiB read from `find` stdout, names truncated to 64 characters in the response. The WebSocket keeps its 64 KiB `maxPayload`.
- **Rate limits.** The API has no general rate limiter today (Better Auth has its own). `files.ts` adds an in-memory per-learner fixed window, like `run.ts`'s in-memory caps: 30 writes and 60 lists per learner per minute, answered with `429 rate_limited`. At most one `docker exec` per learner runs at a time; a second request waits for the first.
- **Answers stay server-side.** Run never sends `lessonId` and never receives expected output; Check's response is unchanged.
- **Personal data.** None added. Files live in the learner's container only; nothing is stored in Postgres; Daytona labels stay the learner hash.

## Error handling

| Situation | What the learner sees | Mechanism |
|---|---|---|
| Socket drops (network, API restart) | Grey "Reconnecting…" line in the terminal; prompt returns on success | `shellSocket` backoff 1, 2, 4, 8, 15 s, capped at 15 s, only while the panel is open. A reconnect reuses tab `practice`, so the server replaces the old socket and caps are not hit. Shell history is lost (a new `bash -l`); files remain until the container's idle stop. |
| Shell exits (`exit`, Ctrl-D at prompt) | "[shell ended] Press Enter to start a new one" | `{type:"exit"}` frame; Enter reconnects. |
| Sandbox disabled | "The sandbox is off on this server" in the panel; Run uses the one-shot path | Upgrade answers 503; client stops retrying. |
| Signed out | "Sign in to use the terminal" | Upgrade 401; no retry. |
| Too many tabs (4029) or server busy (4503) | The server's message, plus a "Try again" button | No automatic retry for these codes. |
| Cold start (Docker create, Daytona create or start can take 10–60 s) | "Starting your sandbox…" spinner in the panel; Run shows "Waiting for the sandbox" | `ready` waits for first output. Run gives up after 15 s with "The sandbox is still starting, press Run again"; the socket keeps waiting. |
| Write fails (409 `no_shell`, 429, 5xx) | "Could not copy your code to the sandbox: <message>" in the panel header; no command is typed | `runInShell` aborts before sending the command. |
| Listing fails | Tree shows "Could not list files" and a Retry link | Independent of the terminal; does not affect Run. |

## Testing plan

API (`apps/api/test`, `node --test`, existing fakes via `setBackend`):
- `sandbox-files.test.ts`: with a fake backend recording `writeFile`/`listDir` calls (same style as `fakeBackend()` in `sandbox.test.ts`): 401 signed out; 503 disabled; 400 for names other than the two allowlisted ones, for `..`, `/etc`, encoded `%2e%2e`, empty segments and 5-deep dirs; 400 for content over 4000 characters; 403 for a PUT with a foreign origin; 409 when the fake throws `SandboxNotRunningError`; 501 when the backend lacks the methods; 429 after 30 writes in a window; two learners get calls with their own learner ids only; listing output truncated at 200.
- `sandbox.test.ts` (Docker unit part): `writeFile` passes argv exactly as specified and the content only on stdin (fake `spawn`); `listDir` parses `find -printf` lines including names with spaces; throws `SandboxNotRunningError` when the container is not in `live`.
- `sandbox-daytona.test.ts`: `writeFile` calls `uploadFile` at `<home>/solution.py` with home from the fake `getUserHomeDir`; no sandbox created when none exists (fake client `create` not called).
- `sandbox-run.test.ts`: unchanged and still green, proving Check is untouched.

Web (`apps/web`, `node --test 'src/**/*.test.ts'`, no DOM):
- `terminal/usePanel.test.ts`: reducer toggle/close/resize clamping; storage restore and a throwing `localStorage`.
- `terminal/shellSocket.test.ts`: with a fake `WebSocket` class: URL and binary frames; resize JSON; backoff sequence; no retry on 4029, 4503, 401, 503; `ready` resolves on first output.
- `terminal/runInShell.test.ts`: order of calls (open, ready, PUT, `\x03`, command); correct file name and command per language; no command typed when PUT fails; Run never sends `lessonId`.
- `practiceView.test.ts` (the PracticeView test): the web runner only loads `.ts`, and Node cannot strip JSX, so `PracticeView` exports a pure `practiceActions({ language, sandboxEnabled })` that decides which path Run and Check take (shell vs one-shot, `lessonId` only on Check). The test asserts: Run uses `runInShell` when the sandbox is on and `startPython` without `lessonId` when it is off; Check always uses `startPython` with `lessonId`. A rendered component test would need a TSX test loader, which is out of scope for this change.
- Manual check (recorded in the PR): `pnpm dev` with `SANDBOX_ENABLED=true`, run a program with `input()`, Ctrl-C it, `ls`, `cd`, resize the panel, reload and confirm the panel state, kill the API and watch the reconnect.
- Full CI before push: `TEST_DATABASE_URL=… pnpm exec turbo run lint test build`.

## Work packages

Each package merges on its own; later packages only add callers.

**WP1: API file endpoint.** Files: `apps/api/src/sandbox/backend.ts` (optional methods, `SandboxNotRunningError`), `apps/api/src/sandbox/files.ts` (new), `apps/api/src/sandbox/docker.ts` (`containerName`, `writeFile`, `listDir`), `apps/api/src/sandbox/daytona.ts` (`findShell`, `writeFile`, `listDir`, extended narrow types), `apps/api/src/app.ts` (register `sandboxFilesRoute` next to the other sandbox routes), `apps/api/test/sandbox-files.test.ts` (new), `apps/api/test/sandbox.test.ts`, `apps/api/test/sandbox-daytona.test.ts`, `services/sandbox/README.md` (document the endpoint).

**WP2: Web terminal panel.** Files: `apps/web/package.json` (`@xterm/xterm`, `@xterm/addon-fit`), `apps/web/vite.config.ts` (`ws: true`), `apps/web/src/player/terminal/shellSocket.ts`, `TerminalView.tsx`, `usePanel.ts`, `TerminalPanel.tsx`, `FileTree.tsx` (new; the tree shows "Open the terminal first" until WP1 lands), their `.test.ts` files, and `PracticeView.tsx` only to mount the panel and a menu-bar toggle, keeping the old Run path.

**WP3: Run integration.** Files: `apps/web/src/player/terminal/runInShell.ts` and test (new), `apps/web/src/player/runPython.ts` (add `putFile` and `listFiles` fetch helpers next to the run helpers), `apps/web/src/player/live/PracticeView.tsx` (Run via `runInShell`, remove the fake terminal and input form, Check output block, `practiceActions`), `apps/web/src/player/practiceView.test.ts` (new), `docs/plans/sandbox-editor-plan.md` (mark phase 2 done and the terminal part of LQ-80/LQ-39). Needs WP1 and WP2 merged first.

## Open risks

- **Production WebSockets.** Production web is on Vercel and reaches the API through a rewrite in `apps/web/vercel.json`; Vercel rewrites do not proxy WebSocket upgrades. The auth cookie lives on the Vercel origin, so connecting straight to `learnquest-api.onrender.com` would arrive without it, and CSP `connect-src` has no `wss:` entry. The panel works in local dev and on any deployment where web and API share an origin. Fixing production touches auth or deployment, so it needs an owner decision and is not part of this change.
- **Command typed into a running program.** If the learner left a REPL or a long program running, `\x03` then the command may land in that program (for example, the Python REPL would treat the line as code). Accepted for now; a later change can detect the prompt with an OSC marker in the image's `PS1`.
- **Daytona home path.** If `getUserHomeDir` differs from the shell's starting directory, `cd ~` still works but the tree and the shell might disagree. WP1 adds a check against a real Daytona sandbox before merge.
- **Graded vs run environment differ.** Run uses the learner's shell (network on, their pip installs), while Check uses the locked-down one-shot sandbox. A program that passes Run can still fail Check if it relies on something installed in the shell. The Check output block says "Checked in a clean sandbox".
- **Idle stop.** The Docker backend stops the container 15 minutes after the last shell closes, wiping home. Run re-writes the file, so only learner-created files are lost; the panel shows a one-line note on first connect.
- **Bundle size.** xterm adds about 300 KB minified; it is lazy-loaded on first open so lessons that never open the panel do not pay for it.
