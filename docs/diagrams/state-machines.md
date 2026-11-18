# State machines

Diagrams derived from the code. When a machine changes, change its diagram in the same PR.

## Lesson step machine (client)

Mirrors `apps/web/src/player/stepMachine.ts`, the XState machine behind one step of the player. `LOADED` carries the server's saved state, so a reload lands where the learner left off. The answer arrives only through `REVEAL_LOADED`, and that event is accepted only in `revealed` and `skipped`.

```mermaid
stateDiagram-v2
    [*] --> browse
    browse --> predicting: LOADED, step.state is predicting or unknown
    browse --> hinting: LOADED, step.state is hinting
    browse --> revealed: LOADED, step.state is revealed
    browse --> skipped: LOADED, step.state is skipped

    predicting --> revealed: RESULT, r.state is revealed
    predicting --> hinting: RESULT, any other state
    predicting --> hinting: HINT
    predicting --> skipped: SKIPPED
    predicting --> browse: CONFLICT, sets notice

    hinting --> revealed: RESULT, r.state is revealed
    hinting --> hinting: RESULT, any other state
    hinting --> hinting: HINT
    hinting --> skipped: SKIPPED
    hinting --> browse: CONFLICT, sets notice

    revealed --> revealed: REVEAL_LOADED, stores reveal
    revealed --> browse: NEXT, hasNext, idx plus 1
    revealed --> finished: NEXT, no next step

    skipped --> skipped: REVEAL_LOADED, stores reveal
    skipped --> browse: NEXT, hasNext, idx plus 1
    skipped --> finished: NEXT, no next step

    finished --> [*]

    note right of predicting
        canSubmit: always
        canHint: hints below hintCount
        canSkip: always
    end note
    note right of hinting
        canSubmit: only while attemptAllowed
        canHint: hints below hintCount
        canSkip: always
    end note
```

## Practice run (client)

Mirrors `apps/web/src/player/live/usePracticeRunner.ts`, with the result shapes from `apps/web/src/player/live/checkModel.ts`. Run and Check are independent flags in the hook, so the diagram has two regions. The derived flag `busy` is true in `Starting`, `OneShotRunning` and `ShellRunning`. `Idle` and `Checked` are the resting states. Editing the code drops lint findings but keeps the last Check result.

```mermaid
stateDiagram-v2
    state PracticeRunner {
        [*] --> Idle
        Idle --> ShellRunning: run, sandbox on, shell wait ok
        Idle --> Starting: run, sandbox off or shell unreachable
        ShellRunning --> Idle: runInShell finished
        ShellRunning --> Idle: runInShell failed, runNote set
        ShellRunning --> Starting: runInShell failed, fall back to one shot
        Starting --> OneShotRunning: startPython ok, sid set
        Starting --> Idle: startPython failed, error shown in output
        OneShotRunning --> OneShotRunning: poll, not done
        OneShotRunning --> Idle: poll done, sid cleared
        OneShotRunning --> Idle: stop, output gets stopped marker
        OneShotRunning --> Idle: 4 poll failures in a row, run stopped
        --
        [*] --> NotChecked
        NotChecked --> Checking: check
        Checking --> Checked: CheckResponse stored as result
        Checking --> CheckFailed: error, result cleared, checkError set
        Checked --> Checking: check
        CheckFailed --> Checking: check
    }
```

## Attempt, hint and reveal (server)

Mirrors `next` in `apps/api/src/attempts/machine.ts`, driven by `stepsRouter` in `apps/api/src/attempts/router.ts` (`attempt`, `hint`, `skip`, `reveal`). The stored state is one of `predicting`, `hinting`, `revealed` and `skipped`. The three `hinting` sub-states split on the stored flags: `attemptAllowed` and `retryAllowed`. Any action in `revealed` or `skipped` is a CONFLICT, and so is an attempt while `attemptAllowed` is false or a hint when none are left. `reveal` returns the answer key only in `revealed` or `skipped`, otherwise CONFLICT "Not revealed yet".

```mermaid
stateDiagram-v2
    [*] --> predicting: fresh progress

    predicting --> revealed: attempt, correct
    predicting --> HintingLocked: attempt, wrong, hintCount above 0
    predicting --> HintingRetry: attempt, wrong, hintCount is 0
    predicting --> HintingOpen: hint, rung 1
    predicting --> skipped: skip

    state hinting {
        HintingLocked
        HintingOpen
        HintingRetry
    }

    HintingLocked --> HintingOpen: hint, next rung
    HintingLocked --> HintingLocked: attempt, CONFLICT take the next hint first
    HintingLocked --> skipped: skip

    HintingOpen --> HintingOpen: hint, next rung
    HintingOpen --> revealed: attempt, correct
    HintingOpen --> HintingLocked: attempt, wrong, hints left
    HintingOpen --> HintingRetry: attempt, wrong, no hints left
    HintingOpen --> skipped: skip

    HintingRetry --> revealed: attempt, correct or wrong
    HintingRetry --> skipped: skip

    revealed --> revealed: any action, CONFLICT step already finished
    skipped --> skipped: any action, CONFLICT step already finished

    revealed --> [*]: reveal query returns the answer key
    skipped --> [*]: reveal query returns the answer key
```

Side effects per transition, from `mutate` in the same router:

- A `hint` inserts a `hint_events` row and returns that rung's text.
- An `attempt` or `skip` inserts an `attempts` row. Only the first one for the learner and step is `observed`, and only an observed one triggers `applyObservations` (mastery). Later attempts never move mastery.
