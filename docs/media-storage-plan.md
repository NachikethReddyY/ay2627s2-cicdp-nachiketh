# Lesson media in object storage (LQ-36)

Goal: narration MP3s (LQ-24) and AI/lesson images live in a private S3-compatible bucket. The API writes them and hands the browser short-lived signed read URLs. Blocks LQ-24.

Out of scope: the Pip images in `apps/web/public/img`. They are brand assets shipped with the web build and cached by Vercel's CDN; moving them gains nothing. Only per-lesson media moves.

## 1. Decision (record as `docs/adr/0001-object-storage.md`)

**Cloudflare R2.** Reasons:
- **No egress fees.** Narration is replayed by every learner on every lesson; egress is the cost that grows, and R2 doesn't charge it.
- Plain S3 API, so the code uses the standard AWS SDK and we can move to Neon storage, S3 or MinIO by changing four env vars.
- Bucket-scoped API tokens (needed for "credentials scoped per environment").

Alternative kept open: **Neon object storage** (one vendor fewer). Nothing in the repo configures it yet: the root `neon.ts` declares only Neon auth and a branch TTL policy. Pick it instead if its pricing/egress checks out; nothing in §3 changes.

## 2. Cloud setup

| Item | Staging | Prod |
|---|---|---|
| Bucket | `lq-media-staging` | `lq-media-prod` |
| Location hint | same region as the Neon project | same |
| Public access | **off** (no `r2.dev` URL, no custom public domain) | **off** |
| API token | "Object Read & Write", **this bucket only** | same, prod bucket only |
| Where the token lives | Render env vars on `lq-api-staging` | Render env vars on `lq-api-prod` |

Steps:
1. Create both buckets. Leave public access disabled.
2. Create one API token per bucket, scoped to that bucket only, read+write object (no admin, no bucket create/delete). Staging token can't touch prod.
3. Put the token into the matching Render service as `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Never in the repo, `.env` example values are placeholders, GitHub Actions doesn't need them (the API writes at runtime, CI uses a fake).
4. Lifecycle rule: abort incomplete multipart uploads after 1 day (cheap safety net; we don't use multipart but it stops leaked partials).
5. CORS: **none needed.** `<audio src>` and `<img src>` don't do CORS. Add `GET` from `PUBLIC_ORIGIN` only if we ever `fetch()` media from JS.
6. Rotation: tokens are rotated by creating a new token, updating Render, redeploying, then deleting the old one. Write this in the ADR.
7. Local dev: optional MinIO service in `docker-compose.yml` (`127.0.0.1:9000`, bucket `lq-media-dev`). Without S3 vars the API runs; media calls answer `PRECONDITION_FAILED`, same as AI without `ANTHROPIC_API_KEY`.

## 3. Code

### 3.1 Dependencies (`apps/api`)
`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`. Nothing else.

### 3.2 Env (`apps/api/src/env.ts`)
```ts
S3_ENDPOINT: z.url().optional(),
S3_BUCKET: z.string().min(1).optional(),
S3_ACCESS_KEY_ID: z.string().min(1).optional(),
S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
S3_REGION: z.string().default("auto"),
```
All four set or none (add a `.refine`), so a half-configured deploy fails at boot instead of at the first upload.

### 3.3 Schema (`apps/api/src/db/schema.ts`) + migration
New table, expand-only (old code ignores it):
```ts
export const lessonMedia = pgTable("lesson_media", {
  id: id(),
  lessonVersionId: text("lesson_version_id").notNull().references(() => lessonVersions.id),
  stepId: text("step_id").references(() => steps.id),           // null = lesson-level (cover image)
  kind: text("kind", { enum: ["narration", "image"] }).notNull(),
  key: text("key").notNull().unique(),                          // object key, never a URL
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: createdAt(),
}, (t) => [index("lesson_media_version").on(t.lessonVersionId)]);
```
Tied to the **version**, not the lesson: a new version gets new narration and old versions keep theirs. Add `lesson_media` to the `TRUNCATE` in `test/helpers.ts`. Generate with `pnpm --filter @learnquest/api db:generate`.

### 3.4 Storage module (`apps/api/src/media/storage.ts`)
Small interface so tests can swap it:
```ts
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signGet(key: string): Promise<string>;
}
```
- `s3Storage()`: `PutObjectCommand` with `ContentType`, `CacheControl: "private, max-age=31536000, immutable"` (keys never change, see below). `signGet` uses `getSignedUrl`.
- `memoryStorage()`: a `Map`, `signGet` returns `memory://<key>`. Used by tests.
- Pick once at startup from env; export `storage` like `db` is exported.

