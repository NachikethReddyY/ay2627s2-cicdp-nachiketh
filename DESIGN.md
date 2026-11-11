---
version: beta
name: LearnSlop-design
description: A dark, glassy design system modelled on a code editor. Charcoal base (`#202020`), frosted panels, a blue accent, and the editor's syntax palette (pink, coral, cyan, yellow, mint) for code and highlights. Inter-style grotesk for UI, a monospace for code. Pip, the sprout mascot, stays as the guide.

colors:
  base: "#202020"
  base-deep: "#1A1A1A"
  panel: "#303030"
  panel-tint: "#202030"
  line: "#404040"
  text: "#E0E0E0"
  text-strong: "#FFFFFF"
  muted: "#A0A0A0"
  faint: "#808080"
  blue: "#1890E4"
  cyan: "#5CC8F0"
  pink: "#F06CA8"
  coral: "#E47860"
  yellow: "#E4C46C"
  mint: "#6CD4A4"
  wallpaper: "#5080E0"

typography:
  display:
    fontFamily: "'Geist', system-ui, sans-serif"
    fontWeight: 600
  serif-accent:
    fontFamily: "'Newsreader', Georgia, serif"
    fontWeight: 400
    fontStyle: italic
  body:
    fontFamily: "'Geist', system-ui, sans-serif"
    fontWeight: 400 / 500 / 600
  code:
    fontFamily: "'Geist Mono', ui-monospace, Menlo, Consolas, monospace"
    fontWeight: 400 / 500

rounded:
  window: 14px
  card: 24px
  panel: 28px
  control: 999px
  field: 12px

glass:
  fill: "rgba(255, 255, 255, 0.07)"
  fill-strong: "rgba(255, 255, 255, 0.12)"
  edge: "rgba(255, 255, 255, 0.16)"
  blur: 24px

shadows:
  lift: "0 40px 80px -30px rgba(0, 0, 0, 0.6)"
  glow-accent: "0 12px 32px -10px rgba(24, 144, 228, 0.7)"
---

# LearnSlop Design System

The app is a code editor for learning. The landing page should look like the same product: a dark workspace, quiet panels, and colour used for code meaning rather than decoration. Glass comes from light frosted panels over a dark base, not from bright gradients.

This spec replaces the earlier sticker system (cream canvas, ink outlines, hard shadows). The implementation in [apps/web/src/index.css](apps/web/src/index.css) still carries that older palette for Home, Course and Login. The landing page is built in [apps/web/src/pages/landing.css](apps/web/src/pages/landing.css) under the `.lp` class and follows this spec.

## Principles

- **Editor first.** Surfaces look like an IDE: dark base, thin 1px borders, a title bar with traffic-light dots, tabs, and a status bar. Show the product before describing it.
- **Colour means something.** The syntax palette carries meaning: pink for keywords and the predict action, coral for strings and warnings, cyan for functions and hints, yellow for numbers and attention, mint for correct answers and success. Blue is the accent for focus and primary actions. Do not use these colours as decoration.
- **Glass is a layer, not a look.** Frosted panels sit above the base to separate floating UI (nav, cards, demos) from the workspace. Blur stays at 24px or less. Glass never sits on a bright image.
- **Calm motion.** Motion settles. Use ease-out curves with a small overshoot on press and entrance. Nothing loops except ambient background drift and a single pulse on the live dot.
- **Pip is the guide.** Pip sits on the edge of a panel and reacts to what the learner does. Pip never appears inside code.

## Colours

| Token | Hex | Use |
|---|---|---|
| base | `#202020` | page background, the editor canvas |
| base-deep | `#1A1A1A` | code blocks, inset wells |
| panel | `#303030` | raised surfaces, borders on the editor, the status bar |
| panel-tint | `#202030` | sidebars, the file tree |
| line | `#404040` | dividers, 1px borders on glass |
| text | `#E0E0E0` | body text and code |
| text-strong | `#FFFFFF` | headings and the active tab |
| muted | `#A0A0A0` | secondary text, labels, placeholders |
| faint | `#808080` | line numbers, disabled text, file metadata |
| blue | `#1890E4` | primary action, focus ring, links, the active line marker |
| cyan | `#5CC8F0` | functions, hints, the mastery fill's light end |
| pink | `#F06CA8` | keywords, the "predict" step, the first mastery bar |
| coral | `#E47860` | strings, incorrect answers (soft), attention |
| yellow | `#E4C46C` | numbers, the "Next up" callout, the streak |
| mint | `#6CD4A4` | correct answers, success, the done state |
| wallpaper | `#5080E0` | the desktop wallpaper behind the editor window. Used only in mock-ups, never in the page |

Glass tints are white at low alpha. Use `rgba(255,255,255,0.07)` for a panel, `0.12` for a hover state, and `0.16` for the 1px edge. The mesh background uses blue, pink and coral blurred blobs at low opacity (about 0.3 to 0.5) on the base colour.

### Contrast

- Body text `#E0E0E0` on `#202020` is about 12:1. Muted `#A0A0A0` on `#202020` is about 6.5:1. Both pass AA for body text.
- Primary button text is `#202020` on the light fill. Do not place white text on `#1890E4` at small sizes.
- Focus ring: 2px `#1890E4`, offset 4px. On a `#1890E4` fill, use a white ring instead.

