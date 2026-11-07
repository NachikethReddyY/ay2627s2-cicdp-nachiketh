# Practice Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the practice lesson's desktop-and-windows view with the "LearnSlop Workbench" IDE layout from the design canvas, keeping every behaviour practice has today (edit, Run in the sandbox shell, Check, Stop, stdin answers, Next).

**Architecture:** A new `apps/web/src/player/workbench/` folder holds a layout shell (`Workbench.tsx`) with five regions: left navigator, toolbar, editor, bottom panel, right utility area, and a status bar. Layout state (widths, which panels show, theme) lives in one pure reducer with localStorage persistence, tested with `node --test`. `PracticeView.tsx` keeps all its run/check/shell logic and only swaps `<Player>` for `<Workbench>`. The command palette, docs catalogue and editor hovers are pure modules plus thin React/Monaco wrappers. Replay and watch lessons keep using `Player`. The workbench is built and checked first on a dev-only test page, `/test/editor`, with fixture data and no sign-in or sandbox; real practice lessons switch over only in the second-to-last task.

**Tech Stack:** React 19, Vite 8, Tailwind 4, Monaco (`@monaco-editor/react`), xterm (existing `TerminalView`), `node --test` for unit tests.

**Spec:** Design canvas "LearnSlop Workbench", https://claude.ai/artifact/W6ta9hWi5yb9LXCxDMse6X. Boards used: `Workbench` (light) and `Workbench (dark)`, `Command palette: files / > commands / ? docs`, `IntelliSense: autocomplete / hover / error hover`. The `AI guide` boards are out of scope (see below).

## Global Constraints

