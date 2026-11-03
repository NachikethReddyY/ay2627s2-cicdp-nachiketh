# Visual end-to-end test plan

This is a plan, not a report that end-to-end checks passed. No live eval,
physical-device accessibility run, or deployed Vercel CSP check is recorded in
this document.

## Automated coverage to run

- Catalog: valid documents parse; unknown, reserved (`run`), malformed, and
  over-limit blocks are rejected or dropped as defined by the catalog tests.
- Engine: visual output passes the committed schema; invalid output is repaired
  once and then rejected; a lesson's text body remains when its visual is
  invalid.
- API: persistence validation excludes invalid visual data without losing the
  learner-facing body.
- Web: the visual viewer shows registered blocks and the accessible fallback
  for rejected blocks. Exercise each interactive block, including game
  completion behavior.

These test cases describe coverage goals. This plan does not assert that they
were run or passed in this session.

## Manual checks

- In the dev visual page, submit one valid example per registered block and
  malformed and reserved examples; confirm fallback behavior and no lesson
  blanking.
- Complete each interactive game with pointer and keyboard input and inspect
  focus order, focus visibility, names, roles, and status announcements.
- On target iOS and Android devices, use VoiceOver and TalkBack; check narrow
  layouts, reduced motion, WebGL failure/recovery, and constrained network.
- Check the deployed Vercel response headers and confirm the CSP permits only
  the required application resources.

The assistive-technology, physical-device, and deployed CSP checks are
owner-only and not done. LQ-37 learn and game-practice paths are dependencies
and are not claimed complete. LQ-62 image pipeline is skipped. Configure
`MODERATION_API_KEY` and finalize self-harm support copy as owner steps. Run
and record a live eval only as an owner; its pass threshold, token prices, and
tier budgets remain placeholders. See the [accessibility checklist](accessibility-checklist.md),
[eval notes](evals/README.md), and [trust ADR](adr/0002-visual-trust-model.md).
