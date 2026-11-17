# Handoff: move every practice lesson onto the workbench

Date: 2026-11-14. Owner: Nachiketh. Implementer: Sonnet. Status: ready to start.

Read this file top to bottom before touching code. It replaces the earlier plan
`2026-11-06-practice-workbench.md` for the practice part. Tasks 1 to 6 of that plan are
partly done, and the plan's "matches the design in light and dark" gate is dropped.

## The goal, in one line

Every practice lesson at `/play?lesson=<slug>` shows the IDE workbench from the target
screenshot, with the lesson's own file, Run, Check, Lint, Sloppy and the terminal wired in.
Nothing in practice uses the old sticker layout any more.

## Target styling (the reference)

- Target: `docs/superpowers/plans/assets/practice-workbench-target.png`
- Old view that must go: `docs/superpowers/plans/assets/practice-old-view.png`

The target is the dark "LearnSlop Workbench" window on a desktop background:

- Left activity bar with icon tabs (explorer, search, source control, debug, problems) and a
  file tree of the project.
- Top toolbar: back and forward buttons, the title, and the **Run** (blue pill) and **Check**
  (outline pill) buttons, then three layout toggles on the right.
- Breadcrumb above the editor (project › folder › file with a language badge).
- Editor with line numbers and a palette of syntax colours.
- Right **Docs** panel with its search field.
- Bottom **Terminal** panel with its own toolbar (+, split, expand, close).
- Status bar: error and warning counts, Ready, Wrap, Spaces, UTF-8, language, and a green dot.
- Dock at the bottom of the screen (hidden on narrow screens, see the risks below).

Those parts already exist in `apps/web/src/player/workbench/` and in `/editor`. Do not restyle
them. Reuse them.

## What exists today (checked on 2026-11-14)

| Route | Component | Look | Status |
|---|---|---|---|
| `/play?lesson=<slug>` (practice part) | `apps/web/src/player/live/PracticeView.tsx` (327 lines), via `LiveLesson.tsx` | old sticker `Player` layout | **must change** |
| `/editor?lesson=<slug>` | `apps/web/src/pages/TestEditor.tsx` (1,274+ lines) | target workbench look | dev-only; shows the demo "Task Tracker" project and only the lesson's instructions and language |
| `/test/editor` | same component, no lesson | target look | dev-only, keep working |

`PracticeView` today renders `Player` with the instructions panel, a footer of buttons
(Terminal, Check, Lint, Sloppy, Next), one `EditorPane` for the lesson code, a `TerminalPanel`,
an Output section, `LintFindings` and `CheckPanel`. The practice Run and Check call the real
sandbox through `runInShell`, `putFile`, `startPython`, `checkPractice` and `lintPractice`.

`TestEditor` renders `Workbench` (`apps/web/src/player/workbench/Workbench.tsx`, 574 lines). It
takes slots: `navigator`, `editor`, `bottom`, `docs`, `actions`, `aiContext`, `paletteCommands`
and so on. `showPlanned` draws the planned, inert controls. Its own comment says the practice
view must not show dead controls, so practice must **not** set `showPlanned`.

Lesson data comes from `trpc.lessons.get.query({ id: slug })`. A practice part gives
`instructions`, `language`, `starterCode` and `tests`. `testEditorLesson.ts` already maps the
part to `{ instructions, language }` for `/editor`.

## Hard rules (from AGENTS.md, plus this project)

- **Never ship answers to the client.** Do not add expected output, hidden tests, solution
  files or answer keys to any response or bundle. The sample `expectedStdout` that the API
  currently sends is an open decision (see "Open decisions"). Do not add to it.
- **Predict before reveal** still applies to lesson content. Do not show a solution before the
  learner has tried.
- **Sloppy stays.** It is the help chat for when a learner is stuck. Its guardrails stop the
  finished answer. Keep the existing `AIGuide` (`PlannedParts.tsx`) and `SloppyPanel`.
- **Model-agnostic AI.** Do not add provider calls from the web app.
- **Small change sets.** One concern per commit. Conventional Commits, body wrapped at 72.
- **Do not commit or push unless asked.** Work on the current branch
  `t3/migrate-test-editor-experience`. Leave changes in the working tree and report them.
- **Do not touch** the env files (`apps/api/.env`, `services/engine/.env`). They are local
  and git-ignored, and hold secrets.

## Work, in order

Each step ends with a check you must run and report. Do not skip a step.

### Step 1: a reusable lesson workbench

