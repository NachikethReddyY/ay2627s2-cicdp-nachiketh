# Visual probes

Hand-written specs for testing stage (2D) and scene3d (3D) motion before we build more on them. Each file is one full spec: a short text note, then one visual.

## How to view one

1. Start the web app (`apps/web`) and open `/dev/blocks` (dev only).
2. Open the **Spec JSON** box and replace its contents with a probe file.
3. The preview re-renders as you type. Use the step controls and watch the motion.

## Probes

| File | Block | Tests | Watch for |
| --- | --- | --- | --- |
| 01-stage-bounce-lively | stage physics | Restitution 0.85 | Gravity feel, height kept, settle without stalling |
| 02-stage-bounce-dull | stage physics | Restitution 0.3 | Stops after a few hops, no sticking |
| 03-stage-roll-linear | stage timeline | Position and colour over three steps | Easing between steps, abrupt stops |
| 04-stage-pulse-fade | stage timeline | Opacity and fill in one step | Whether the two blend smoothly |
| 05-stage-many-shapes | stage timeline | 40 shapes, 4 moving | Smoothness, label collisions |
| 06-scene3d-spin-box | scene3d timeline | Rotation, orbit controls | Smooth turn, stays in place |
| 07-scene3d-fall-sphere | scene3d timeline | Position with no physics | Does a timeline drop read as gravity? |
| 08-scene3d-materials-recolour | scene3d groups | Matte, glossy, wire; colour and opacity | Materials read differently, labels readable |
| 09-stage-two-balls-collide | stage timeline | Two bodies meeting | Impact feel; physics only drives one body |

`test/probes.test.ts` checks that every probe parses with no issues.

## Limits we expect to hit (not yet confirmed by viewing)

These come from reading the schemas, not from running the probes:

- Stage has no rotation or scale, so a spinning or squashing shape cannot be written.
- Every timeline move is linear. There is no easing or curve.
- Stage physics drives one falling body only. Collisions have to be scripted.
- scene3d has no physics, so a fall or bounce in 3D is only a timeline.
- Each block has at most 60 shapes and 10 timeline steps.

Confirming or ruling these out is the point of the probes.
