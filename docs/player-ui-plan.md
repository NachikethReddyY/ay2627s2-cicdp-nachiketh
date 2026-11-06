# Lesson player UI plan (WP4-M1/M2, WP17 card)

> Source of truth: `docs/plan.md` §5, §6.2, §8.3, §9, §11.2, §15.1, §15.4, §15.11, FR4, FR5.
> Scope: the smallest UI that proves predict → hint → reveal → replay. Anything marked **[Q#]** needs an owner decision (§5 below); the plan uses the stated default until then.

---

## 1. Screens and states

One route for browse (`/lessons`) and one for the player (`/lessons/:id`). Every player state uses the same layout:

```
Desktop (≥ 1024px)                          Phone (< 768px)
┌──────────────────────────┬─────────────┐  ┌──────────────────┐
│ Editor (Monaco)          │ Step panel  │  │ Step panel       │  (collapsible)
│                          │             │  ├──────────────────┤
│                          │             │  │ Editor           │
├──────────────────────────┴─────────────┤  ├──────────────────┤
│ Transport: ▶ speed  [timeline + steps] │  │ Transport        │
│ Captions                               │  │ Captions         │
└────────────────────────────────────────┘  └──────────────────┘
```

Always visible: the "Reconstructed replay" badge (§12), lesson title, step `n / N`.

| State | Learner sees | Learner can |
|---|---|---|
| **browse** | Published lessons for CodeQuest: title, concept chips, step count, and "Resume step n" if started. Loading, empty and error states. | Open a lesson. |
| **loading** | Skeleton layout. Monaco loads lazily (it is big). | Nothing (error state has Retry). |
| **predicting** | Editor shows `beforeFiles` for this step (read-only until paused/edited, see sandbox). Step panel: title, prompt as **MCQ** (4 radio options) or **cloze** (the line with one text input in place of `____`). Buttons: Submit, Get hint (rung 1), Skip. If `skipOffered`, a gentle "Want to skip this one?" line (display only). | Answer, ask for hint 1, skip, edit code in the sandbox, rewatch earlier revealed steps on the timeline. |
| **hinting** | Same as predicting, plus the hint ladder: rungs taken so far, newest first. MCQ rung 1 crosses out the option in `eliminate`. Feedback for the last wrong answer (never above the current rung). Submit is **disabled** while `attempt_allowed=false`, with the text "Take the next hint to try again" (server returns 409 otherwise). After the last rung, a "One last try" label. | Take next rung, answer (when allowed), skip, edit in sandbox. |
| **revealed** | Correct/incorrect result. The answer marked in the prompt (correct MCQ option, or the filled cloze), from the reveal `answer`. The step's replay plays in the editor: typed-style changes for this hunk, file switches as tabs. Narration plays; captions show. Explanation in the server's chosen style (`worked_example` or `practice`), labelled **inferred**. Source link (repo, SHA, path). "Next step" button. | Play/pause/seek/speed, mute narration, toggle captions, pause and edit, Next step. No more attempts (UI hides Submit; server would 409). |
| **skipped** | Same as revealed, with "Skipped" instead of a result. | Same as revealed. |
| **finished** | "Lesson complete". Per-step summary (correct / with hints / revealed / skipped). Mastery list (concept, bar, %). Next-lesson card with its `reason`. Mastery updates async, so show "Updating your progress…" until fresh **[Q8]**. | Open the recommended lesson, back to browse, rewatch any step. |
| **error** | Inline message per failed call; attempts are never lost (NFR5), so a failed POST shows Retry with the answer kept. | Retry. |

**Sandbox edit (all states except while playing).** Pausing makes the editor editable. A sticky banner over the editor: "Sandbox: your edits are not saved and do not change the lesson" with **Reset**. Edits are a local Monaco overlay (§15.4). Pressing Play, seeking, or moving to the next step discards them, with a confirm dialog ("Discard your edits?") if the overlay is dirty. The editor's border changes colour while the overlay is dirty (plus the text banner, so colour isn't the only signal).