Extract the workbench body from `TestEditor.tsx` into a component that takes a lesson, for
example `LessonWorkbench` in `apps/web/src/player/workbench/LessonWorkbench.tsx`. Its props:
`lessonTitle`, `instructions`, `language`, `starterCode`, and a `mode` of `"demo"` or
`"lesson"`.

- `/test/editor` renders `LessonWorkbench` in `demo` mode with the existing demo project.
  Nothing looks or behaves differently there.
- `/editor` keeps working. Pass the lesson through.

Check: `/test/editor` screenshot matches the pre-change screenshot. Take one before you start.

### Step 2: the lesson's file in the workbench

In `lesson` mode the workbench shows the lesson's own file (for example `solution.js`, from
`solutionFile(language)` in `checkModel.ts`) with `starterCode` as its content. The file tree
shows that file and no demo files.

- Edits stay in the editor until Run, Check or save. Use the existing save path for the sandbox
  if the sandbox is on. If it is off, keep the buffer in memory and say so in the status bar.
- Breadcrumb: lesson title › `solution.js`. Status bar language from `language`.

Check: open `/play?lesson=swapping-and-updating-variable-values-e6aaad50c34e` and confirm the
file tree and breadcrumb show `solution.js` and the instructions are in the Docs/instructions
panel.

### Step 3: actions

- **Run:** use the same path as `PracticeView.run` (`runInShell` when the shell is up, else the
  one-shot `startPython` or fallback). Output goes to the Terminal panel, the way it does today.
- **Check:** call `checkPractice(...actionsFor(sandboxEnabled).check.args)` and show the result
  in the `CheckPanel` inside the workbench. Replace the TestEditor stub "Check needs a real
  lesson".
- **Lint:** call `lintPractice`, then show findings as editor markers and in `LintFindings`.
- **Sloppy:** pass `aiContext` so the workbench's AI tab mounts `AIGuide` with the lesson's
  code and language. `askAbout` from a lint finding should open that tab with the finding.
- **Terminal:** the existing `TerminalPanel` (`player/terminal/`) inside the workbench's bottom
  slot.

Put Run and Check in the workbench toolbar slot (`actions`), the way the target shows them.

Check: each button does what `PracticeView` does today. Compare the results with the old view
by hand, using the same lesson.

### Step 4: route every practice part through the workbench

In `LiveLesson.tsx`, render `LessonWorkbench` for `kind: "practice"` parts. Keep the `Player`
path for `learn` and `watch` parts unchanged (see "Open decisions").

- Remove the `PracticeView` branch once Steps 1 to 3 pass.
- Keep the `next` button (the lesson's next part) reachable from the workbench toolbar.
- Keep `PracticeView.tsx` deleted in the same commit, not left behind.

Check: every practice lesson in the local database opens in the workbench. Query the list with
`psql "postgres://learnquest:learnquest@localhost:5432/learnquest" -Atc "select slug from lessons where kind='practice' and status='published';"`.

### Step 5: tests and cleanup

- Unit tests for any pure helper you add (a file-for-lesson helper, a mapper). Follow the style
  of `apps/web/src/pages/testEditorLesson.test.ts`.
- Remove any dead code the extraction leaves behind in `TestEditor.tsx`.
- Update `docs/plan.md` and this handoff's "status" line with what shipped.

## Verification you must run and report

Run from `apps/web`. Report each result as pass or fail with the key output line.

1. `pnpm exec tsc --noEmit`
2. `node --test src/pages/testEditorLesson.test.ts src/pages/testEditorFixture.test.ts` plus any new
   test files
3. `pnpm exec eslint src` (or at least every file you changed)
4. `pnpm exec vite build`
5. If you touched the API: from `apps/api`, `node --test --test-concurrency=1 test/sandbox-docker.test.ts test/sandbox-daytona.test.ts test/sec-hardening.test.ts`
   and `pnpm exec tsc --noEmit`

Then the browser check. The local stack should be running: API on 3000, web on 5173, and the
engine on 8000. If not, start them with the commands in the README.

- Open `/play?lesson=swapping-and-updating-variable-values-e6aaad50c34e` in the preview browser
  and take a screenshot. Compare it with `practice-workbench-target.png`. Report the differences
  you can see.
- Open `/editor` and `/test/editor` and confirm they still render.
- Check Lint and Sloppy in the browser. Check and Run need the sandbox (see "Local limits").

## Acceptance criteria

1. Every published practice lesson renders in the workbench look at `/play`.
2. The old `PracticeView` sticker layout is gone from practice.
3. `/test/editor` and `/editor` still work.
4. No answer data is added to any client response or bundle (diff the `lessons.get` payload
   before and after and show that nothing new is in it).
5. Sloppy, Lint and Check each work from the workbench, or the report says which one does not
   and why.
6. Every verification above is run, and the results are reported honestly.

## Local limits

- The sandbox is off here (`SANDBOX_ENABLED=false`), and Docker is not running. Run and Check
  in the terminal therefore show "Sandbox is disabled". That is expected. Do not work around it
  by editing env files. Report it.
- The engine's `LLM_MODEL` has the `openai/` prefix and `LLM_JSON_MODE=object` (both set in
  `services/engine/.env`). Do not change them.
