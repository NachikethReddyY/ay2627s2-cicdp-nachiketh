# Generate scrim lessons from the home-page prompt

PR 5 of the scrim plan. Depends on #83 (the `scrim` kind and its API storage). The player (PR 3) and the lab editor (PR 4) are separate work; this PR is the engine and API half and does not need them.

## Why

"SQL joins for beginners" already becomes a 3-course path in about 22 seconds, but every generated lesson is text, diagrams or a game. Nothing generated has a timed code replay or a lab. The engine should draft scrim lessons so a generated course mixes scrims and labs.

## Goals

- The outline can assign the `scrim` kind to a lesson in a code course.
- The engine drafts a scrim part: timed segments, code edits, gates, and a lab.
- The API validates, moderates, caches and stores it with the existing `scrim` kind, and writes the gate steps as ordinary mcq steps.
- Hints and answers stay server-side. `lessons.get` is unchanged, so gate answers, hints and hidden lab tests are never sent to the client.

## Non-goals

- Playing scrims (PR 3) and the lab editor (PR 4).
- Narration audio. `lesson_media` stays empty for generated scrims; the player must fall back to showing `text`. Narration generation is a later PR. Segment durations are derived, not recorded.
- A review queue. Generated parts follow the same path as learn, watch and practice parts today: private AI paths publish on first open after moderation, public worlds go through `isSafe`. A human approval step for public content is a separate product decision.
- Learner-model changes. `policy.py` kind tuples are untouched, so the adaptive policy treats `scrim` like an unknown kind (falls back to the next unfinished lesson).

## Approaches

1. **Scrim as one engine part, gate steps inside it (chosen).** `POST /v1/pipeline/lesson` with `kind: scrim` returns `{kind, language, segments, lab, steps}`. `steps` are mcq steps reusing the existing `McqStep` model, so the answer-leak check and the "bad eliminate" check apply unchanged. The API splits the envelope on write: `lesson_versions.content` gets the scrim without `steps`, and `steps` rows get the gate steps. The cache stores the whole envelope.
2. **Two engine calls: scrim, then gate steps.** Simpler prompts, but a second call per lesson, two repair loops and a way for the two to disagree about which segment a step belongs to. Rejected on cost and consistency.
3. **Store gate steps in `lesson_versions.content`.** Avoids the split, but `lessons.get` and attempts read gates from `steps` rows (#83), so content would carry a second copy. Rejected.

## Design

Engine (`services/engine`):

- `schemas.py`: `ScrimDraft` (what the model writes) and `ScrimPart` (draft plus `durationMs` per segment). Draft rules: 4 to 8 segments, segment 0 has an edit, 1 to 3 gate steps, every step gated by exactly one segment, a gate segment is never the last one, the lab language equals the scrim language, the lab passes `PracticePart` (including the stretch-test count from context).
- Predict before reveal: narration up to and including a gate segment must not contain the correct option, and the code shown at the gate must not already contain the step's added lines. These are code checks, not prompt text.
- `durationMs` is computed from the word count by `segment_duration_ms`, clamped to the API bounds. The model never writes durations, because it cannot time speech.
- `prompts/scrim.md`: the new prompt. `outline.md` and the outline model gain `scrim` (code subjects only).
- `pipeline.lesson` gets a scrim branch, then converts the draft to `ScrimPart`.

API (`apps/api`):

- `ai/step-schema.ts`: the step zod models move out of `service.ts` so the scrim gate steps share them.
- `parts/scrim-schema.ts`: `GeneratedScrim` is `ScrimContent` plus `steps`, with the same gate cross-checks as the lesson-file loader.
- `visuals/gate.ts`: `validatePart` accepts the generated scrim.
- `ai/service.ts`: `writeOnce` strips `steps` from content and inserts them as step rows; the lab gets stretch tests like a practice part.

## Checks

Property tests: `segment_duration_ms` stays inside the API bounds and never shrinks as the text grows; a draft with any gate that points outside `steps`, or any step left ungated, is rejected. Example tests cover the leak checks, the pipeline with a recorded reply, and an API round trip that proves gate answers never reach `lessons.get`.

## Left to later

Narration generation, the review queue for public content, adding `scrim` to the policy kind tuples (a learner-model change, needs the owner), and the PR 3 and PR 4 web work.