**Timeline.** One segment per step. Equal-width segments; inside a revealed segment, position is proportional to event count **[Q5]**. Steps not yet revealed are locked segments (hatched, with a lock icon, and `aria-disabled`): the client has no hunks for them, so it can't seek there. The current step's segment unlocks on reveal/skip. Speeds: 0.5×, 1×, 2×, 4×, Instant (§15.4). With `prefers-reduced-motion`, default to Instant **[Q6]**.

---

## 2. Components and state ownership

All under `apps/web/src/player/` (WP4) except the finished-screen card and list (`apps/web/src/quest/`, WP17).

| Component | Props | Own (React) state |
|---|---|---|
| `LessonListPage` | none (TanStack Query `GET /lessons?world=codequest`) | none |
| `PlayerPage` | `lessonId` (route) | holds the XState actor (`useMachine(playerMachine)`) and the `useReplay` hook |
| `EditorPane` | `files`, `activePath`, `readOnly`, `onDirtyChange` | the Monaco model (the overlay lives in the model; React only tracks `dirty: boolean`) |
| `TransportBar` | `playing`, `speed`, `t`, `segments[{stepIdx, start, end, locked}]`, `onPlay/onPause/onSeek/onSpeed` | none. Timeline is a Radix `Slider` with step markers |
| `StepPanel` | `step` (public data from `GET /steps/:id`), `mode` (predicting/hinting/revealed/skipped), `hints[]`, `feedback`, `canSubmit`, `reveal` (null until revealed), callbacks | collapsed/expanded (phone) |
| `PredictionForm` | `prompt` (`mcq` or `cloze`), `crossedOut[]`, `disabled`, `onSubmit` | selected option / cloze text (kept on error) |
| `HintLadder` | `hints[{rung, text}]`, `hintCount`, `canTakeNext`, `onTakeHint` | none |
| `RevealPanel` | `result`, `explanation`, `style`, `source` | none |
| `Narration` | `src` (MP3 url or null), `text`, `autoplay` | audio element, `muted`, `captionsOn`, current sentence index |
| `SandboxBanner` | `dirty`, `onReset` | none |
| `LessonSummary` | `steps[]` with outcomes | none |
| `MasteryList`, `NextLessonCard` (WP17) | Query data from `/me/progress`, `/me/next` | none |

**XState (`playerMachine`) owns modes only.** Two parallel regions:

```
lesson:   loading → step.{predicting | hinting | revealed | skipped} → finished
          (any) → error → retry
playback: idle | playing | paused | editing
          playing ⇄ paused; paused → editing (first keystroke); editing → playing (PLAY, confirm if dirty)
```
- Step-mode transitions are driven by **server responses**, not guesses: every POST returns `state`, and the machine moves to it. On any 409, refetch `GET /steps/:id` and resync. This keeps the client from inventing a transition the server rejects.
- Context: `lessonId`, `stepIdx`, `stepIds[]`, `hintsTaken`, `attemptAllowed` (from the `/hints` and `/attempts` responses), `retryAllowed`.
- `playback` is enabled only when there's at least one revealed segment.

**Not in XState:**
- **Server data**: TanStack Query (`lesson`, `step`, `reveal`, `progress`, `next`). Mutations for attempt/hint/skip.
- **Replay clock and document**: `useReplay` hook wraps a `player-core` instance in a `useRef`, runs the rAF loop, and exposes `t` (throttled to ~10 Hz for the slider) and `files`. Per-frame events don't go through the machine.
- **Form input, captions index, dirty flag, panel collapse**: local React state.

---

## 3. API calls per state, and what the client must never receive

