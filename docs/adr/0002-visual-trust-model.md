# ADR 0002: Visual trust model

Status: accepted for the current visual document pipeline; remaining work is
listed below.

## Context

Generated visual documents are untrusted JSON. The shared catalog defines the
allow-listed block types and validates each document. The engine validates a
document before returning it, and the API validates it again before saving.
The web renderer parses it again before rendering. Invalid visual data can be
dropped while the learner-facing text body remains available.

## Decision

- Treat model output and stored visual documents as untrusted at every
  boundary. Use `packages/ui-catalog` parsing and schemas; render only
  registered block types.
- Keep `run` reserved in `packages/ui-catalog/src/core/reserved.ts`. It names
  the Daytona code runner but is not a registered visual block. Daytona
  execution is reserved for a server-only boundary; visual documents and the
  browser renderer cannot invoke it. No Daytona execution path is implemented
  by this visual pipeline.
- Keep learner-facing content separate from visual data. The engine prompt
  adds the generated visual catalog and schema to eligible lesson-part
  requests. Its visual validator drops an invalid `doc`; the API repeats
  validation at persistence; the browser reparses before display.
- Keep image generation separate from this JSON visual trust boundary. The
  live image pipeline is skipped (LQ-62).

## Consequences

- The catalog and its generated schema are the contract shared by generation,
  persistence, and rendering.
- A malformed or unsupported visual must not make its surrounding lesson text
  unavailable.
- New renderable types must be added to the allow-list and documented before
  model output can use them.
- The self-harm support copy and `MODERATION_API_KEY` setup need owner action.
  A live visual eval, the physical-device accessibility pass, and the Vercel
  CSP check are also not done; this ADR records no result for them.
- Pass thresholds, provider prices, and tier budgets remain placeholders for
  the owner, not final values. See [the visual eval notes](../evals/README.md).

## Not done

- LQ-37 learn and game-practice rendering paths remain dependent on that work
  and are not claimed complete here.
- LQ-62 image pipeline is skipped.
- Owner-only steps: finalize self-harm copy; configure
  `MODERATION_API_KEY`; run and record the live eval; complete device
  accessibility checks; and check the deployed Vercel CSP.

## References

- [Rendering guide](../rendering.md)
- [Visual eval notes](../evals/README.md)
- [Accessibility checklist](../accessibility-checklist.md)
