# LQ-45, LQ-46, LQ-47: finish the lesson media path

Follow-ups to LQ-36 (object storage, PR #12). Order: LQ-45 (code) and LQ-46 (ops) can run in parallel; LQ-47 needs both.

## Where things stand (checked 2026-11-05)

- **Images already use `saveMedia`.** LQ-19 (PR #13, merged after LQ-45 was filed) added `apps/api/src/media/imagegen.ts`. `generateImage` calls `saveMedia` (kind `image`, with `promptHash`). `prewarmDocImages` runs when an AI lesson is written (`ai/service.ts:285`), and `resolveDocImages` signs URLs on every `lessons.get` read (`lessons/router.ts:84`).
- **Image URLs reach the web app inline**, as `part.doc.blocks[].props.url`, not through the `media` array.
- **Nothing writes narration.** No TTS code, no upload path. `PlayerPage.tsx:91` says "no audio plays yet".
- **The `media` array on `lessons.get` is unused by the web app.** It currently returns images too (with `stepId: null`), duplicating the inline URLs. Images reused from another lesson version via the `promptHash` cache are missing from it, because `listMedia` filters by `lessonVersionId`.
- **The CSP blocks R2 audio.** `apps/web/vercel.json` has `img-src ... https:` (fine) but `media-src 'self' https://learnquest-api.onrender.com blob:`, so `<audio src="https://<acct>.r2.cloudflarestorage.com/...">` would be refused.
- No `render.yaml`: Render env vars are set in the dashboard.

## LQ-45: give narration a production write path

Scope note: LQ-24 owns narration content and playback ("hand-written lessons plus one MP3 per step, browser speech fallback"). LQ-45 should not build TTS. It should make it possible to store and serve a narration MP3, so LQ-24 only has to supply files and play them.

1. **Narration import command** (new `apps/api/src/media/import-narration.ts`, script `media:narration` in `apps/api/package.json`).
   - Input: lesson slug plus a folder of `<step idx>.mp3` files.
   - Looks up the lesson's `currentVersionId` and step ids, calls `saveMedia({ kind: "narration", stepId, ... })` per file.
   - Idempotent: skip a step that already has a `ready` narration row for that version.
   - Fails clearly with `PRECONDITION_FAILED` when `S3_*` is unset.
2. **Make `media` narration-only.** In `listMedia`, filter `kind = 'narration'`; images stay inline in the doc. Narrow the zod enum in `lessons/router.ts:39` to `"narration"`. This removes the duplicate and the cross-version gap above.
3. **Tests** (`apps/api/test/media.test.ts`, `memoryStorage`):
   - import writes one object and one row per step, with the right `stepId`;
   - running it twice adds nothing;
   - `lessons.get` returns narration URLs in `media` and no image entries;
   - existing `imagegen.test.ts` still passes (images still saved via `saveMedia`).
4. **Ticket update:** comment on LQ-45 that the image half landed in LQ-19 and this PR adds the narration path. Unblock LQ-24.

## LQ-46: provision buckets (manual, by you)

These steps need Cloudflare and Render accounts and secret values, so they are done by hand, not by Claude. Per environment (`staging`, `prod`), following `docs/adr/0001-object-storage.md`:

1. Create R2 bucket `lq-media-<env>`, public access off.
2. Create an R2 API token, "Object Read & Write", scoped to that bucket only.
3. On the matching Render service, set `S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `S3_REGION` stays `auto`. `env.ts` rejects a partial set, so a typo fails the deploy rather than silently disabling media.
4. Lifecycle rule: abort incomplete multipart uploads after 1 day.
5. Redeploy and confirm the service boots.

Code change that goes with it (small PR, can ride with LQ-45):

- **CSP:** add the R2 origin to `media-src` in `apps/web/vercel.json`. Without it, LQ-47's audio check fails.
- Optional: log `media storage: configured|off` once at API startup (no secrets), so you can confirm step 5 from Render logs.

## LQ-47: verify against the real staging bucket

1. **Opt-in live test** `apps/api/test/media.live.test.ts`, skipped unless `S3_LIVE=1` plus `S3_*` are set, so CI stays offline:
   - `saveMedia` a real small PNG and MP3 through `s3Storage`;
   - `HeadObject` each key: `Content-Type` matches, `Cache-Control` is `private, max-age=31536000, immutable`;
   - `fetch(signGet(key))` returns 200 with the same bytes;
   - a tampered signature returns 403;
   - an expired URL (signed with a past `signingDate` and short `expiresIn`) returns 403;
   - delete the test objects afterwards.
2. **Browser check on staging:** import narration for lesson 1 (LQ-45 command), open it, confirm in the network panel that `<img>` and `<audio>` load from R2 with no CSP errors.
3. **Record results** as a comment on LQ-36, then close LQ-45, LQ-46, LQ-47.

## Before pushing

Run the full turbo CI locally with test Postgres on port 5433.
