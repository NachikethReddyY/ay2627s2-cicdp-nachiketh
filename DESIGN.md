---
version: beta
name: LearnSlop-design
description: Geist-style system in two scopes. The landing page (.lp) is dark only, with a pure black canvas, a gray ramp for hierarchy, 1px rings instead of borders, pill buttons and one blue accent. The app (:root) is the light and dark editor system, built on the same ideas. Geist for UI, Geist Mono for code.

colors:
  landing:            # .lp in apps/web/src/pages/landing.css, dark only
    bg: "#000000"
    g1: "#0A0A0A"
    g2: "#141414"
    g3: "#1F1F1F"
    text: "#EDEDED"
    muted: "#A1A1A1"
    faint: "#8F8F8F"
    accent: "#3262E6"
    accent-hover: "#2552C4"
    accent-bright: "#5583FF"
    ok: "#3FC07A"
    bad: "#FF6369"
  light:              # :root in apps/web/src/index.css
    page: "#F6F6F8"
    text: "#1C1C1E"
    muted: "#555A66"
    line: "#D7D6D6"
    side: "#EDECEC"
    surface: "#FFFFFF"
    accent: "#2F5FD6"
    accent-text: "#2852C0"
    ok: "#1F9D55"
    bad: "#C2362F"
    warn: "#B7791F"
  dark:               # :root under prefers-color-scheme: dark
    page: "#1E1E1E"
    text: "#ECECEC"
    muted: "#A3A3A8"
    line: "#3A3A3A"
    side: "#282828"
    surface: "#262626"
    accent: "#2F5FD6"
    accent-text: "#8FB0FF"
    ok: "#3FC07A"
    bad: "#FF6B61"
    warn: "#E0A84A"

typography:
  display:
    fontFamily: "'Geist', system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.05em (hero), -0.045em (section titles)"
  body:
    fontFamily: "'Geist', system-ui, sans-serif"
    fontWeight: 400 / 500 / 600
  code:
    fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace"
    fontWeight: 400 / 500

rounded:
  sm: 6px         # landing --r-sm: tabs, kbd, focus ring corner
  md: 8px         # landing --r-md: code boxes, skip link
  lg: 12px        # landing --r-lg: cards, windows, screenshot frame
  pill: 100px     # landing buttons and chips (the app uses 9999px)
  app-card: 20px  # app .chunk (1.25rem)
  app-tile: 12px  # app .opt

glass:            # app only. The landing has no glass.
  light: "rgba(255, 255, 255, 0.82) over a 1px rgba(20, 30, 70, 0.10) edge"
  dark: "rgba(38, 38, 38, 0.78) over a 1px rgba(255, 255, 255, 0.10) edge"
  blur: 20px

shadows:
  ring: "0 0 0 1px rgba(255, 255, 255, 0.10)"                # landing --ring, the border
  ring-hi: "0 0 0 1px rgba(255, 255, 255, 0.24)"            # landing --ring-hi, hover
  lift-landing: "0 2px 2px rgba(0, 0, 0, 0.3), 0 8px 16px -4px rgba(0, 0, 0, 0.4)"  # landing --lift
  lift: "0 1px 2px rgba(20, 30, 70, 0.08), 0 18px 48px -18px rgba(20, 30, 70, 0.28)" # app --lift, light
  glow-accent: "0 10px 28px -10px rgba(47, 95, 214, 0.7)"   # app .btn hover
---

# LearnSlop Design System

LearnSlop follows Vercel's Geist approach: Geist type, a near-black canvas with a gray scale for hierarchy, borders drawn as 1px rings, pill buttons and a single restrained blue accent. The landing page and the app both use it, but they apply it differently. This is a Geist-inspired system written from the shipped CSS, not an import of Vercel's token package.

There are two scopes, and this file documents both because the code ships both:

| Scope | Where | Theme | Tokens |
|---|---|---|---|
| **Landing** | `.lp` in [landing.css](apps/web/src/pages/landing.css) and [landing/sections.css](apps/web/src/pages/landing/sections.css) | Dark only. `color-scheme: dark` and a `#000` page, whatever the system setting. | `--bg`, `--g1` to `--g3`, `--tx`, `--mu`, `--faint`, `--ring`, `--ac`, `--acD`, `--acH`, `--ok`, `--bad`, `--r-sm/md/lg` |
| **App** | `:root` in [index.css](apps/web/src/index.css). The practice workbench (`.wb`, [workbench.css](apps/web/src/player/workbench/workbench.css)) re-declares the token names at its own scope. | Light by default, dark under `prefers-color-scheme: dark` | The editor set: `--page`, `--tx`, `--mu`, `--line`, `--code`, `--ac`, `--acT`, the syntax colours, glass |

