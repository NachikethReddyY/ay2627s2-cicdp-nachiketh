# Feature map

The features of LearnSlop as a learner sees them, with the route and the code that owns each. Use these names in prompts, tests and PR descriptions so an agent does not have to guess what "the thing in the sidebar" is. Keep it in step with `apps/web/src/main.tsx`; add a row in the same PR that adds a screen.

Routes marked dev or test only exist in non-production builds.

## Screens

| Name | Route | Code | What the learner does |
|---|---|---|---|
| Landing | `/` (signed out) | `apps/web/src/pages/Landing.tsx` | Reads the pitch and sees Pro and the advanced track marked coming soon. |
| Home | `/` (signed in) | `apps/web/src/pages/Home.tsx`, parts in `pages/home/` | Sees **Continue**, **Your paths**, **Learn a programming concept** and the **Weekly XP leaderboard**. The generator creates a private path. Top weekly rows show a generated handle and XP. |
| Sign in | `/login` | `apps/web/src/pages/Login.tsx` | Signs in or up with Better Auth. |
| Explore | `/explore` | `apps/web/src/pages/Explore.tsx` | Browses collections and paths. The creator can publish a private path through `paths.publish` after automatic moderation. |
| Course | `/courses/$slug` | `apps/web/src/pages/course/` | Sees the **Path track** of lesson nodes and opens one. A generated course writes all its lessons in the background, three at a time. While some are still writing the page shows how many are ready, with **Check again**. A lesson tagged **Writing…** is still being written; **Couldn't write** or **Not written yet** lessons offer **Write now** (`lessons.write`). Write states come from `courses.get` (`writeState`) and live in process memory (`apps/api/src/ai/service.ts`). |
| Lesson player | `/play` | `apps/web/src/player/` | Works through one lesson. See below. |
| Editor lab | `/editor?lesson=<slug>` (optional `&course=<slug>`) | `apps/web/src/pages/EditorLab.tsx`, target in `pages/labTarget.ts` | Opens the practice lab of a practice lesson, or the lab a scrim ends with, in the **Workbench**. Same Run, Submit, Lint and Sloppy as `/play`. A lesson with no lab shows a notice. |
| Account | `/account` | `apps/web/src/pages/Account.tsx` | Manages the account. |
| Changelog | `/changelog` | `apps/web/src/pages/Changelog.tsx` | Reads release notes. |
| Block gallery (dev) | `/dev/blocks` | `apps/web/src/pages/DevBlocks.tsx` | Previews every UI block. |
| Diff view (dev) | `/diff` | `apps/web/src/player/DiffPage.tsx` | Compares lesson versions. |
| Editor / player fixtures (test) | `/test/editor`, `/test/player` | `apps/web/src/pages/TestEditor.tsx`, `TestPlayer.tsx` | Fixtures for e2e. |

## Inside the lesson player

| Name | Code | Notes |
|---|---|---|
| Workbench | `player/live/LessonWorkbench.tsx` | The one surface that holds the editor, panels and status bar. |
| Steps | `player/live/Steps.tsx`, `player/stepMachine.ts` | The lesson step sequence. **Predict before reveal** is enforced here and on the server. |
| Editor pane | `player/EditorPane.tsx` | Monaco editor for practice code. |
| Explorer / file tree | `player/Explorer.tsx`, `player/workbench/FileTreeView.tsx` | Files in the practice project. |
| Terminal | `player/terminal/` | Output of a practice run. |
| Check results | `player/live/LessonResults.tsx`, `player/live/checkModel.ts` | Sample tests show expected output. Hidden tests never do. |
| Hint | server `stepsRouter.hint` (`apps/api/src/attempts/router.ts`) | Requested by the learner. Returns the next fixed hint rung stored on the step. |
| Reveal | server `stepsRouter.reveal` | Only after the learner finishes or skips. |
| Generation limits | `apps/api/src/config/limits.ts` | Every learner can generate five AI paths and one image per day. |
| Sloppy chat | `player/workbench/PlannedParts.tsx`, opened by **Ask Sloppy** in `player/live/LessonResults.tsx` | The AI help chat. It is prompted to give hints. A deterministic check for finished solutions is planned (LQ-124). |
| Game practice | `player/GamePracticeView.tsx`, `blocks/game/` | Grid, order, match, sort, physics and quiz parts. |
| Diagram and scene blocks | `blocks/diagram/`, `blocks/scene3d/` | From `packages/ui-catalog`. |
| Command palette | `player/workbench/CommandPalette.tsx` | Keyboard entry to actions. |
| Transport bar | `player/TransportBar.tsx` | Replay controls for code replay. |

