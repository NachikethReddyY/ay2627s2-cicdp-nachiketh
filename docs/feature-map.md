# Feature map

The features of LearnSlop as a learner sees them, with the route and the code that owns each. Use these names in prompts, tests and PR descriptions so an agent does not have to guess what "the thing in the sidebar" is. Keep it in step with `apps/web/src/main.tsx`; add a row in the same PR that adds a screen.

Routes marked dev or test only exist in non-production builds.

## Screens

| Name | Route | Code | What the learner does |
|---|---|---|---|
| Landing | `/` (signed out) | `apps/web/src/pages/Landing.tsx` | Scrolls through six full-screen learning mode examples, then shows the six cards together on black. Visitors can try a Scrim prediction. Pro and the advanced track are marked coming soon. |
| Home | `/` (signed in) | `apps/web/src/pages/Home.tsx`, parts in `pages/home/` | Sees **Continue** with its recommendation and reason and a direct **Resume** link when the most recent unfinished lesson differs. The next learning action appears first on both desktop and phones, followed by total XP, streak, daily goal and path progress. New learners can open Explore from Home. Home also shows **What you know** (mastery), **Before and after** (pre-/post-test scores), **Your paths**, **Learn a programming concept** and the **Weekly XP leaderboard**. The generator creates a private path. Top weekly rows show a public handle and XP. |
| Spaced review | `/review/$slug` | `apps/web/src/pages/Review.tsx`, `apps/api/src/progress/review.ts` | Gets a due prediction from a previously answered lesson. Checks it server-side before showing the answer and scheduling the next review. |
| Sign in | `/login` | `apps/web/src/pages/Login.tsx` | Signs in or up with Better Auth. |
| Handle onboarding | `/onboarding` | `apps/web/src/pages/Onboarding.tsx` | New learners and existing learners who haven't confirmed a handle see how the leaderboard uses it, then accept or edit their generated handle before entering the app. |
| Explore | `/explore` | `apps/web/src/pages/Explore.tsx` | Searches and browses paths in **Official**, **Community**, and **Mine**. The creator can publish a private path through `paths.publish` after automatic moderation. When that check is unavailable, Explore explains why the path stays private. Cards without cover art use a bundled cover. |
| Course | `/courses/$slug` | `apps/web/src/pages/course/` | Sees the **Path track** of lesson nodes and opens one. A generated course writes all its lessons in the background, three at a time. While some are still writing the page shows how many are ready, with **Check again**. A lesson tagged **Writing…** is still being written; **Couldn't write** or **Not written yet** lessons offer **Write now** (`lessons.write`). Write states come from `courses.get` (`writeState`) and live in process memory (`apps/api/src/ai/service.ts`). |
| Lesson player | `/lessons?lesson=<slug>` | `apps/web/src/player/LessonPage.tsx` | Opens a saved lesson directly. If its content has yet to be written, the player requests a write and opens the resulting lesson. See below. |
| Studio | `/studio`, `/studio/preview` | `apps/web/src/pages/studio/`, `apps/api/src/studio/` | Creates a narrated draft from a Python documentation page, transcribes the narration with Whisper, and previews timed code edits with prediction pauses. The authoring routes use `VITE_STUDIO` in production builds and the API uses `STUDIO_ENABLED`. |
| Editor lab | `/editor?lesson=<slug>` (optional `&course=<slug>`) | `apps/web/src/pages/EditorLab.tsx`, target in `pages/labTarget.ts` | Opens the same **Workbench** as `/lessons`, with Run, Lint, Submit, the terminal, the file tree and Sloppy. Narrated practice lessons have a **Watch** action in Task. A scrim lab opens after all its predictions are confirmed. **Results** offers the reference solution after three graded submissions for the current lesson version, when the exercise has a saved solution. Run and Lint do not count. All expected output and hidden test inputs stay server-side. |
| Account | `/account` | `apps/web/src/pages/Account.tsx` | Changes their public handle under **Profile** once every 30 days after confirming it and sees when they can change it again. |
| AI spend | `/admin` | `apps/web/src/pages/Admin.tsx` | Admins see daily and month-to-date calls, token totals, and estimated USD. See [AI spend dashboard](ai-spend.md). |
| Feedback | `/feedback` | `apps/web/src/pages/Feedback.tsx`, `apps/api/src/feedback/` | Anyone can report a bug, request a feature or give general feedback with a reply email. Bug reports can include one screenshot. |
| Feedback inbox | `/admin/feedback`, `/admin/feedback/$reportId` | `apps/web/src/pages/AdminFeedback.tsx`, `apps/api/src/feedback/` | Admins open private reports, view the screenshot and use the reply email to follow up. |
| Docs | `/docs` | `apps/web/src/pages/Docs.tsx` | Reads how lessons work, sees the Free limits and planned Pro limits, and finds the feedback link. |
| Changelog | `/changelog` | `apps/web/src/pages/Changelog.tsx` | Reads the committed release notes and can open the feedback form. Refresh the release notes with `pnpm --filter @learnquest/web changelog:sync`. |
| Block gallery (dev) | `/dev/blocks` | `apps/web/src/pages/DevBlocks.tsx` | Previews every UI block. |
| Diff view (dev) | `/diff` | `apps/web/src/player/DiffPage.tsx` | Compares lesson versions. |
| Player replay fixture (test) | `/test/player` | `apps/web/src/pages/TestPlayer.tsx`, `TestEditor.tsx` | Development harness for the replay transport and editor. Browser tests for practice use the Editor lab and Lesson player routes. |