- Local media storage is off, so no S3 or R2 calls are made.

## Risks

- **Answer leak through the sample tests.** `lessons.get` sends `expectedStdout` for sample
  tests, which conflicts with AGENTS.md. Until the owner decides (see below), do not make it
  worse, and do not render the expected output anywhere new.
- **Isolation headers for WebContainer.** `/editor` and `/test/editor` get the COOP and COEP
  headers from `apps/web/vite.config.ts` in dev. Production has no equivalent. Practice must not
  break embedded videos, so put any header change on the practice route only. Do not change
  production config without the owner's approval.
- **Mobile.** The dock is hidden below the `md` breakpoint. Practice on a phone needs a plan.
  Do not remove the dock on desktop to solve it.
- **Bundle size.** Monaco, the terminal and the preview devtools should load on demand. Check the
  build output does not grow the main chunk by more than it already is.

## Open decisions (ask the owner, do not decide)

1. Sample test `expectedStdout` is currently sent to the browser. Keep it, or show only pass or
   fail?
2. Do `learn` and `watch` parts also move to the workbench look, or only `practice`?
3. Production isolation headers and the WebContainer licence. Approve or defer?
4. Mobile practice: a single-column fallback, or desktop only for now?

Ask these in your final report. Do not guess. Steps 1 to 4 can still ship with the defaults
written above (practice only, sample output unchanged, no production header change).

## Status

2026-11-14: steps 1 to 5 done in the working tree (nothing committed). Pending: independent review
(gpt-6-luna, gpt-6.1-terra, an OpenCode free model) and the owner's answers to the open decisions.

What shipped:

- `LessonWorkbench` (`apps/web/src/player/live/LessonWorkbench.tsx`) renders every `practice` part at
  `/play` in the `Workbench`: the lesson's `solution.<ext>` in the tree, breadcrumb and editor; Run,
  Check, Lint, Sloppy and Next in the toolbar; Task, Results, Sloppy and Docs tabs on the right; the
  sandbox terminal (with an Output pane for one-shot runs) at the bottom. `showPlanned` is off.
- `usePracticeRunner` holds Run, Check, Lint and the shell socket, ported from `PracticeView`.
- `LessonResults` draws Check results and style findings with the workbench tokens.
- `PracticeView.tsx` is deleted. `LiveLesson` lazy-loads `LessonWorkbench`. `learn`, `watch`,
  `predict` and `game-practice` parts are unchanged.

Rulings (deviations from this handoff):

- Step 1: `TestEditor.tsx` was not refactored. Its 1,288 lines are workspace-sync code (saves, preview,
  dock) that a lesson does not use, so `LessonWorkbench` composes `Workbench` directly. `/editor` and
  `/test/editor` are untouched. Cost if wrong: the two editors share the `Workbench` shell but not
  their wiring.
- Step 3: the workbench's own AI tab is drawn only with `showPlanned`, so Sloppy lives as a tab in the
  right panel (`AIGuide`, kept mounted after first use so the chat survives a tab switch).
- The floating window on the desk and the dock were not added to practice: the dock holds Browser and
  Notepad, which a lesson does not have. Cost if wrong: the practice window fills the desk instead of
  floating over it.

Verification (apps/web, run 2026-11-14): `tsc --noEmit` pass; `eslint src` pass; `pnpm test` 276 of
276 pass, coverage gates met; `vite build` pass. Browser: `/play?lesson=swapping-and-updating-variable-values-e6aaad50c34e`
shows the workbench; Check and Lint show "Sandbox is disabled" and "Lint is busy" (local sandbox
off, expected); `/test/editor` still renders. Run was not exercised (sandbox off).
