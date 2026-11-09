# Privacy note

| | |
|---|---|
| **Date** | 2026-11-09 |
| **Status** | Draft for the project record, WP15. Not a published privacy policy. No user-facing notice exists yet. |
| **Audience** | Learners aged 13 and over (AGENTS.md, plan §4 NFR1). Not intended for children under 13; the age limit is not enforced yet. |
| **Companion** | `docs/sdlc/threat-model.md` (security findings, including F10, F11 and F22) |

## What we collect, and who gets it

LearnSlop asks for an email address and a password to create an account. The name shown in the app is copied from the part of the email before the "@", so it can contain a real name (`apps/web/src/pages/Login.tsx:21`). As you learn, the app stores your answers, the hints you open, the steps and parts you finish, and a mastery estimate for each concept. Each sign-in session stores your IP address and browser type, and the server logs record request details and errors. When you use the AI features, the text involved (lesson topics, the code you are editing, chat messages, and the names of concepts you missed) is sent to third-party providers: OpenAI for content moderation, the language model provider the engine is configured to use, an image provider for generated pictures, and Daytona when code runs in a sandbox. The app is hosted on Vercel, Render and Neon Postgres, and media files are stored in an S3-compatible bucket. Fonts are loaded from Google, which receives the IP address and browser details of each visitor. The product is not intended for children under 13, and we do not knowingly collect their data. Nothing enforces the age limit yet. The sign-up form has no age, date of birth or parent-consent field, and no analytics SDK appears in `package.json` or the source.

## Data inventory

"Kept until" describes what happens today. No deletion, export or retention job exists yet.

| Data | Where stored | Why | Who receives it | Kept until (today) |
|---|---|---|---|---|
| Email address | `user.email` (Neon Postgres) | Sign-in and account identity | Neon, Render (API) | Indefinitely. No deletion route. |
| Name (copied from email before "@") | `user.name` | Shown in the app (where it is shown is not yet checked) | Neon, Render | Indefinitely |
| Password hash | `account.password` | Sign-in | Neon | Indefinitely. Hash algorithm not yet verified (threat model F12). |
| Session: token, IP address, user agent | `session` (`ip_address`, `user_agent`; `apps/api/src/db/schema.ts:42-43`) | Keeps you signed in | Neon; IP also in Render request logs | Session expiry not yet verified. Rows are not purged. |
| Email verification tokens | `verification` | Reserved for email verification | Neon | Indefinitely. No email verification flow in code yet. |
| Learner profile: tier, IANA timezone, daily goal, admin flag | `learners` | Learning settings and access control | Neon | Indefinitely |
| Learner answers: typed response, correctness, missed concepts | `attempts.response` and related columns | Grading, feedback, mastery | Neon. Missed concept names go to the LLM provider for recommendation reasons. | Indefinitely |
| Behaviour: hints opened, steps and parts completed, game results, practice check results | `hint_events`, `step_progress`, `part_completions`, `game_completions`, `check_results` | Progress and mastery | Neon | Indefinitely |
| Mastery per concept; recommendation reason text | `mastery`, `recommendations.reason` | Next-lesson recommendation with a reason | Neon | Indefinitely |
| AI usage per user: generation records, image records | `ai_generations` (`user_id`), `image_generations` (`learner_id`) | Cost control and usage records | Neon | Indefinitely. `spend_ledger` has no user link and holds no personal data. |
| Lesson topic text (up to 300 characters) | `lessons` (generation input) and the moderation call | Generating a lesson | OpenAI moderation; LLM provider | Whether the topic is kept in the lesson record is not yet checked. Provider retention not yet verified. |
| Editor code, selection and chat messages (guide chat) | Not stored in the tables in this inventory (not yet verified) | Guide answers | LLM provider (via engine) | Provider retention not yet verified. Whether the API keeps a copy is an open item. |
| Code run in a sandbox (learner files and output) | Docker containers (one-off run and check containers, and shell containers); Daytona sandboxes when used | Running practice checks and the shell | Daytona (when used). Sandbox label is a SHA-256 of the learner ID. | Docker: one-off run and check containers are removed after the run. Shell containers are started detached without `--rm` and live until idle. Daytona practice-run sandboxes are deleted when they stop. Daytona shell files persist on the sandbox until deleted; the app does not delete them, so retention is indefinite today. |
| Image prompts for generated pictures | Image provider | Picture generation | Image provider (`IMAGE_BASE_URL`) | Provider retention not yet verified |
| API request logs: IP address, URL, errors with stack traces on 5xx. The API's own logs redact the shell ticket. | Render log stream | Operations and debugging | Render | Render retention not yet verified. Render edge logs are not covered here: the shell WebSocket goes from the browser straight to Render, so the ticket in the URL query may appear in platform logs. |
| Engine logs: model, tokens, latency, error type | Render log stream | Operations | Render | Render retention not yet verified |
| Narration audio and media | S3-compatible bucket (R2 per the CSP) | Playing lesson audio | Storage provider. Signed URLs expire after 2 hours (`apps/api/src/media/storage.ts:12`). | Retention not yet verified. Bucket policy not yet verified. |
| Session cookie | Your browser, and sent to the API on every request | Keeps you signed in | Neon (`session` table); Render (API) | Until sign-out or expiry. Expiry not yet verified; rows are not purged. |
| Browser storage: localStorage keys `lq.player.volume`, `lq.terminal`, `lq.workbench`, `lq.theme`, `lq.editor.wordWrap`; sessionStorage key `lq.chunk-reload` | Your browser only | Display preferences | Nobody (stays on the device) | Until cleared in the browser |
| IP address and browser details of each visitor | Google's servers, when a font loads | Loading fonts | Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`; `apps/web/vercel.json` CSP) | Set by Google |

Hosting and infrastructure: Vercel (static site), Render (API and engine), Neon (Postgres), S3-compatible bucket (media). Their own retention policies are not yet verified.

## Known gaps

These are not built or not checked. None is a promise.

- **No account deletion or data export.** Not yet built (threat model F10). Deleting a learner would also fail while attempts, hint events or step progress rows exist, because those foreign keys use `ON DELETE NO ACTION` (`apps/api/drizzle/0000_workable_forge.sql:133`, `:136`, `:142`; threat model F11).
- **No retention job.** Attempts, hints, mastery, AI usage records, sessions and verification rows are kept indefinitely. Session lifetime is not yet verified (threat model F12).
- **Age gate not enforced.** The audience is 13 and over, but sign-up has no age input and no check (threat model F22). Enforcing it needs a product decision.
- **Name taken from email.** The display name is the email's local part (`apps/web/src/pages/Login.tsx:21`), which can hold a real name. Where the name is displayed to other people is not yet checked (threat model F23).
- **Google Fonts sends visitor IP and browser details.** The CSP allows fonts from Google (`apps/web/vercel.json`). Consider self-hosting the font files so visitors' requests stay with us.
- **Provider retention and training terms unverified.** OpenAI, the LLM provider (`LLM_API_BASE` is set outside the repo), the image provider, Daytona, Vercel, Render, Neon and the bucket host each need their current data policy checked and dated (threat model O4).
- **Log retention unverified.** Render, Vercel and Neon log and backup retention is not known.
- **Guide chat storage unverified.** Whether the API keeps a copy of editor code or chat messages is not yet confirmed.
- **No user-facing privacy notice.** Plan §15.6 calls for one paragraph; this document is the source for it. Before launch, a learner-facing version should be reviewed by the user.
