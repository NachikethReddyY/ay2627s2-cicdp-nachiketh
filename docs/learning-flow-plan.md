# LQ-37: Learning flow frontend plan

Link the AI service to the frontend so a learner can type a prompt and get a
plan made of **Learn → Watch → Practice** parts.

> ## ⚠️ Token rule: generate on click, never ahead
>
> The prompt makes **one** cheap AI call: the plan (titles and one-line briefs only).
> A part's content (text, video replay, practice task) is written **only when the
> learner opens it or clicks Next**. Nothing is written in the background.
> Once written, a part is saved and reopening it is free.
>
> Today `prefetchNext` in `apps/api/src/ai/service.ts` writes the *next* lesson in the
> background as soon as one opens. That breaks this rule and must be removed.

## The flow

1. **Prompt.** The learner types "teach me JavaScript" in the box on Home
   (already there: `trpc.paths.generate`).
2. **Plan.** One AI call returns the outline. The page shows the parts in order,
   for example:
   1. Learn: Variables and `let`/`const`
   2. Watch: Building a counter, step by step
   3. Practice: Write `sum(a, b)` and run it

   No part has content yet. Each shows "Not written yet". Only the first is unlocked.
3. **Open / Next.** Clicking a part (or Next at the end of one) calls
   `lessons.get`, which writes that part if it has no content yet. The learner sees
   "Pip is writing your next lesson…" (already in `LiveLesson.tsx`).

## Part kinds (v1)

| Kind | What the learner sees | Reuses |
|------|-----------------------|--------|
| **Learn** | Short explanation with code snippets, then Next. | `Page`, `PipEmpty` from `components/Bits.tsx` |
| **Watch** | The code replay "video": the editor types out the change, with play/pause/seek. | `Player` in video mode (`player/PlayerPage.tsx`), `buildTimeline` from `player-core` |
| **Practice** | Instructions on the left, Monaco editor on the right, a **Run** button and an output panel. Optional **Check** runs the practice tests. | `EditorPane.tsx`, `Window.tsx` |

**Run** executes JavaScript in a Web Worker in the browser: no server, no tokens.
It captures `console.log` into the output panel and stops the worker after 3 s so
an infinite loop can't freeze the tab. JS only for v1.

**Check** runs all of a practice part's `tests` in one sandbox container via
`POST /api/sandbox/check`. Each test has `id`, `name`, `stdin`, `expectedStdout`,
`visibility` (`sample` or `hidden`) and `stretch`. The sample test's input and
expected output are visible; hidden tests show only pass or fail. Stretch tests
give bonus points only. `expectedOutput` is kept as a legacy single test. No AI
grading.

## Frontend changes

1. **Plan page.** Reuse `pages/Course.tsx` (it already lists lessons with locked /
   current / done states). Add the kind icon per row (Learn / Watch / Practice) and a
   "Not written yet" label for parts with no content. Add the token-rule note at the
   top: "Each part is written when you open it, so no AI is wasted."
2. **Home prompt box.** No change. It already calls `paths.generate` and
   navigates to the first course.
3. **`LiveLesson.tsx`.** Switch on the part's `kind`:
   - `learn` → new `LearnView` (text + code blocks + Next).
   - `watch` → existing `Player` with the part's timeline, video mode.
   - `practice` → new `PracticeView` (instructions + editor + Run + output + Check).
   - `mcq` / `cloze` steps keep the existing predict flow.
4. **Next button.** At the end of every part, a Next button links to the next
   part's `/play?lesson=`. That navigation is what triggers generation.
5. **`runJs.ts`** (new, ~30 lines): Web Worker runner with timeout. Ships with a
   small test (prints, throws, infinite loop is killed).

## Backend changes this depends on

These are small and can be a sub-task or done in the same PR:

- `lessons.kind` column: `learn | watch | practice` (migration, expand-only).
- Outline schema in `service.ts` and the engine: each lesson gets a `kind`.
  For v1 the outline always emits Learn → Watch → Practice per topic.
- Engine lesson prompt branches on `kind`:
  - learn → `{ body }`
  - watch → existing `{ beforeFiles, hunks }`
  - practice → `{ instructions, starterCode, tests }` (each test has `id`, `name`, `stdin`, `expectedStdout`, `visibility`, `stretch`; `expectedOutput` is kept as a legacy single test)
- `lessons.get` returns `kind` plus the public content for that kind.
- **Remove `prefetchNext`** and its call in `lessons/router.ts` (token rule).

## Out of scope for v1

Languages other than JS, npm packages / WebContainers, AI grading of practice code,
narration audio, editing the plan.

## Done when

- Typing "teach me JavaScript" shows a plan of Learn → Watch → Practice parts with
  no content generated (check `ai_generations` / engine logs: one outline call).
- Opening each part makes exactly one lesson call; reopening makes none.
- Practice: Run shows `console.log` output; an infinite loop stops after 3 s.
- Keyboard and screen-reader access match the existing player.