## Typography

- **Display** (headlines, section titles): Geist 600, tight tracking (-0.035em), line height 1.02. The hero title is 60px to 76px on desktop, 46px on phone. Section titles are 40px to 48px, 32px on phone.
- **Serif accent**: Newsreader italic, used for one word per heading (for example "guessing", "you", "guess"). It sets the emphasis. Never use it for body text.
- **Body**: Geist 400, 16px to 18px, line height 1.6. Lead paragraphs are 20px in `muted`.
- **Labels and eyebrows**: Geist Mono 12px, uppercase, letter-spacing 0.14em, in `muted`.
- **Code**: Geist Mono 13px to 14px, line height 1.7, on `base-deep`. Keywords are pink, functions cyan, strings coral, numbers yellow, comments faint, and punctuation text.
- Use `font-variant-numeric: tabular-nums` for any figure in a column.

## Surfaces

| Surface | Spec | Use |
|---|---|---|
| `editor window` | `base` fill, 1px `line` border, 14px radius, a title bar in `panel` with three dots (coral, yellow, mint), a status bar at the foot | the hero demo and product screenshots |
| `glass card` | `rgba(255,255,255,0.07)` fill, backdrop blur 24px, 1px edge, 28px radius, inset top highlight, the lift shadow | nav, feature cards, the mastery panel |
| `well` | `base-deep` fill, 1px `line` border, 16px radius | code blocks inside a window or card |
| `tab` | a flat rectangle, `panel` when active with a 2px blue top edge, `base` when idle | editor tabs |

No card has a hard offset shadow. Depth comes from the blur, the edge highlight and one soft, large shadow.

## Controls

- **Primary button**: a pill, light fill (`#E0E0E0` to `#BFE0F5`), `#202020` text, 600 weight, 15px to 16px. Hover adds a blue glow (`0 18px 40px -10px rgba(92,200,240,0.85)`). Press scales to 0.96.
- **Ghost button**: a pill, `rgba(255,255,255,0.08)` fill, 1px edge, `#E0E0E0` text. Hover goes to `0.14`.
- **Answer option**: a 12px-radius glass tile in the predict demo. Hover lifts 2px. Correct turns mint, wrong turns coral at 25% alpha and shakes once. Crossed-out options are faint with a line through them.
- **Chip**: a pill, glass fill, 1px edge, 14px text in `muted`.
- **Live dot**: a 8px mint dot with a single soft ring pulse.
- **Focus**: 2px `blue` outline, offset 4px. Never removed.

## Layout

- Page width 1152px (max-w-6xl) with 24px side padding, 20px on phone.
- Floating nav: a glass pill 16px from the top, full width minus gutters. It gains a deeper shadow after scrolling 24px.
- Hero: two columns, the copy on the left and the editor window on the right, 56px gap. Stack on phone with the copy first.
- Concepts: one slow horizontal marquee, faded at both ends, paused on hover.
- Moves: four glass cards in a row (two on tablet, one on phone). Each card has a tinted orb holding the Pip scene, a step label, a title and two lines of copy.
- Comparison: two glass cards side by side. The positive card has a mint edge.
- Mastery: a Pip illustration above a glass panel with three bars.
- Finale: one large glass panel with a soft blue to coral wash and a centred CTA.

## Motion

- Timing: fast 150ms, medium 300ms, slow 800ms.
- Easing: entrance `cubic-bezier(0.22, 1, 0.36, 1)`, press and overshoot `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Entrances: fade with a 36px rise and 8px blur clearing, staggered by 120ms within a group.
- Bars fill from zero over 1.1s with a 150ms delay per bar. Numbers count up over 1.2s.
- The headline reveals word by word, each word 40px up, 10px blur, 70ms apart.
- Scroll progress: a 3px bar at the top of the viewport, blue to pink to yellow.
- Ambient: the background mesh drifts over 24s and moves slower than the page on scroll.
- Reduced motion: under `prefers-reduced-motion: reduce`, all animations and transitions drop to 0.01ms, loops stop, and content stays visible.

## Pip

- Pip is the mint sprout mascot from the existing assets. Keep the existing illustrations. Pip's body is `#6CD4A4` in the artwork, not the editor palette.
- Pip sits on the edge of a panel, floats at about 4s, and wiggles in the wave pose.
- Poses: wave (idle), think (hint), oops (wrong answer), cheer (correct), sheet (empty).
- Pip is never drawn inside a code block.

## Voice

Short, direct and concrete, as a knowledgeable peer would speak. Predict first, then watch. Never claim hints earn mastery. Each recommendation states its reason. Buttons state the action ("Play a step").

## Do and don't

- Do build surfaces from the tokens above, and keep a 1px border on every panel.
- Do use the syntax colours only for code meaning.
- Do keep the mock-ups honest: show the real product, and label example data as examples.
- Don't add gradients beyond the blurred background blobs and the headline accent.
- Don't put hard offset shadows on new components. That is the old system.
- Don't use bright white cards on the dark base.
- Don't add colours outside the table without updating this file.