The two scopes share some token names (`--tx`, `--mu`, `--ac`, `--ok`, `--bad`, `--lift`) but not all of their values. Inside `.lp` the landing values win. Where this file and the stylesheets disagree, the CSS is what ships.

The earlier sticker system (cream canvas, 3px ink outlines, hard offset shadows, Fraunces and Nunito) has been removed.

## Principles

- **Black canvas, gray for hierarchy.** The landing is `#000`. Surfaces step up through `#0a0a0a`, `#141414` and `#1f1f1f`. Text uses three steps: `#ededed`, `#a1a1a1` and `#8f8f8f`. Hierarchy comes from gray steps, not from colour.
- **Borders are rings.** A panel edge is `box-shadow: 0 0 0 1px rgba(255,255,255,.1)` (`--ring`), not a `border`. Hover brightens it to `.24` (`--ring-hi`). Depth comes from the ring plus one short, soft `--lift`, never a hard offset.
- **One accent, used sparingly.** Blue `#3262e6` marks the primary call to action, the current step, the selected chip and your own chat bubble. Everything else is gray.
- **Colour means something.** Green (`--ok`) is for correct, done and gain. Red (`--bad`) is for removed lines and locked or failed states. In the app the syntax palette (`kw`, `fn`, `nu`, `str`) is for code only.
- **Show the product.** The landing explains each feature with a static product card next to the copy. Cards are decorative (`role="img"` with a descriptive label), and their numbers are illustrative, never learner data.
- **Predict before reveal.** The copy and the mockups ask before they show.

## Colours

Use the token, not the hex.

### Landing (`.lp`, dark only)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000` | page (also set on `html` and `body` while `.lp` is mounted) |
| `--g1` | `#0a0a0a` | cards, windows, the chart, the topic card |
| `--g2` | `#141414` | declared, not used yet |
| `--g3` | `#1f1f1f` | active tab, help-chat bot bubble |
| `--tx` | `#ededed` | headings, body text, code text |
| `--mu` | `#a1a1a1` | lead and lede paragraphs, checklist text, nav links |
| `--faint` | `#8f8f8f` | metadata, footer, file names, disabled ghost text. Product-card meta text (`.lp-msub`, `.lp-mstat`) uses `--mu` instead for contrast. |
| `--ring` | `0 0 0 1px rgba(255,255,255,.1)` | every panel and chip edge |
| `--ring-hi` | `0 0 0 1px rgba(255,255,255,.24)` | ring on hover |
| `--lift` | `0 2px 2px rgba(0,0,0,.3), 0 8px 16px -4px rgba(0,0,0,.4)` | cards, paired with `--ring` |
| `--ac` | `#3262e6` | primary button, current step, your chat bubble, marked-line bar |
| `--acD` | `#2552c4` | primary button hover |
| `--acH` | `#5583ff` | focus ring, selected-chip ring, "Your turn" status, current-node halo |
| `--ok` | `#3fc07a` | checklist ticks, added diff lines, the mastery trend |
| `--bad` | `#ff6369` | removed diff lines, "Locked" |

Fixed colours (not tokens) that appear in the landing CSS:

- Code boxes and the input well use `#050505`.
- Inactive dots are `#2b2b2b`. Code line numbers are `#5c5c5c`. Inactive roadmap nodes have a `#4a4a4a` ring, and connector dots are `#3a3a3a`.
- The removed-line text is `#ffb3b6`. The hero "See how it works" link is `#c4c4ca`. The locked-hint icon is `#ffc800`.
- Code tokens: keyword `#ff7ab2`, string `#8fd18f`, number `#e0b85c`, comment `#7d7d7d`.
- Selection tints are `rgba(59,110,245,.14)` (marked line) and `.18` (selected chip). Diff tints are `rgba(63,192,122,.12)` (added) and `rgba(255,99,105,.12)` (removed).
- The action pill inverts to `#ededed` with `#0a0a0a` text.
- Pure `#000` is the landing page and skip-link background. Pure `#fff` is the nav Sign in and primary button text, and the logo mark's fills are `#039FF4`, `#028DF1` and `#4FBCF7`.

