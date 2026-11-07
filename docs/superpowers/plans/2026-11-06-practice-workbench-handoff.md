# Handoff: Practice Workbench

Date: 2026-11-06. Status: **planned, not started.** No code written, nothing committed.

## What this is

The practice lesson view moves from the current desktop-and-windows `Player` layout to the
"LearnSlop Workbench" IDE layout from the design canvas
(https://claude.ai/artifact/W6ta9hWi5yb9LXCxDMse6X). Watch, replay and diff views stay as they are.

The full plan is [2026-11-06-practice-workbench.md](2026-11-06-practice-workbench.md). Read it
before starting. It has the exact colour tokens, size limits, keyboard shortcuts and per-task
tests.

## Key decision: build on a test page first

The user asked for a separate test environment so the workbench can be edited and checked without
touching real lessons.

- The route is **`/test/editor`**, not `/#test/editor`. The app uses TanStack Router with path
  routes, so a hash URL would just open the home page.
- It is dev-only. It's registered behind `import.meta.env.DEV`, the same way as `/diff` in
  `apps/web/src/main.tsx`:
  ```ts
  const DiffPage = import.meta.env.DEV ? lazy(() => import("./player/DiffPage")) : null;
  ...(DiffPage ? [createRoute({ ...r, path: "/diff", component: () => <DiffPage /> })] : [])
  ```
- No `beforeLoad: guard`, no API or sandbox calls. Run prints fake output, and Check shows
  "Check needs a real lesson".
- Fixtures go in `apps/web/src/pages/testEditorFixture.ts`, and the page in
  `apps/web/src/pages/TestEditor.tsx`. `?language=` switches between the JS, TS and Python
  fixtures. Fixtures must not contain real lesson answers.
- Add `/test` to `isQuiet` in `main.tsx`, which turns off button sounds there.
- A production build must 404 on `/test/editor`. Check this with `vite preview`.

## Task order

1. Layout state reducer (`player/workbench/layout.ts`, localStorage `lq.workbench`).
2. Theme tokens, fonts (Inter and JetBrains Mono) and Monaco themes (`lq.theme`).
3. Workbench shell, toolbar, and the `/test/editor` page.
4. Command palette (`Cmd+P` files, `Cmd+Shift+P` commands, `?` docs).
5. Docs catalogue and Docs panel.
6. Editor help: hovers that explain errors and never rewrite code.
7. Move real practice onto the workbench. Start this only once `/test/editor` matches the design
   in both light and dark.
8. Docs updates, the full CI run, and a visual check of both `/test/editor` and a real lesson.

Tasks 4–6 each get a browser check on `/test/editor` before their commit.

## Out of scope

The AI guide "Sloppy" is out of scope because it conflicts with the no-free-chat-tutor rule. Also
left out: the debugger, source control, Share, notifications, preview, and search across files.
Leave these out of the UI rather than adding buttons that do nothing.

## Open question for the user

The user still needs to choose how to run the plan:
- **Native (recommended):** one session implements every task in order, because each task builds
  on the last. One reviewer then checks the whole branch.
- **Subagent-driven:** a fresh subagent implements each task and a reviewer checks it.

## Before starting

- `main` is currently checked out. Create a branch first, for example `feat/practice-workbench`.
- Untracked files are not part of this work. Don't commit `apps/api/.env.render` or
  `services/engine/.env.render`; they may hold secrets. The plan file and this handoff are also
  untracked. Commit them with the first task or as a separate `docs:` commit.
- Before any PR, run the full CI against the test Postgres on 5433:
  ```bash
  TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5433/learnquest_test pnpm exec turbo run lint test build
  ```
- Commits use Conventional Commits and end with `Co-Authored-By: Claude <model name>`, with no
  email. PRs follow the `file-pr` skill format.
- Ask before changing scope, audience, auth or deploy.
