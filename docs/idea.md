# LearnSlop: learn to code from real code changes

Status: pivoted on 2026-11-06 from a children's tutoring idea to a programming learning tool. The earlier YC "Primer" framing is dropped. The research below is kept because the design decisions depend on it.

## The problem

Most programming tutorials are passive. A learner watches someone write code, or reads a diff, and feels they understood it. Then they cannot write the same thing themselves. Two learners who get the same explanation often understand it differently, and one explanation rarely fits both.

## The product

LearnSlop turns a real code change into an adaptive lesson. The learner predicts what a change does before the answer is shown. The lesson then mixes modalities, chosen per concept and per learner:

- **Code replay:** an ordered commit or PR is replayed step by step in an editor. The learner can pause and edit at any point.
- **Diagrams:** a picture of how the code runs (call flow, state, data shape).
- **Quizzes:** predict-the-output, multiple choice and fill-in-the-blank questions.
- **Games:** short practice games that drill a concept (for example, tracing a loop or ordering the steps of a function call).
- **Practice:** run the code in the browser and check it against expected output.

A learner model tracks which concepts each learner misses and changes the next step: hint depth, explanation style and the next lesson.

**Audience.** Learners of programming, 13 and over. Beginners and early-career developers, starting with JavaScript and TypeScript.

**Why it might work.** It turns reading a diff into attempting a change. The aim is to make learning feel like exploring code rather than reading someone else's.

## What changed on 2026-11-06

- The target is programming learners, not young children. Child profiles, age bands, parental consent and the KidsQuest world are out of scope.
- The YC "Primer" request (Fall 2026) is about ages 4 to 10 and says nothing about code. It is not a fit and is no longer used as a pitch.
- The learner model and the adaptive next step survive the pivot. So do the prediction-first rule and the hint ladder.
- Diagrams, quizzes and games were already partly built as catalog blocks (`packages/ui-catalog`: diagram, quiz, order, match, sort, physics, grid). Wiring them into lesson steps is the next step.

## The pitch, with claim checks

The original pitch was a playable "code cast" from any GitHub repo, with a forkable sandbox and an AI tutor that explains why the author wrote the code. The claims below are corrected.