### App (`:root`, light and dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page` | `#F6F6F8` | `#1E1E1E` | page background |
| `--tx` | `#1C1C1E` | `#ECECEC` | body text, headings, code text |
| `--mu` | `#555A66` | `#A3A3A8` | secondary text, labels, placeholders |
| `--line` | `#D7D6D6` | `#3A3A3A` | dividers, 1px borders |
| `--side` | `#EDECEC` | `#282828` | sidebars, inset wells, inline code |
| `--code` | `#FFFFFF` | `#262626` | solid surface: code, opaque cards |
| `--tbar` | `#FFFFFF` | `#262626` | title bars and toolbars |
| `--pane2` | `rgba(255,255,255,.5)` | `#303030` | pill groups, secondary panes |
| `--chip` | `#FFFFFF` | `#303030` | chips |
| `--track` | `#E4E4E8` | `#3A3A3A` | progress track |
| `--line-strong` | `#8A8F9A` | `#7C7C82` | edge of a field or control that must reach 3:1 |
| `--ac-g` | `= --ac` | `#6F93FF` | accent as a graphical fill or line |
| `--selrow` | `#D7D6D6` | `#3A3A3A` | selected row |
| `--sel` | `rgba(47,95,214,.14)` | `rgba(120,150,255,.22)` | selected tint, text selection |
| `--hov` | `rgba(28,36,64,.07)` | `rgba(255,255,255,.08)` | hover fill |
| `--cur` | `#FFF6CF` | `#34322A` | current line, the blank in a prediction |
| `--numdim` | `#B4B8C0` | `#5F5F5F` | line numbers, disabled text |
| `--ac` | `#2F5FD6` | `#2F5FD6` | primary action fill |
| `--acT` | `#2852C0` | `#8FB0FF` | accent as text, links, focus ring |
| `--on-ac` | `#FFFFFF` | `#FFFFFF` | text on `--ac` |
| `--ok` / `--okT` | `#1F9D55` / `#177A42` | `#3FC07A` / `#3FC07A` | correct, success (fill / text) |
| `--on-ok` | `#0C2417` | `#0C2417` | text on `--ok` |
| `--bad` | `#C2362F` | `#FF6B61` | incorrect, errors |
| `--warn` | `#B7791F` | `#E0A84A` | attention, streak, "Next up" |
| `--kw` | `#9B2393` | `#FF7AB2` | keywords, the predict step |
| `--fn` | `#326D74` | `#78C2FF` | functions, hints |
| `--nu` | `#1C00CF` | `#D9C97C` | numbers |
| `--str` | `#C41A16` | `#FF8170` | strings |
| `--glass` | `rgba(255,255,255,.82)` | `rgba(38,38,38,.78)` | glass panel fill |
| `--glass-line` | `rgba(20,30,70,.10)` | `rgba(255,255,255,.10)` | glass 1px edge |
| `--glass-edge` | `rgba(255,255,255,.90)` | `rgba(255,255,255,.12)` | glass inner highlight |
| `--win` / `--edge` / `--vib` | `rgba(255,255,255,.3)` / `rgba(255,255,255,.7)` / `rgba(237,236,236,.82)` | `rgba(30,30,30,.3)` / `rgba(255,255,255,.12)` / `rgba(40,40,40,.85)` | the floating editor window |

Aliases: `--surface` = `--code`, `--surface-2` = `--side`, `--border` = `--line`, `--focus` = `--acT`.

Tailwind names: the old sticker colour names still resolve. `ink` is `--tx`, `paper` is `--page`, `blue` is `--ac`, `green` is `--ok`, `green-deep` is `--okT`, `pink-deep` is `--kw`, and `sun`, `pink`, `lilac` and `mint` are 16 to 24% tints of `--warn`, `--kw`, `--ac` and `--ok` over `--code`. `bg-white` maps to `--code` and `border-ink` to `--line` during migration. New code uses `bg-[var(--token)]`.

### Contrast

These ratios are calculated from the hex values, not measured in a browser.

- Landing: `#ededed` on `#000` is about 17.9:1, `#a1a1a1` about 8.1:1 and `#8f8f8f` about 6.5:1. White on `#3262e6` is about 5.2:1, and on the `#2552c4` hover about 6.8:1. The `#5583ff` focus ring on black is about 6.1:1.
- App: `#1C1C1E` on `#F6F6F8` is about 16:1, and `#ECECEC` on `#1E1E1E` is about 14:1. White on `#2F5FD6` is about 5.9:1.
- Focus: the app uses 2px `--acT` with a 2px offset. The landing uses 2px `--acH` with a 3px offset. Never remove focus.

## Typography