### 3.5 Writing media (`apps/api/src/media/service.ts`)
`saveMedia({ lessonVersionId, stepId, kind, body, contentType })`. The **server** generates narration and images, so the browser never uploads. That alone gives "no public write access": no presigned PUT exists.

Checks, in order, before anything leaves the process:
1. **Type allowlist** per kind: narration → `audio/mpeg`; image → `image/png`, `image/webp`, `image/jpeg`.
2. **Size cap**: narration 10 MB, image 2 MB. Reject on `body.byteLength`.
3. **Magic bytes** match the claimed type (MP3 `ID3` or frame sync `0xFFE`, PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`). AI output is untrusted input; this stops an HTML/SVG blob being stored as an "image". No SVG allowed at all (it can carry script).
4. **Key is built by the server**, never from input: `v/<lessonVersionId>/<uuid>.<ext>`. No user string in the path, so no traversal or overwrites; the UUID makes every key immutable.
5. `storage.put(...)`, **then** insert the `lesson_media` row. If the insert fails we leave an orphan object (harmless, cleaned later), never a row pointing at nothing.

If browser uploads are ever needed (author UI), add a presigned **POST** with a `content-length-range` and fixed `Content-Type` condition, expiring in 5 min, owner-only. Not now.

### 3.6 Reading media (`apps/api/src/lessons/router.ts`)
`lessons.get` already checks visibility. After it loads steps, one query for `lesson_media where lesson_version_id = currentVersionId`, then sign each key and add to the output:
```ts
media: z.array(z.object({ stepId: z.string().nullable(), kind: z.enum(["narration","image"]), url: z.string() }))
```
Signing is local HMAC (no network call), so this costs microseconds per item.

**Expiry:** 1 hour (covers a lesson session; a leaked link dies quickly).

**Cache-friendly signing:** pass `signingDate` floored to the start of the current hour and `expiresIn: 2h`. Every request in the same hour gets the *same* URL, so the browser cache and HTTP range requests for audio hit instead of re-downloading. A URL is valid for 1–2 h.

Access control stays in one place: the visibility check that already guards `lessons.get`. No separate media endpoint to secure.

### 3.7 Web (`apps/web`)
- Player renders `<audio src={url} preload="auto">` for narration (as `Player.tsx` does today) and `<img>` for step images from `media`.
- If the player stays open past expiry, a failed `<audio>` load triggers a `lessons.get` refetch (the existing tRPC query invalidation) to get fresh URLs.
- The `audio/` exclusion is removed from the SPA rewrite in `vercel.json`; nothing serves from `public/audio`.
- The web CSP (`apps/web/vercel.json`) allows the R2 endpoint in `media-src`; `img-src` already allows any `https:` host.

## 4. Tests (no live calls)
`apps/api/test/media.test.ts`, using `memoryStorage()`:
- rejects wrong type, oversize body, mismatched magic bytes, SVG.
- `saveMedia` writes the object then the row; key matches `v/<versionId>/<uuid>.mp3`.
- `lessons.get` returns media for a visible lesson; a private lesson owned by someone else returns `NOT_FOUND` (no URLs leak).
- `s3Storage().signGet` with dummy creds and endpoint (pure signing, no network): URL has `X-Amz-Expires=7200`, and two calls in the same hour return the same URL.

CI needs no new secrets or services.

## 5. Order of work (fits one PR, ~5 pts)
1. ADR + env vars + deps.
2. Schema + migration + test helper truncate.
3. `storage.ts` + `service.ts` + validation tests.
4. `lessons.get` media output + tests.
5. Cloud: buckets, tokens, Render env vars (staging first, smoke-test one upload, then prod).
6. Web player wiring (can be LQ-24's PR if narration isn't generated yet).

## 6. Later (not in this ticket)
- Orphan cleanup: a pg-boss job that lists `v/` prefixes with no `lesson_media` rows and deletes them.
- Deleting media when a lesson version is archived (we keep it for now; it's small and old versions may still be replayed).