- **Any repo becomes a replay automatically.** Partly true. Git stores snapshots of files, not keystrokes or diffs ([Stolee, 2020](https://github.blog/open-source/git/commits-are-snapshots-not-diffs/)). A replay from history is reconstructed, so label it *reconstructed*, not *recorded*. The MVP uses curated, permissively licensed JavaScript and TypeScript commits.
- **Record DOM and editor events.** Feasible. Scrimba says it records events instead of pixels, and rrweb is an open-source DOM recorder. Importing from git has no such events, so this does not apply to imported lessons.
- **Scrub in O(1) with snapshots plus deltas.** Overclaim. Replay cost depends on the distance to the nearest snapshot, so it is bounded, not constant. This is my reading of the technique, not a sourced claim.
- **XState and Zustand as one state machine.** Muddled. XState models the player modes (playing, paused, predicting, revealed). Zustand is a store. Pick XState alone, or use both for different jobs.
- **Fork into a sandbox that runs the code.** Supported, with limits. WebContainers run Node.js in the browser: full on Chromium, beta on Firefox and Safari ([StackBlitz, n.d.b](https://webcontainers.io/guides/browser-support)). Pyodide runs Python but has no threading or multiprocessing, and its ssl module is a stub ([Pyodide, n.d.](https://pyodide.org/en/stable/usage/wasm-constraints.html)). Python is the second track, not the first.
- **AI explains why the author wrote it that way.** Inference. Git keeps the commit message and PR text, not the author's reasoning. Show these explanations as inferred, and cite the PR discussion when it exists.
- **TTS voiceover and AST hover.** Both look feasible with standard tools. Neither is quantified (cost, voice quality, per-language parser work), so both stay out of the MVP.

## Competition

- **Scrimba** (YC S20) is the closest. It is an editable video format for coding lessons. In April 2025 its CTO said it had integrated StackBlitz WebContainers, giving a full Node.js environment in the player ([Scrimba CTO, 2025](https://news.ycombinator.com/item?id=43771365)). Lessons are hand-recorded and authored manually.
- **DeepWiki and Google Code Wiki** give AI documentation and chat for any repo ([Cognition, 2025](https://cognition.com/blog/deepwiki); [Google, 2025](https://developers.googleblog.com/en/introducing-code-wiki-accelerating-your-code-understanding/)). Text and diagrams, not playable replays.
- **Pocket Flow tutorial generator** turns a GitHub repo into a written beginner tutorial ([The-Pocket, n.d.](https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge)).
- **CodeTour** records static guided tours of a codebase in VS Code ([Microsoft, n.d.](https://github.com/microsoft/codetour/)). No replay.

The gap, as far as I found: none of these generates an editable, replayable lesson from commit history with learner questions. That is a gap in my search, not proof nobody has built it.

## Does it help people learn?

None of these studies tests this product. They set the design rules.

- **Kestin et al. (2025):** a carefully designed AI tutor beat in-class active learning with physics students at Harvard. Median post-test 4.5 (N = 142) against 3.5 (N = 174), in about the same time on task (median 49 minutes).
- **Bastani et al. (2025):** with nearly 1,000 Turkish high school students, a plain chatbot lifted practice scores 48% but lowered exam scores 17%. A guarded tutor removed most of that harm.
- **Anthropic (2026):** 52 software engineers learning a Python library. The AI-assisted group scored 50% on the quiz against 67% for the hand-coding group. Those who asked for explanations kept more.

**Design rules from the evidence:**
- The learner attempts before the answer is shown.
- Hints come in steps, and the answer is the last rung.
- Use AI to guard the learning, not to hand over answers.

## MVP scope

- **Language:** JavaScript and TypeScript first. Python is the second track (stretch).
- **Input:** one commit from a permissively licensed public repo, plus seeded synthetic lessons.
- **Player:** Monaco editor; steps replayed from the commit; a snapshot for each step.
- **Learning parts:** a prediction question and a three-rung hint ladder per step, plus at least one diagram or quiz per lesson.
- **Sandbox:** WebContainers fork, later, once replay works.
- **Cut for now:** TTS, AST hover, Python, any-repo claims, child audiences.

## Limits

- **Running other people's code.** Repos can run install scripts and make network calls. Use a curated list, not arbitrary URLs.
- **Licensing.** WebContainers need a commercial licence for production, for-profit use. Prototypes do not ([StackBlitz, n.d.a](https://webcontainers.io/enterprise)). Repo licences also govern showing and redistributing code, which I have not researched in depth.
- **Browser support.** WebContainers need SharedArrayBuffer and cross-origin isolation. Chromium is fully supported; other browsers are beta.
- **Privacy.** Private repos would send code to an AI provider. Stay with public repos until there is a clear policy.
- **Cost.** Model calls per step add up. Not priced yet. Measure tokens per lesson.
- **Small data.** With a few lessons, the learner model barely moves. Say so in any report.

## Next step

1. Replay one real commit in Monaco with no AI, to check the player.
2. Add one prediction question and one diagram or quiz per step.
3. Test with classmates: a lesson versus reading the same diff, then a short quiz (the design in Anthropic, 2026).
4. Go on only if the lesson group scores better or finds it clearly easier. Otherwise the player is a toy.

## Patterns worth writing up

Event sourcing with the command pattern for the timeline, snapshot plus delta replay, a state machine for player modes, and a boundary around code execution. These are standard patterns I am applying by judgement. I did not source each one.

## References

All accessed 27 October 2026, unless noted.

- Stolee, D. (2020) Commits are snapshots, not diffs. The GitHub Blog. https://github.blog/open-source/git/commits-are-snapshots-not-diffs/
- Scrimba CTO (2025) Show HN: Node.js video tutorials where you can edit and run the code, Hacker News. https://news.ycombinator.com/item?id=43771365
- Borgen, P. (2020) Launch HN: Scrimba (YC S20), Hacker News. https://news.ycombinator.com/item?id=24579699
- Stack Overflow (2019) Scrimba.com interactive DOM recording algorithm (answer from Scrimba). https://stackoverflow.com/questions/55345973/scrimba-com-interactive-dom-recording-algorithm
- Scrimba Guide (2026) How Scrimba scrims work (third-party review, September 2026). https://scrimbaguide.tech/docs/how-it-works/how-scrims-work/
- StackBlitz (n.d.a) WebContainers: commercial usage. https://webcontainers.io/enterprise
- StackBlitz (n.d.b) WebContainers browser support (updated October 2026). https://webcontainers.io/guides/browser-support
- Pyodide (n.d.) Pyodide Python compatibility. https://pyodide.org/en/stable/usage/wasm-constraints.html
- rrweb (n.d.) Record and replay the web. https://rrweb.com/
- Microsoft (n.d.) CodeTour: VS Code extension to record and play back guided tours of codebases. https://github.com/microsoft/codetour/
- Cognition (2025) DeepWiki: AI docs for any repo. https://cognition.com/blog/deepwiki
- Google Developers Blog (2025) Introducing Code Wiki. https://developers.googleblog.com/en/introducing-code-wiki-accelerating-your-code-understanding/
- The-Pocket (n.d.) PocketFlow Tutorial Codebase Knowledge (MIT licence). https://github.com/The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge
- Kestin, G. et al. (2025) AI tutoring outperforms in-class active learning, Scientific Reports. https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/
- Bastani, H. et al. (2025) Generative AI without guardrails can harm learning, PNAS. https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/
- Anthropic (2026) How AI assistance impacts the formation of coding skills. https://www.anthropic.com/research/AI-assistance-coding-skills

Pricing and product features can change.