Geist and Geist Mono load from Google Fonts in `index.html`.

| Role | Landing value | Notes |
|---|---|---|
| Hero `.lp-h1` | `clamp(34px, 5vw, 56px)`, 600, line height 1.05, **letter-spacing -0.05em**, max 24ch, balanced | each sentence on its own line; `7.4vw` under 520px |
| Section `.lp-h2` | `clamp(30px, 4vw, 44px)`, 600, 1.05, -0.045em, max 20ch | closing title is `clamp(36px, 5.2vw, 60px)`, line height 1 |
| Lead `.lp-lead` | `clamp(16px, 2vw, 18px)`, 1.55, `--mu`, max 44ch | |
| Lede `.lp-lede` | 18px, 1.6, `--mu`, max 50ch | |
| Body / checklist | 16px, 1.5 | |
| Nav, small buttons, card text | 14px | |
| Meta, chips | 12px to 13px | mono for file names and numbers |
| Big number `.lp-cbig` | 64px (52px on phone), 600, -0.06em | |
| Code | Geist Mono 13px, line height 20px (cards) or 22px (diff) | 12px under 520px |

- Display is always weight 600 with negative tracking. Body is 400, and emphasis inside cards is 500.
- App headings in Markdown (`.learn-md`) are 600 with -0.02em tracking. App code is Geist Mono, coloured with `--kw`, `--fn`, `--str` and `--nu`, and comments use `--mu` italic.
- Use `font-variant-numeric: tabular-nums` for figures in a column.
- No serif accent.

## Surfaces

### Landing

| Surface | Spec | Used for |
|---|---|---|
| card (`.lp-mcard`, `.lp-chart`, `.lp-topic`, `.lp-hcard`) | `--g1` fill, `--ring` + `--lift`, 12px radius, 20 to 24px padding, max 500 to 520px wide | feature row mockups |
| window (`.lp-win`) | card plus a title bar (three 10px `#2b2b2b` dots, mono tabs) separated by a `0 1px 0 rgba(255,255,255,.08)` hairline | replay row |
| well (`.lp-mbox`, `.lp-pinput`) | `#050505` fill, `--ring`, 8px radius (the input is a pill) | code and input inside a card |
| screenshot (`.lp-shot`) | 12px radius, `--ring` plus `0 40px 80px -24px rgba(0,0,0,.8)` | hero product shot |
| hero tile (`.lp-tile`) | 88px (72 to 76px variants), 24px radius, `linear-gradient(160deg, #1b1b1e, #0e0e10)`, ring, deep shadow, inset top highlight | floating tech logos around the hero |

There is no glass and no backdrop blur on the landing.

### App

| Surface | Spec | Used for |
|---|---|---|
| glass card (`.chunk`) | `--glass`, blur 20px, 1px `--glass-line`, 20px radius, `--lift` | nav, panels, empty states |
| editor window | `--win` over the page, 1px `--edge`, title bar with dots, status bar | lesson player, practice workbench |
| well | `--side` or `--code`, 1px `--line` | code blocks |
| tab | flat, 2px `--acT` underline when active | editor tabs |

Neither scope uses a hard offset shadow.

## Controls

### Landing

- **Primary** (`.lp-btn`): a pill (`border-radius: 100px`), 48px tall with 24px padding, `--ac` fill, white text, 16px weight 500, with a trailing arrow icon. Hover changes the fill to `--acD`, press scales to 0.98, and disabled sits at 0.4 opacity. The small variant `.lp-btn-sm` is 36px tall and 14px.
- **Ghost** (`.lp-ghost`): a pill at least 36px tall, transparent with `--ring`, `--tx` text at 14px. Hover switches to `--ring-hi`. Used for "Sign in". The nav variant (`.lp-navr .lp-ghost`) is filled with `--ac`, white text and weight 800.
- **Text link** (`.lp-sub`): underlined, 4px offset, `rgba(255,255,255,.4)` decoration, 32px minimum target.
- **Chip**: a pill with `--ring`, 13px, `--mu` text. A selected chip gets an `--acH` 1px ring over a blue tint.
- **Action pill** (`.lp-pill`): an inverted `#ededed` pill with `#0a0a0a` text and a `kbd` key hint. It appears only in the first mockup.
- **Skip link**: a white label with an 8px radius, shown on focus.

### App