## Lesson kinds

A lesson's `kind` decides which parts the player shows. The kind is stored on `lessons.kind`.

| Name | Kind | What the learner does | Code |
|---|---|---|---|
| Predict | `predict` | Answers each MCQ or cloze before the reveal to complete the lesson. | `player/live/Steps.tsx`, `apps/api/src/attempts/` |
| Learn | `learn` | Makes an opening prediction, reads a short lesson and completes a closing check. Owners can update older AI lessons with missing checks. Public replacements must pass moderation. Previous completions remain available. | `player/LiveLesson.tsx` |
| Watch | `watch` | Makes an opening prediction, replays a code change and completes a closing check. Owners can update older AI lessons with missing checks. Public replacements must pass moderation. Previous completions remain available. | `player/LiveLesson.tsx` |
| Practice | `practice` | Edits code and uses Run and Check in the lab. | `player/live/LessonWorkbench.tsx` |
| Game practice | `game-practice` | Checks games on the server. Every game block in the current lesson needs a win, and replaying an unchanged block does not grant XP again. | `player/GamePracticeView.tsx`, `apps/api/src/progress/games.ts` |
| Scrim | `scrim` | Watches a short narrated run of code, one timed segment at a time. JavaScript and Python segment runs use the interactive terminal; TypeScript runs use the one-shot runner. Runs share a queue with manual Run presses. A **gate** holds playback at the start of its segment until the gate step is revealed, so the prediction comes first. A gate cannot be skipped. `lessons.get` sends segments only up to the first unrevealed gate, `lessons.scrimMore` sends the next slice once that gate is revealed, every step route refuses a gate behind it, and the lesson counts as done only when every gate is revealed and the lab is passed. Captions and playback controls float above the workbench and stay in place when the terminal opens. The lesson ends with a practice lab. | Player `apps/web/src/player/scrim/` (`ScrimWatch`, `GatePanel`, model in `scrimModel.ts`). Content schema `apps/api/src/parts/scrim-schema.ts`, stored in `lesson_versions.content`. Lab grading `apps/api/src/parts/practice.ts`. Narration in `lesson_media` with `segment` set, `apps/api/src/media/`. Generated scrims: the engine drafts one for a code course, and the API stores its gate steps as ordinary mcq `steps` rows, so `lessons.get` never sends the answers or hints. Seeded demo `worlds/scrim-demo/`. |


Game wins follow a renamed block when its game content is unchanged and the rename is unambiguous. If two former IDs for the same game return together, the ID present in the previous revision keeps the win. If both were absent, the first ID in sort order keeps it.

The lab of a scrim opens at `/editor?lesson=<scrim slug>` (the **Editor lab**), graded by the same server check as a practice lesson. The lesson player (`/play`) plays the segments, holds at gates, and opens the lab in the practice workbench after **Start the lab**.

## Server pieces a feature depends on

| Name | Code |
|---|---|
| Lesson and step API | `apps/api/src/lessons/`, `apps/api/src/parts/` |
| Attempts and mastery (BKT) | `apps/api/src/attempts/`, `apps/api/src/progress/` |
| Practice grading and sandbox | `apps/api/src/grading/`, `apps/api/src/sandbox/`, `services/sandbox` |
| Lesson generation | `apps/api/src/ai/`, `services/engine` |
| Path sharing | `apps/api/src/progress/paths.ts` (`paths.publish`) |
| Leaderboard | `apps/api/src/progress/home.ts` (`home.get`), `pages/home/Sidebar.tsx` |
| Sloppy chat endpoint | `apps/api/src/dev/route.ts` (`POST /api/guide/chat`) |
| Seeded sample worlds | `worlds/`, `apps/api/src/db/seed.ts` (`SAMPLE_WORLDS` lists the sample courses; `worlds/scrim-demo` seeds one scrim, and its narration is silent placeholder audio) |

## Driving the app

`pnpm dev` starts the API and web. The e2e suite in `e2e/` runs against a fake LLM (`e2e/fake-llm`) and needs no provider keys. Use the screen names above when you describe what you did or saw.