| State / action | Call | Uses |
|---|---|---|
| browse | `GET /lessons?world=codequest` | list. "Resume step n" needs per-step state from `GET /lessons/:id` |
| loading | `GET /lessons/:id` | `steps[{id, idx, title, conceptIds, hintCount}]` |
| loading (resume) | `GET /steps/:id` for the current step; `GET /steps/:id/reveal` for each earlier revealed/skipped step (to build their timeline segments) | current step = first `steps[]` item whose `state` is `predicting` or `hinting` |
| predicting | `GET /steps/:id` → `{prompt, state, explanationStyle, skipOffered, beforeFiles}` | editor content, prompt |
| answer | `POST /steps/:id/attempts` `{kind:"mcq", choice}` or `{kind:"cloze", text}` → `{correct, feedback, missedConcepts, hintsUsed, state}` | machine moves to `state` |
| hint | `POST /steps/:id/hints` → `{rung, text, eliminate?}` | append to ladder; `attemptAllowed = true` |
| skip | `POST /steps/:id/skip` → `{state:"skipped"}` | |
| revealed / skipped | `GET /steps/:id/reveal` → `{answer, hunks, explanations, source}` | `player-core` builds events from `beforeFiles` + `hunks`; plays |
| narration | static `/audio/<lesson>/<step>.mp3`; on 404 or error, `speechSynthesis` with the narration text | |
| next step | `GET /steps/:nextId` (now returns `beforeFiles`) | |
| finished | `GET /me/progress`, `GET /me/next?world=codequest` → `{lessonId, conceptId, reason}` | **[Q8]** freshness |

**The client must never receive before reveal/skip of that step:** `answer`, `accepted[]`, `answerIndex`, hint rungs not yet taken, `explanations`, `hunks`, `afterFiles`, `source` (repo/SHA/path), `beforeFiles` of a step whose previous step isn't revealed/skipped, and feedback that says more than the current rung. The client must also never **request** the step's MP3 before reveal (it is a static file, so this is only convention; plan.md §12).

