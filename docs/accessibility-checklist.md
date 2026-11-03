# Accessibility and mobile checklist

This document is a static source review checklist. It is not a report of testing
with assistive technology or on physical devices. Every device and
screen-reader check below remains owner-only and must be completed on the target
devices before release.

## Static review

- [x] Visual block controls have accessible names or visible labels.
- [x] Game outcome and timeline updates have polite live announcements.
- [x] Interactive controls use a 44px minimum height where styled in the block
  renderers.
- [x] Drag game placement boxes support keyboard activation as well as
  pointer/touch activation.
- [x] Charts provide a data table; image and diagram blocks expose alt text.
- [x] Reduced-motion handling is present for animated game and timeline views.
- [ ] Verify focus order and visible focus indicators by keyboard in the app.
- [ ] Check narrow mobile layouts for scrolling, clipping, and usable controls.

## Owner-only device pass

- [ ] VoiceOver: navigate each visual block and game, confirm names, roles,
  state, reading order, and live announcements.
- [ ] TalkBack: repeat the same checks on Android, including drag-game placement
  using the keyboard/touch alternatives.
- [ ] Keyboard: complete each game and timeline without a pointer; confirm the
  focus order and visible focus at every step.
- [ ] Low-end Android device: check rendering, interaction latency, memory use,
  and recovery when WebGL is unavailable or lost.
- [ ] Data-saver and constrained network: confirm described-image fallbacks,
  lazy image loading, and that interactive blocks remain usable.
- [ ] Check accessibility and mobile performance budgets on representative
  devices and record the device/browser versions and findings here.