The Course Path track labels one lesson **Up next** and distinguishes it from other available, complete and locked lessons. The syllabus shows the same states.

## Inside the lesson player

| Name | Code | Notes |
|---|---|---|
| Workbench | `player/live/LessonWorkbench.tsx` | The top toolbar opens File explorer and Sloppy AI. Sloppy opens on the right alongside the editor, where the lesson panel offers Task, Results and Docs. On desktop the dock provides shortcuts to the editor, Terminal, Task, Docs and Sloppy. |
| Steps | `player/live/Steps.tsx`, `player/stepMachine.ts` | The lesson step sequence. **Predict before reveal** is enforced here and on the server. |
| Editor pane | `player/EditorPane.tsx` | Monaco editor for practice code. |
| Explorer / file tree | `player/workbench/SandboxFiles.tsx`, `player/workbench/FileTreeView.tsx` | In Files, the Explorer lists the current lesson workspace. Its toolbar creates files and folders, saves the selected file and refreshes the list. Search finds text in the open file, and Problems lists its editor and lint diagnostics. Source control and the debugger are unavailable in lesson workspaces. |
| Terminal | `player/terminal/`, `player/live/RunBottom.tsx` | In practice, Run saves the solution and starts it in the active Terminal session for the lesson workspace. Enter stdin in the terminal and press Ctrl+D on an empty line to send EOF, or Ctrl+C to interrupt. Authored scrim playback uses Console for isolated runs. |
| Check results | `player/live/LessonResults.tsx`, `player/live/checkModel.ts` | Sample tests show expected output. Hidden tests never do. |
| AI design feedback | `player/live/PracticeDesignFeedback.tsx`, `apps/api/src/ai/design-feedback.ts` | After Submit is graded, **Get design feedback** requests one line-specific design suggestion in Results. Only the submitted code and language go to the model. The request shares Sloppy's AI budget and rate limit, and editing the code clears the card. |
| Hint | server `stepsRouter.hint` (`apps/api/src/attempts/router.ts`) | Requested by the learner. Returns the next fixed hint rung stored on the step. |
| Reveal | server `stepsRouter.reveal` | Only after the learner finishes or skips. |
| Generation limits | `packages/product-limits/src/index.ts` | Free accounts can generate five AI paths and one image per rolling 24 hours. |
| Sloppy chat | `player/workbench/PlannedParts.tsx`, opened by **Ask Sloppy** in `player/live/LessonResults.tsx` | One chat per lab for editor selections, lint findings, and video questions. Sloppy uses the lab instructions and recent replies, including their cards, to give a new clue. It displays hints, numbered observations, and prediction questions as cards and scrolls to the latest reply. Requests are moderated and budgeted. The engine rejects code-like replies and exact repeats, the API filters known lesson answers, and a reply backed by an open prediction's hint records hint use. |
| Game practice | `player/GamePracticeView.tsx`, `blocks/game/` | Grid, order, match, sort, physics and quiz parts. Order, match and sort show a distinct item pool where needed and labeled placement rows. Read-only games in Learn show the title, goal and description. |
| Visual blocks | `blocks/VisualView.tsx`, `blocks/registry.ts`, `packages/ui-catalog` | Validates the document before rendering and loads each block renderer on demand. Rejected or unsupported blocks show fallback text. |
| Command palette | `player/workbench/CommandPalette.tsx` | Keyboard entry to actions. |
| Transport bar | `player/TransportBar.tsx` | Replay controls for code replay. |

## Lesson kinds

A lesson's `kind` decides which parts the player shows. The kind is stored on `lessons.kind`.