- **Primary** (`.btn`): a pill, `--ac` fill, `--on-ac` text, 600, min height 44px. Hover darkens to 88% `--ac` and adds `--glow-accent`. Press scales to 0.96.
- **Ghost** (`.pill`): a pill with a 60% `--code` fill, 1px `--line`, 600. Hover strengthens the edge, and press scales to 0.97.
- **Answer option** (`.opt`): a 12px glass tile. Hover lifts 2px. Correct tints `--ok`, wrong tints `--bad` and shakes once.
- **Track** (`.track`): a 1px `--line` pill on `--track`, filled with `bg-blue` or `bg-green`.
- **Focus**: 2px `--focus`, 2px offset.

## Layout

### Landing

- Column width is 1080px with 24px gutters (16px under 860px). The screenshot frame is 1120px.
- **Nav**: logo (a 24px blue monogram, an inline three-path SVG in Landing.tsx, then the wordmark) on the left, and Changelog plus a filled blue "Sign in" pill on the right (white text, weight 800, `--ac` background). It is not sticky.
- **Logo colours**: `#039FF4`, `#028DF1` and `#4FBCF7` are fixed SVG fills, not tokens. The list under Fixed colours covers the rest.
- **Hero**: centred copy (88px top and 80px bottom padding), a two-sentence headline, the lead, the primary pill, a "See how it works" link, then the real editor screenshot. Six tilted tiles float in a viewport-wide layer. Under 1000px they become a static row of 42px tiles above the copy. Under 700px the screenshot is cropped to 5:4 around the code.
- **Feature rows** (`.lp-feat`): a 2-column grid, `1.05fr / 1fr`, with an 80px gap, vertically centred and 112px apart (96px after the hero). `.is-flip` puts the mockup on the right. Each row has a mockup, an h2, a lede and a 3 to 4 item checklist with green ticks. The five rows are Guess, Replay, Hints, Mastery and Topic.
- **Phone (under 860px)**: one column. The order is headline, lede, mockup, then checklist (`.lp-text` is `display: contents`).
- **Close**: a centred h2 ("What does the next line do?") and the primary pill. No card, no glow.
- **Footer**: the logo, the audience line and Changelog, above a 1px top ring.
- **Feedback form**: shares the landing nav and black canvas. A single ringed card holds the form, with a blue primary button and a blue ring on the selected feedback category.

### App

- Page width 1152px (max-w-6xl) with 24px gutters (16px on a phone). `TopNav` is the shared bar on Home, Course and Explore.

## Motion

- **Landing**: transitions are 0.15s (background, box-shadow, transform). Easing is `--out: cubic-bezier(0.22, 1, 0.36, 1)`. Smooth scroll is on only when the user has not asked for reduced motion. The one loop is the hero tiles bobbing 10px over 7s (`lp-bob`). Tiles hold a static tilt of -10deg to +10deg. There are no entrance animations, word reveals or count-ups.
- **App**: `--out: cubic-bezier(0.2, 0.8, 0.2, 1)` and `--pop: cubic-bezier(0.34, 1.56, 0.64, 1)`. The shared keyframes (`shake`, `float`, `sketch`, `pop`, `hop`, `wiggle`, `slide-in`, `rise`, `ring`, `burst`, `loader-press`, `loader-dot`, `lq-blink`) travel no more than 14px and rotate no more than 2.5deg (`wiggle`). Window morphs take 0.26s.
- **Reduced motion**: the app turns off every animation and transition. The landing stops the tile bob and the button transitions, and the tiles stay visible.


## Voice

Short, direct and concrete, the way a knowledgeable peer speaks. Predict first, then watch. Hints never earn mastery, and the copy says so. Each recommendation gives its reason. Buttons name the action ("Start learning", "Lock in answer", "Build my path"). Mockup data is illustrative and labelled as an example in its alt text.

## Do and don't

- Do draw edges as 1px rings (`--ring` on the landing, 1px `--line` or `--glass-line` in the app).
- Do keep one accent per view, and use the gray steps for everything else.
- Do keep primary actions as pills: 48px on the landing, at least 44px in the app.
- Do use 600 weight with negative tracking for display type (-0.05em for the hero).
- Do keep the mockups honest: a real screenshot for the product, and labelled example data in the cards.
- Do test app screens in light and dark. The landing is dark only by design.
- Don't add gradients. The only ones allowed are the hero tile fill and the mastery sparkline's area fade.
- Don't add glass or backdrop blur to the landing.
- Don't use hard offset shadows, 3px ink outlines or the cream canvas.
- Don't hard-code a hex in a component when a token exists. Add a token and list it here.
- Don't mix landing tokens into app pages, or app tokens into `.lp`.