**Tests for this (WP4 side, adds to WP5's server leak tests):** a Playwright check that records network responses during predicting/hinting and asserts none contain the step's answer string or any `hunks`/`explanations` key; and that no `/audio/` request fires before reveal.

---

## 4. Keyboard map and accessibility

**Shortcuts** work only when focus is inside the player region and **not** in the editor or a text input (so `Space` in Monaco or the cloze box types a space). This is the "active only on focus" route for WCAG 2.1.4. Shortcuts are listed in a `?` dialog.

| Key | Action |
|---|---|
| `Space` / `K` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s (within unlocked range) |
| `Shift+←` / `Shift+→` | Previous / next step boundary |
| `,` / `.` | Slower / faster |
| `H` | Take next hint |
| `1`–`4` | Choose MCQ option (then `Enter` to submit) |
| `S` | Skip (asks for confirmation, since it can't be undone) |
| `N` | Next step (revealed/skipped only) |
| `C` | Captions on/off |
| `M` | Mute narration |
| `E` | Focus the editor (edit in sandbox; pauses first) |
| `Esc` | Leave the editor and return focus to the transport bar |
| `?` | Shortcut help |

**Monaco and focus:** Monaco traps `Tab`. Keep its default `Ctrl+M` tab-focus toggle and add `Esc` to blur (custom command). Note both in the help dialog and in the editor's `aria-label`.

**Notes (WCAG 2.2 AA)**
- Timeline: Radix `Slider` (role slider, `aria-valuetext` like "Step 2 of 5, 0:14"). Click and keys work, so no drag is needed (2.5.7). Step markers are also buttons in a list.
- Status messages (4.1.3): one polite `aria-live` region for "Correct", "Not quite", "Hint 2 of 3 shown", "Step revealed". Don't announce replay progress.
- Focus management: after a wrong answer, focus stays on the form; after a hint, focus moves to the new hint; after reveal, focus moves to the result heading; after Next, focus moves to the new step's heading.
- Narration autoplays on reveal, so mute/pause must be reachable right away (1.4.2). The replay can be paused (2.2.2). No auto-advance to the next step (2.2.1).
- Captions: show the narration text in a caption region under the transport, current sentence highlighted. Timing for MP3 is estimated per sentence from `duration_ms`; for browser speech, use `boundary` events **[Q7]**. A full transcript is in a disclosure in the reveal panel (1.2.1).
- Correct/wrong/crossed-out never by colour alone: icon + text + strikethrough (1.4.1). Contrast 4.5:1 for text, 3:1 for the editor's sandbox border and focus rings (1.4.11, 2.4.7, 2.4.11 not obscured by the sticky banner).
- Targets ≥ 24×24 px (2.5.8); 44 px on phone for transport buttons.
- Reflow at 320 px (1.4.10): the stacked phone layout. Monaco gets horizontal scroll inside itself, which 1.4.10 allows for code.
- Reduced motion: no typing animation shake/confetti; default speed Instant **[Q6]**.
- Axe: run `@axe-core/playwright` in each state of the smoke test (browse, predicting, hinting, revealed, finished), on desktop and the 375 px viewport. Fail on any violation of `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` tags.

---

## 5. Open questions for the owner

| # | Question | Why it matters | Default until answered |
|---|---|---|---|
| Q1 | ~~Static MP3s vs. API-gated audio~~ | | **Decided:** static; client never requests before reveal (plan.md §9, §12) |
| Q2 | ~~Per-step state on load~~ | | **Decided:** `state` on each `steps[]` item in `GET /lessons/:id` (plan.md §7, §9) |
| Q3 | ~~Which option MCQ rung 1 crosses out~~ | | **Decided:** `eliminate?` on the hint response, picked by the API (plan.md §9) |
| Q4 | ~~Answer in reveal payload~~ | | **Decided:** `answer` on `GET /steps/:id/reveal` (plan.md §9) |
| Q5 | Timeline geometry: equal-width step segments, or proportional to replay length? Proportional needs every step's length before reveal. | Visual design call | Equal-width segments |
| Q6 | With reduced motion, play the replay as Instant by default? | Pedagogy vs. accessibility trade-off | Yes, Instant, and the learner can change speed |
| Q7 | One MP3 per step, but two explanation styles (`workedExample`, `practice`). Which one is narrated, and do captions show that text or the shown explanation? | The adaptive style and the narration can disagree | Narrate a separate per-step narration text; captions show that text; add `narration` text to the reveal payload |
| Q8 | Mastery is written by an async job. On the finished screen, poll `/me/progress` until updated, or show the last known values? | The last step's update may not have landed | Poll every 1 s for up to 5 s, then show last known with "may be a moment behind" |
| Q9 | §2 lists "mobile" as a non-goal; this brief requires phone-sized screens. Confirm this means responsive web, not native. Also: allow sandbox editing on phones (Monaco touch editing is weak)? | Scope and test matrix | Responsive web in core; phone editor is read-only, no sandbox editing on touch |
| Q10 | Can a learner go back to an earlier step? | UX | Yes, to rewatch only (seek); no re-attempt |
| Q11 | The finished screen's mastery list and recommendation card are WP17, **Wk 5** in §11.2, not Wk 2–3. Keep it there? | Brief says core = Wk 2–3 | Wk 3: summary of step outcomes only. Wk 5: mastery list + next card |

---

## 6. Core vs stretch

**Core, Wk 2 (WP4-M1, no API):** Monaco bundled via `loader.config({ monaco })`; `EditorPane`, `TransportBar` and `useReplay` replaying synthetic lesson 1 from a local fixture; seek with snapshots (K = 200 + step boundaries, from `player-core`); speeds; read-only diff page for the S2b control arm.

**Core, Wk 3 (WP4-M2, with WP5):** `playerMachine`; browse list; predicting, hinting, revealed, skipped; skip confirm; sandbox overlay + banner; narration MP3 with speech fallback; captions; keyboard map; focus management; reduced motion; phone layout; `e2e/smoke/` happy path (predict → miss → hint → reveal → next) with axe in each state; leak network check. Finished screen with step outcomes only.

**Core, Wk 5 (WP17):** mastery list and next-lesson card with reason on the finished screen.

**Stretch (cut line §11.3), not in this plan:** sandbox fork with real files (9); embed (5); live TTS (8); quest map, XP, badges, review (7); second language track (10); T3 `pending` grading state (12); free-chat tutor (not planned at all).

**Not planned, out of scope:** word-level caption timing for MP3s, themeable editor, shortcut remapping, offline mode.
