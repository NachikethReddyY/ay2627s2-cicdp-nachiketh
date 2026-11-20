# Feature map

The features of LearnSlop as a learner sees them, with the route and the code that owns each. Use these names in prompts, tests and PR descriptions so an agent does not have to guess what "the thing in the sidebar" is. Keep it in step with `apps/web/src/main.tsx`; add a row in the same PR that adds a screen.

Routes marked dev or test only exist in non-production builds.

## Screens

| Name | Route | Code | What the learner does |
|---|---|---|---|
| Landing | `/` (signed out) | `apps/web/src/pages/Landing.tsx` | Reads the pitch, goes to sign in. |
| Home | `/` (signed in) | `apps/web/src/pages/Home.tsx`, parts in `pages/home/` | Sees **Continue**, **Your path** and the **Generator**, which turns a concept into a lesson. |
| Sign in | `/login` | `apps/web/src/pages/Login.tsx` | Signs in or up with Better Auth. |
| Explore | `/explore` | `apps/web/src/pages/Explore.tsx` | Browses collections and paths. |
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
| Sloppy chat | `player/workbench/PlannedParts.tsx`, opened by **Ask Sloppy** in `player/live/LessonResults.tsx` | The AI help chat. Gives hints, never the finished solution. |
| Game practice | `player/GamePracticeView.tsx`, `blocks/game/` | Grid, order, match, sort, physics and quiz parts. |
| Diagram and scene blocks | `blocks/diagram/`, `blocks/scene3d/` | From `packages/ui-catalog`. |
| Command palette | `player/workbench/CommandPalette.tsx` | Keyboard entry to actions. |
| Transport bar | `player/TransportBar.tsx` | Replay controls for code replay. |

## Lesson kinds

A lesson's `kind` decides which parts the player shows. The kind is stored on `lessons.kind`.

| Name | Kind | What the learner does | Code |
|---|---|---|---|
| Scrim | `scrim` | Watches a short narrated run of code, one timed segment at a time. A segment can change the code and run it. A **gate** holds playback at the start of its segment until the gate step is answered or skipped, so the prediction comes first. Captions and playback controls float above the workbench and stay in place when the terminal opens. The lesson ends with a practice lab. | Player `apps/web/src/player/scrim/` (`ScrimWatch`, `GatePanel`, model in `scrimModel.ts`). Content schema `apps/api/src/parts/scrim-schema.ts`, stored in `lesson_versions.content`. Lab grading `apps/api/src/parts/practice.ts`. Narration in `lesson_media` with `segment` set, `apps/api/src/media/`. Generated scrims: the engine drafts one for a code course, and the API stores its gate steps as ordinary mcq `steps` rows, so `lessons.get` never sends the answers or hints. Seeded demo `worlds/scrim-demo/`. |

The lab of a scrim opens at `/editor?lesson=<scrim slug>` (the **Editor lab**), graded by the same server check as a practice lesson. The lesson player (`/play`) plays the segments, holds at gates, and opens the lab in the practice workbench after **Start the lab**.

## Server pieces a feature depends on

| Name | Code |
|---|---|
| Lesson and step API | `apps/api/src/lessons/`, `apps/api/src/parts/` |
| Attempts and mastery (BKT) | `apps/api/src/attempts/`, `apps/api/src/progress/` |
| Practice grading and sandbox | `apps/api/src/grading/`, `apps/api/src/sandbox/`, `services/sandbox` |
| Lesson generation | `apps/api/src/ai/`, `services/engine` |
| Seeded sample worlds | `worlds/`, `apps/api/src/db/seed.ts` (`SAMPLE_WORLDS` lists the sample courses; `worlds/scrim-demo` seeds one scrim, and its narration is silent placeholder audio) |

## Driving the app

`pnpm dev` starts the API and web. The e2e suite in `e2e/` runs against a fake LLM (`e2e/fake-llm`) and needs no provider keys. Use the screen names above when you describe what you did or saw.