- Applies to the practice view only (`part.kind === "practice"`). Watch, replay and diff views stay on `Player` and the sticker style.
- Fonts: Inter 400/500/600 for UI, JetBrains Mono 400/500 for code (Google Fonts `css2`, loaded once from `index.html`).
- Light tokens (copy exactly): `--tx #1c1c1e`, `--mu #555a66`, `--line #D7D6D6`, `--side #EDECEC`, `--code #FFFFFF`, `--tbar #FFFFFF`, `--selrow #D7D6D6`, `--sel rgba(47,95,214,.14)`, `--hov rgba(28,36,64,.07)`, `--ac #2f5fd6`, `--cur #fff6cf`, `--numdim #b4b8c0`.
- Dark tokens: `--tx #ececec`, `--mu #9a9a9a`, `--line #3a3a3a`, `--side #282828`, `--code #262626`, `--tbar #262626`, `--selrow #3a3a3a`, `--sel rgba(120,150,255,.22)`, `--hov rgba(255,255,255,.08)`, `--acT #8fb0ff`, `--cur #34322a`, `--numdim #5f5f5f`.
- Syntax colours, light: keyword `#9b2393`, string `#c41a16`, function `#326d74`, type `#0b4f79`, comment `#5d6c79`, number `#1c00cf`. Dark: `#ff7ab2`, `#ff8170`, `#78c2ff`, `#6bdfff`, `#8a919e`, `#d9c97c`.
- File badges: TS `#3178C6`/white, JS `#F2B63A`/`#3B2A00`, MD `#5B6272`/white, Python: `#3776AB`/white (not in the design; pick the language's own blue).
- Size limits from the design: navigator 180–520 px (default 232), utility area 200–420 px (default 320). The editor never gets narrower than 360 px.
- Hints and expected output stay server-side. Nothing in the docs catalogue or hovers may contain a lesson's answer.
- No auto-fix and no code generation in hovers: error hovers explain, they do not rewrite code.
- Every control is a real `<button>`/`<input>` with a label; icon-only buttons get `aria-label`. Text contrast 4.5:1 in both themes.
- Keyboard: `Ctrl/Cmd+P` opens the palette on files, `Ctrl/Cmd+Shift+P` opens it on commands (`>`), typing `?` switches to docs, `Esc` closes, `Enter` runs the first result. `` Ctrl+` `` still toggles the terminal.
- Under 1024 px wide the regions stack (editor, instructions, terminal) with no horizontal page scroll; the navigator and utility area become toggles.

- Test page: `/test/editor` is registered only when `import.meta.env.DEV` is true, the same way as `/dev/blocks` and `/diff` in `main.tsx`. It has no `beforeLoad: guard`, makes no API or sandbox calls, and its fixture text holds no real lesson answers. A production build must not contain the route (check with a 404 on `vite preview`).

## Out of scope (follow-ups, each needs its own decision)

- **AI guide "Sloppy"** (sidebar and pop-up chat): needs a new server endpoint for hints and a decision on AGENTS.md's "no free-chat tutor" rule. Leave the navigator's AI toggle out.
- **Debugger** (floating debug bar, Variables, Call stack, Breakpoints, Debug console, live values on hover): no runtime support yet.
- **Source control**, **Share**, **Notifications**, **phone/web preview**, **Back/Forward**: no backing feature. Leave them out instead of drawing dead buttons.
- **Search across files** view: the sandbox has no search API. Leave it out.

## Decisions this plan makes (flag in the PR)

- The design's right area shows only Docs. Practice needs its instructions, so the utility area gets two tabs, **Instructions** (default) and **Docs**, matching the design's own `rightDefs` (`instr`).
- **Check** and the lesson's **Next** go at the right end of the toolbar; the verdict ("Correct!" / "Not quite…") shows in the status bar and is announced with `role="status"`.
- The file tree moves out of the terminal panel into the navigator's Files view.
- Theme: Light / Dark / System, stored in `lq.theme`, default System.

## Review Focus

1. **Narrow window (<1024 px):** a learner on a laptop split screen or a tablet must still see the editor, Run, Check and the instructions with no sideways scroll. Owned by Task 3 (layout test for `clampLayout`) and Task 8 (browser check at 375 and 768 px).
2. **Corrupted or old localStorage (`lq.workbench`, `lq.theme`):** bad JSON, wrong types or out-of-range widths fall back to defaults; a throwing storage does not crash. Task 1.
3. **`Cmd+P` while the cursor is in Monaco or xterm:** must open the palette, not the browser's print dialog or Monaco's own command palette. Task 4 (`paletteKey` test) and a capture-phase listener.
4. **Window shrinks after panels were widened:** navigator + utility area must give the editor its 360 px before anything else. Task 1 (`clampLayout`).
5. **Sandbox off or signed out:** the Files view shows the same message the terminal does today ("The sandbox is off on this server", "Open the terminal first"), and Run still falls back to the one-shot run. Task 7.

---

### Task 1: Layout state reducer

**Files:**
- Create: `apps/web/src/player/workbench/layout.ts`
- Test: `apps/web/src/player/workbench/layout.test.ts`

**Interfaces:**
- Produces:
  - `type Theme = "light" | "dark" | "system"`
  - `type Layout = { leftW: number; utilW: number; showLeft: boolean; showUtil: boolean; leftView: "files" | "problems"; utilTab: "instructions" | "docs"; theme: Theme }`
  - `const DEFAULT_LAYOUT: Layout` (`leftW 232`, `utilW 320`, both shown, `files`, `instructions`, `system`)
  - `type LayoutAction = { type: "toggleLeft" } | { type: "toggleUtil" } | { type: "resizeLeft"; px: number; container: number } | { type: "resizeUtil"; px: number; container: number } | { type: "leftView"; view: Layout["leftView"] } | { type: "utilTab"; tab: Layout["utilTab"] } | { type: "theme"; theme: Theme }`
  - `layoutReducer(s: Layout, a: LayoutAction): Layout`
  - `clampLayout(s: Layout, container: number): Layout` — clamps to the design ranges, then shrinks utility first, navigator second, so `container - leftW - utilW >= 360` when both show.
  - `loadLayout(store: Pick<Storage, "getItem">): Layout` and `saveLayout(store: Pick<Storage, "setItem">, s: Layout): void` under key `lq.workbench`.
  - `useLayout(): [Layout, Dispatch<LayoutAction>]` hook in the same file, saving on change (same pattern as `terminal/usePanel.ts`).

- [ ] **Step 1: Write the failing tests** (`node:test`, `assert/strict`, import with `.ts` like `usePanel.test.ts`)
  - `toggleLeft` and `toggleUtil` flip only their own flag.
  - `resizeLeft` clamps to 180 and 520: `px 50 → 180`, `px 900, container 2000 → 520`, `px 300 → 300`.
  - `resizeUtil` clamps to 200 and 420.
  - `clampLayout({...DEFAULT_LAYOUT, leftW: 520, utilW: 420}, 1100)` leaves `1100 - leftW - utilW >= 360`, and `utilW` shrinks before `leftW`.
  - `loadLayout` returns `DEFAULT_LAYOUT` for `null`, `"not json"`, `"[]"`, `'{"leftW":"big"}'`, `'{"leftW":-5}'`, `'{"theme":"neon"}'`; and a throwing `getItem` (Review Focus 2).
  - `saveLayout` with a throwing `setItem` does not throw.
- [ ] **Step 2: Run** `pnpm --filter @learnquest/web test` — expect the new tests to FAIL (module missing).
- [ ] **Step 3: Implement** `layout.ts`. Validate each stored field on its own and keep valid ones.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Commit** `feat(web): workbench layout state for the practice view`

### Task 2: Theme tokens, fonts and Monaco themes

**Files:**
- Create: `apps/web/src/player/workbench/workbench.css`
- Create: `apps/web/src/player/workbench/monacoThemes.ts`
- Modify: `apps/web/index.html` (Google Fonts link for Inter and JetBrains Mono)
- Modify: `apps/web/src/player/EditorPane.tsx` (new optional props `theme?: string`, `fontFamily?: string`; default stays `"vs"` so `Player` is unchanged)

**Interfaces:**
- Produces:
  - CSS: `.wb` root sets the light tokens from Global Constraints; `.wb[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { .wb[data-theme="system"] }` set the dark ones. Shared classes `.wb-tb` (28 px toolbar button), `.wb-split-v`, `.wb-split-h` (12 px resize handles), `.wb-sec` (11 px uppercase section label).
  - `defineWorkbenchThemes(monaco: typeof import("monaco-editor")): void` registering `"learnslop-light"` and `"learnslop-dark"` with the syntax colours from Global Constraints, editor background `--code`, current line `--cur`, line numbers `--numdim`.
  - `resolveTheme(t: Theme, prefersDark: boolean): "light" | "dark"` (pure, in `layout.ts`; add its test there: `system` follows `prefersDark`, the others ignore it).

- [ ] **Step 1: Add the `resolveTheme` tests** to `layout.test.ts`; run; FAIL.
- [ ] **Step 2: Implement** `resolveTheme`, the CSS file and `monacoThemes.ts`. Call `defineWorkbenchThemes` from `EditorPane`'s `beforeMount` only when a `theme` prop is passed.
- [ ] **Step 3: Run** `pnpm --filter @learnquest/web test` and `pnpm --filter @learnquest/web lint` — PASS.
- [ ] **Step 4: Commit** `feat(web): workbench tokens, fonts and editor themes`

### Task 3: Workbench shell and toolbar

**Files:**
- Create: `apps/web/src/player/workbench/Workbench.tsx`
- Create: `apps/web/src/player/workbench/Toolbar.tsx`
- Create: `apps/web/src/player/workbench/StatusBar.tsx`
- Create: `apps/web/src/player/workbench/Splitter.tsx`
- Create: `apps/web/src/pages/TestEditor.tsx` (dev-only test page)
- Create: `apps/web/src/pages/testEditorFixture.ts` (fixture lesson)
- Modify: `apps/web/src/main.tsx` (register `/test/editor` when `import.meta.env.DEV`)

**Interfaces:**
- Consumes: `useLayout`, `clampLayout`, `resolveTheme` (Task 1/2), `.wb*` classes (Task 2).
- Produces:
  - `Workbench(props: { title: string; fileName: string; language: "javascript" | "typescript" | "python"; navigator: ReactNode; editor: ReactNode; bottom: ReactNode; instructions: ReactNode; docs: ReactNode; actions: ReactNode; status: { text: string; verdict?: ReactNode } })`. Task 4 adds the palette props.
  - `Toolbar` shows, left to right: navigator toggle, project mark + "LearnSlop" + lesson title, file breadcrumb, search button (opens the palette, `aria-label="Search and commands"`, title shows the shortcut), `actions` slot (Run/Stop/Check/Next), then toggles for terminal and utility area. Toggles use `aria-pressed`.
  - `StatusBar` shows run status dot + text, the verdict, `Ln x, Col y` (from the editor, optional), language name.
  - `Splitter({ orientation, label, value, min, max, onResize(px: number) })` — `role="separator"`, pointer capture drag, Arrow keys move 16 px (same contract as the terminal's resize handle).
  - Utility area tabs: "Instructions" and "Docs", `role="tablist"`.
  - `TEST_LESSON: { title: string; fileName: string; language: "javascript" | "typescript" | "python"; starter: string; instructions: string; files: { path: string; body: string }[]; output: string }` in `testEditorFixture.ts`. Start with one JavaScript lesson ("Sum a list" style, starter code only, no answer).
  - `TestEditor()` renders `<Workbench>` with a real `EditorPane` (edits stay in React state), a static file list from `TEST_LESSON.files`, and a bottom panel that prints `TEST_LESSON.output` when Run is pressed. Check shows a fixed "Check needs a real lesson" status. A `?language=` search param switches between JavaScript, TypeScript and Python fixtures once they exist.

- [ ] **Step 1: Build the shell** with fixed slots and the design's structure (navigator column, then toolbar over editor + bottom panel, utility area at the right, status bar along the bottom). Below `lg`, render a single column: toolbar, editor (`65dvh`), instructions, bottom panel; navigator and docs open as overlays from the toolbar.
- [ ] **Step 2: Add the test page.** Register `/test/editor` in `main.tsx` next to `DiffPage` (`const TestEditor = import.meta.env.DEV ? lazy(() => import("./pages/TestEditor")) : null;`), and add `p.startsWith("/test")` to `isQuiet`. From here on, every task builds and checks its UI at `http://localhost:5173/test/editor` first.
- [ ] **Step 3: Wire** `ResizeObserver` on the root to run `clampLayout` when the window changes size (Review Focus 4).
- [ ] **Step 4: Run** `pnpm --filter @learnquest/web lint` and `build` — PASS. Browser check with `preview_start`: `/test/editor` renders all regions, typing in the editor works, the splitters drag and respond to arrow keys, and widths survive a reload.
- [ ] **Step 5: Check the route is dev-only:** `pnpm --filter @learnquest/web build && pnpm --filter @learnquest/web exec vite preview`, then `/test/editor` shows the Not Found page.
- [ ] **Step 6: Commit** `feat(web): workbench shell and /test/editor dev page`

### Task 4: Command palette

**Files:**
- Create: `apps/web/src/player/workbench/palette.ts`
- Test: `apps/web/src/player/workbench/palette.test.ts`
- Create: `apps/web/src/player/workbench/CommandPalette.tsx`
- Modify: `apps/web/src/player/workbench/Workbench.tsx` (mount the palette and the shortcut listener)

**Interfaces:**
- Produces:
  - `type PaletteMode = "file" | "cmd" | "doc"`
  - `parseQuery(q: string): { mode: PaletteMode; term: string }` — leading `>` is commands, leading `?` is docs, else files; `term` is trimmed and lower-cased.
  - `type PaletteItem = { id: string; title: string; sub?: string; hint?: string; badge?: "ts" | "js" | "py" | "md" }`
  - `filterItems(items: PaletteItem[], term: string): PaletteItem[]` — case-insensitive substring on `title + " " + sub`; empty term returns all.
  - `paletteKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PaletteMode | null` — `Cmd/Ctrl+P` → `"file"`, `Cmd/Ctrl+Shift+P` → `"cmd"`, anything else `null`.
  - `CommandPalette({ open, initial: PaletteMode, files: PaletteItem[], commands: (PaletteItem & { run(): void })[], docs: PaletteItem[], onOpenFile(id), onOpenDoc(id), onClose() })` as a modal `<dialog>`: search input, three mode buttons (Files, Commands `>`, Docs `?`), grouped results, first row selected, footer with `↑↓ navigate`, `↵ open` and the result count.
- Commands list (only ones that work): Run, Stop, Check, Toggle sidebar, Toggle terminal panel, Toggle docs panel, Color theme: Light / Dark / System.
- Files list: the editor's file (`solution.js` / `solution.py`) plus whatever `listFiles("")` returned for the tree.

- [ ] **Step 1: Write the failing tests:** `parseQuery(">toggle")` → `{ mode: "cmd", term: "toggle" }`; `parseQuery("? For ")` → `{ mode: "doc", term: "for" }`; `parseQuery("trace")` → file; `filterItems` matches on `sub`; `paletteKey` for `meta+p`, `ctrl+p`, `meta+shift+p`, and `p` alone → `null` (Review Focus 3).
- [ ] **Step 2: Run** tests — FAIL. **Step 3: Implement.** Register the shortcut on `window` in the capture phase with `preventDefault()` so it wins over Monaco and the browser's print. Arrow keys move the selection; `Enter` runs it.
- [ ] **Step 4: Run** tests — PASS; browser check: `Cmd+P` with focus in Monaco opens the palette, `Esc` returns focus to where it was.
- [ ] **Browser check on `/test/editor`** for this task's UI before committing.
- [ ] **Step 5: Commit** `feat(web): command palette for files, commands and docs`

### Task 5: Docs catalogue and Docs panel

**Files:**
- Create: `apps/web/src/player/workbench/docs.ts`
- Test: `apps/web/src/player/workbench/docs.test.ts`
- Create: `apps/web/src/player/workbench/DocsPanel.tsx`

**Interfaces:**
- Produces:
  - `type Doc = { id: string; title: string; src: "JavaScript docs" | "TypeScript docs" | "Python docs"; tags: string; snippet: string; syntax: string; example: string; detail: string; see: string[]; words: string[] }` — `words` are the identifiers a hover matches (for example `["for"]`, `["push"]`).
  - `DOCS: Doc[]` — first set matches the JS/TS track's first concepts: `for` loop, `while` loop, `let and const`, `if...else`, Functions, `Array.prototype.push`, `Array.prototype.map`, `console.log`; plus Python `for`, `if`, `def`, `print`, `input`. Copy the JS entries' text from the design's `allDocs`. Written by hand, generic, no lesson answers.
  - `searchDocs(q: string, docs?: Doc[]): Doc[]` — matches title, tags and snippet.
  - `docForWord(word: string, language: "javascript" | "typescript" | "python"): Doc | undefined`.
  - `DocsPanel({ selected, onSelect })`: search box, result list while typing, then the selected doc with Syntax, Example, Details, See also (buttons).
- Palette docs mode (Task 4) uses `DOCS` mapped to `PaletteItem`.

- [ ] **Step 1: Write the failing tests:** `searchDocs("loop")` includes `for` and `while`; `searchDocs("")` is empty; every `see` id exists in `DOCS`; `docForWord("push", "javascript")?.id === "push"`; `docForWord("print", "javascript")` is `undefined`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Browser check on `/test/editor`** for this task's UI before committing.
- [ ] **Step 5: Commit** `feat(web): docs panel with a starter JS, TS and Python catalogue`

### Task 6: Editor help (IntelliSense as a learning aid)

**Files:**
- Create: `apps/web/src/player/workbench/editorHelp.ts`
- Modify: `apps/web/src/player/EditorPane.tsx` (optional `help?: (monaco, editor) => IDisposable` prop, called on mount and disposed on unmount)
- Modify: `apps/web/src/player/monaco.ts` (turn syntax diagnostics back on for practice models only; replay snippets keep them off)

**Interfaces:**
- Consumes: `DOCS`, `docForWord` (Task 5).
- Produces: `registerEditorHelp(monaco, language, onOpenDoc: (id: string) => void): IDisposable` that registers:
  - a **hover provider**: hovering a word with a `Doc` shows its title, snippet and an "Open in Docs" command link that calls `onOpenDoc`;
  - a **completion item provider** that adds `detail`/`documentation` (snippet + example in Markdown) to Monaco's own suggestions for words in `DOCS` (no new snippets that write code);
  - error hovers keep Monaco's message and append a one-line plain-English explanation for `ReferenceError`-style "Cannot find name" and syntax errors. No quick fixes.
- Turn `hover: { enabled: "on" }` only when `help` is passed.

- [ ] **Step 1: Write the failing test** in `apps/web/src/player/workbench/editorHelp.test.ts` for the pure part: `explainMarker("Cannot find name 'step'.")` returns a sentence that mentions creating a name before using it; an unknown message returns `undefined`. Put `explainMarker(message: string): string | undefined` in `editorHelp.ts` with no Monaco import at module top (import types only) so `node --test` can load it.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; browser check on `/test/editor`: hover `push` shows the doc; "Open in Docs" switches the utility area to Docs on that entry.
- [ ] **Step 5: Commit** `feat(web): editor hovers explain code with the docs catalogue`

### Task 7: Move practice onto the workbench

**Files:**
- Create: `apps/web/src/player/workbench/Navigator.tsx`
- Modify: `apps/web/src/player/live/PracticeView.tsx` (replace the `<Player …>` return; keep all state and handlers)
- Modify: `apps/web/src/player/terminal/TerminalPanel.tsx` (drop the embedded `FileTree` column; restyle the header to the workbench bottom-panel look: tabs "Terminal" and "Output", buttons Refresh and Close)

**Interfaces:**
- Consumes: `Workbench` and the test page's working layout (Task 3), palette, docs and editor help (Tasks 4–6), existing `FileTree({ refreshKey })`, `TerminalPanel`, `EditorPane`.
- Produces: `Navigator({ view, onView, treeKey, onRefreshTree, sandbox: "on" | "off" | "signed_out" })` with two views: **Files** (the `FileTree`, or the shell's message when the sandbox is off or signed out — Review Focus 5) and **Problems** (the last run's error line, or "No problems found").

- [ ] **Step 0: Start only once `/test/editor` matches the design boards** in light and dark with the palette, docs and hovers working. Do not move real lessons before that.
- [ ] **Step 1: Render practice in the workbench.** Mapping from today's view:
  - `part.instructions` → utility area, Instructions tab.
  - Run / Stop / Check / `next` → `actions` slot. Disabled rules unchanged (`starting || sid !== null || shellRun`).
  - Verdict badge → `status.verdict`, still `role="status" aria-live="polite"`, still remounts on every Check.
  - Program output + stdin form (the test page's fake Output tab becomes the real one) → an "Output" tab in the bottom panel, next to "Terminal"; it becomes active when a one-shot run or Check starts.
  - `EditorPane` gets `theme={resolved === "dark" ? "learnslop-dark" : "learnslop-light"}` and JetBrains Mono.
- [ ] **Step 2: Keep the existing tests green:** `pnpm --filter @learnquest/web test` (practiceActions, runInShell, usePanel, shellSocket).
- [ ] **Step 3: Browser check** with `preview_start` on a seeded practice lesson: type code, Run (terminal shows output), Check (verdict appears), Stop on an `input()` program, Next. Sandbox off (`SANDBOX_ENABLED=false` or equivalent in `apps/api/.env`): Files view shows the message and Run uses the one-shot path.
- [ ] **Step 4: Commit** `feat(web): practice lessons use the workbench layout`

### Task 8: Docs, full CI and visual check

**Files:**
- Modify: `DESIGN.md` (new "Workbench (practice view)" section: tokens, fonts, regions, where the sticker style still applies)
- Modify: `docs/player-ui-plan.md` (practice now uses the workbench; list the out-of-scope items as follow-ups)

- [ ] **Step 1: Write the doc changes.**
- [ ] **Step 2: Browser checks** with `preview_start`: 1440×900 light and dark against the design boards, on `/test/editor` and on a real practice lesson; 768 and 375 wide with no horizontal scroll (Review Focus 1); keyboard-only pass (Tab through toolbar, splitters with arrows, palette, Esc).
- [ ] **Step 3: Full CI** against the test Postgres:
  `TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5433/learnquest_test pnpm exec turbo run lint test build` — all green.
- [ ] **Step 4: Commit** `docs: describe the practice workbench` and open the PR (one concern: the practice view).