| Name | Kind | What the learner does | Code |
|---|---|---|---|
| Predict | `predict` | Answers each question before the reveal to complete the lesson. Newly generated Predict lessons use four-option multiple choice. Authored and previously saved lessons can also use cloze. Choices and revealed answers preserve line breaks, which are announced as “new line” for screen readers. The read-only Workbench shows the prediction beside the code and enables replay after the answer. | `player/live/Steps.tsx` and `player/live/PredictWorkbench.tsx`, `apps/api/src/attempts/` |
| Learn | `learn` | Makes an opening prediction, reads a short lesson and completes a closing check. Owners can update older AI lessons with missing checks. Public replacements must pass moderation. Previous completions remain available. | `player/LiveLesson.tsx` |
| Watch | `watch` | Makes an opening prediction, replays a code change and completes a closing check. **Edit from here** pauses Watch and makes a temporary copy of the visible replay files. **Run** executes the selected JavaScript, TypeScript or Python file in the sandbox and shows terminal output. Owners can update older AI lessons with missing checks. Public replacements must pass moderation. Previous completions remain available. | `player/LiveLesson.tsx` |
| Practice | `practice` | Edits code with Run, Lint and Submit in the lab. Lint checks for code issues and formatting (Prettier for JavaScript and TypeScript, Ruff for Python). Findings appear in Results and in the editor. Editing clears the findings and test results. Watch appears when the lesson has narration. | `player/live/LessonWorkbench.tsx` |
| Game practice | `game-practice` | Checks games on the server. Watch-mode grids send board states for replay and keep the authored command program server-side. Each block allows three wrong guesses per UTC day by default, or the authored lives limit. Hints unlock in order and are recorded per learner and block. Every game block in the current lesson needs a win, and replaying an unchanged block does not grant XP again. Games inside Learn documents are read-only. | `player/GamePracticeView.tsx`, `apps/api/src/progress/games.ts` |
| Scrim | `scrim` | Watches a short narrated run of code, one timed segment at a time. Segment runs stream to the Console from isolated processes. Runs share a queue with manual Run presses. A **gate** holds playback at the start of its segment until the gate step is revealed, so the prediction comes first. A gate cannot be skipped. `lessons.get` sends segments only up to the first unrevealed gate, `lessons.scrimMore` sends the next slice once that gate is revealed, every step route refuses a gate behind it, and the lesson counts as done only when every gate is revealed and the lab is passed. Captions and playback controls float above the workbench and stay in place when the terminal opens. The lesson ends with a practice lab. | Player `apps/web/src/player/scrim/` (`ScrimWatch`, `GatePanel`, model in `scrimModel.ts`). Content schema `apps/api/src/parts/scrim-schema.ts`, stored in `lesson_versions.content`. Lab grading `apps/api/src/parts/practice.ts`. Narration in `lesson_media` with `segment` set, `apps/api/src/media/`. Generated scrims: the engine drafts one for a code course, and the API stores its gate steps as ordinary mcq `steps` rows, so `lessons.get` never sends the answers or hints. Seeded demo `worlds/scrim-demo/`. |


In newly generated Predict lessons, the question states the proposed change, input, or requirement beside the starter code. The patch and answer key become available after the learner answers.
If the scenario and question repeat the correct option, the engine rejects the draft and directs its existing repair attempt to rephrase the scenario or ask about a different consequence of the same edit.

Game wins follow a renamed block when its game content is unchanged and the rename is unambiguous. If two former IDs for the same game return together, the ID present in the previous revision keeps the win. If both were absent, the first ID in sort order keeps it.

The lab of a scrim opens at `/editor?lesson=<scrim slug>` (the **Editor lab**) after all predictions are confirmed. The server checks the predictions again at submission. The lesson player (`/lessons`) plays the segments, holds at gates, and opens the practice workbench after **Start the lab**.

## Server pieces a feature depends on

| Name | Code |
|---|---|
| Lesson and step API | `apps/api/src/lessons/`, `apps/api/src/parts/` |
| Attempts and mastery (BKT) | `apps/api/src/attempts/`, `apps/api/src/progress/` |
| Practice grading and sandbox | `apps/api/src/grading/`, `apps/api/src/sandbox/`, `services/sandbox` |
| Lesson generation | `apps/api/src/ai/`, `services/engine` |
| Path sharing | `apps/api/src/progress/paths.ts` (`paths.publish`) |
| Leaderboard | `apps/api/src/progress/home.ts` (`home.get`), `pages/home/Leaderboard.tsx` |
| Handle onboarding and editing | `apps/api/src/progress/handle.ts` (`me.handle`) |
| Sloppy chat endpoint | `apps/api/src/dev/route.ts` (`POST /api/guide/chat`), lesson context in `apps/api/src/ai/guide-context.ts` |
| Seeded sample worlds | `worlds/`, `apps/api/src/db/seed.ts` (`SAMPLE_WORLDS` lists the sample courses; `worlds/scrim-demo` seeds one scrim, and its narration is silent placeholder audio) |

## Driving the app

`pnpm dev` starts the API and web. The e2e suite in `e2e/` runs against a fake LLM (`e2e/fake-llm`) and needs no provider keys. Use the screen names above when you describe what you did or saw.
