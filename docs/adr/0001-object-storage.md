# ADR 0001: Object storage for lesson media

Status: accepted (LQ-36)

## Context

Narration MP3s (LQ-24) and AI lesson images are per-lesson media. Every learner replays narration on every lesson, so egress is the cost that grows. Media is private: the API writes it and hands the browser short-lived signed read URLs. Pip images in `apps/web/public/img` are brand assets shipped with the web build and are out of scope.

## Decision

Use **Cloudflare R2** through the standard AWS S3 SDK.

- **No egress fees.** Replay traffic costs nothing per GB.
- Plain S3 API. Moving to Neon object storage, S3 or MinIO means changing the four `S3_*` env vars, not the code.
- Bucket-scoped API tokens, so staging and prod credentials are separate.

Alternative kept open: Neon object storage (one vendor fewer). Pick it if its pricing and egress check out; the code does not change.

## Consequences

- The API is the only writer. The server generates the bytes, so no presigned write URL exists.
- Keys are `v/<lessonVersionId>/<uuid>.<ext>`, built by the server and never changed. Media belongs to a lesson version, so a new version gets new narration and old versions keep theirs.
- Signed read URLs expire 2 hours after the start of the current hour. Every request in an hour gets the same URL, so browser caching and range requests work.
- Access control is the visibility check in `lessons.get`. There is no separate media endpoint.
- Buckets have public access off. No CORS rule is needed because `<audio>` and `<img>` do not use CORS.

## Operations

Per environment (`staging`, `prod`): one bucket (`lq-media-<env>`), public access off, one API token with "Object Read & Write" scoped to that bucket only. The token goes into the matching Render service as `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_REGION` if it is not `auto`. Never commit these values.

Lifecycle rule: abort incomplete multipart uploads after 1 day. Rotation: create a new token, update Render, redeploy, then delete the old token.

Local dev runs without the `S3_*` variables. Media calls then answer `PRECONDITION_FAILED`, the same as AI calls without `ANTHROPIC_API_KEY`.
