---
version: alpha
name: LearnQuest-design
description: A playful, sticker-style design system for learning code. Cream canvas (`#FFF4E0`) on a dot grid, ink (`#15121F`) outlines on every shape, hard offset shadows with no blur, flat bright fills. Pip, the mint sprout mascot, appears in every illustration. Lilita One for display, DM Sans for body, system monospace for code.

colors:
  ink: "#15121F"
  paper: "#FFF4E0"
  dot: "#EBDCBD"
  white: "#FFFFFF"
  sun: "#FFD23F"
  pink: "#FF7AB6"
  lilac: "#B9A6FF"
  mint: "#5EE6B0"
  blue: "#2257FF"
  flame: "#FF6A1F"
  sprout: "#3FD69B"
  track: "#F1E6CF"
  muted: "#4A4458"

typography:
  display:
    fontFamily: "'Lilita One', ui-rounded, system-ui, sans-serif"
    fontWeight: 400
  body:
    fontFamily: "'DM Sans', system-ui, sans-serif"
    fontWeight: 400 / 500 / 700
  code:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontWeight: 500

rounded:
  card: 1.5rem
  button: 0.875rem
  field: 1rem
  sticker: 0.5rem
  pill: 9999px

borders:
  control: 3px solid ink
  sticker: 2.5px solid ink
  dashed: 3px dashed ink

shadows:
  chunk: "5px 5px 0 ink"
  lip: "4px 4px 0 ink"
  pill: "3px 3px 0 ink"
  sticker: "2px 2px 0 ink"
---

# LearnQuest Design System

Visual spec for this revision: the Design artifact `d3d3f532-517a-44bb-85c9-0c2d43642bef`, screens Main, Desktop-New, Phone-Returning, Phone-New, Generator-States and Empty-States. The implementation in [apps/web/src/index.css](apps/web/src/index.css) still uses the previous palette and fonts (Fraunces, Nunito) and does not match this spec yet.

## Principles

- **Sticker, not screen.** Every shape has a thick ink outline, rounded corners and a hard offset shadow. No blur and no soft shadows.
- **Flat fills, from the palette only.** The only pattern fills are the page dot grid, the meter stripes, and the League rays and locked stripes.
- **Pressable.** Buttons and cards lift on hover and sink on press.
- **Bouncy.** Motion overshoots. No linear fades.
- **Pip is the guide.** One mascot, same style everywhere.

## Colors

| Token | Hex | Use |
|---|---|---|
| ink | `#15121F` | text, every outline, every hard shadow |
| paper | `#FFF4E0` | page background |
| dot | `#EBDCBD` | 22px dot grid on the page (20px on phone) |
| white | `#FFFFFF` | cards, inputs, chips, pills, course tiles, day dots |
| sun | `#FFD23F` | generator button, AI and OFFICIAL stickers, streak card, Now tile, Continue meter, unlock card |
| pink | `#FF7AB6` | Continue hero, HOT and NOW stickers, error icon, streak number shadow |
| lilac | `#B9A6FF` | Community label and cards, locked league, React path badge, not-started course meter |
| mint | `#5EE6B0` | Pip body, done course tiles, daily goal meter, 2 ACTIVE sticker |
| blue | `#2257FF` | generator card, logo, Try the generator button, links, focus ring, done course meter |
| flame | `#FF6A1F` | streak flame, completed days, Pip beak |
| sprout | `#3FD69B` | Pip leaves and wing |
| track | `#F1E6CF` | meter track |
| muted | `#4A4458` | secondary text such as taglines and empty-state copy |

Other tints appear once or twice in the artifact. They are not tokens: `#FFD9E9` (error message), `#D9FFEF` (success message and Pip belly), `#E9E3F7` (disabled chip), `#FFE88F` (disabled button, Generator-States), `#E4D9C4` (empty streak flame), `#9CC2FF` (Pip sparkle), `#1238B8` (link hover).

### Night theme

The artifact has a `night` class. It swaps these values:

| Token | Night value |
|---|---|
| paper | `#0D0A1C` |
| dot | `#231B44` |
| white (card surface) | `#1A1433` |
| ink (text and outlines) | `#F6F0FF` |
| on-blue (text on blue) | `#0D0A1C` |
| shadow (hard shadows) | `#FF3FA4` |
| blue | `#5B8CFF` |
| sun | `#FFE04A` |
| pink | `#FF6FB5` |
| lilac | `#A58BFF` |
| mint | `#3DF5B5` |
| track | `#2C2452` |
| muted | `#CFC4F2` |
| focus | `#3DF5B5` |

## Typography

- **Display** (headings, buttons, stickers, big numbers): Lilita One, weight 400 only, line height 1.05. Section titles are 36px (28px on phone). The hero title is 62px (44px on phone). The generator label is 30px to 38px. The streak number is 92px (54px on phone).
- **Body and UI**: DM Sans. 400 for paragraphs, 500 for input text and helper copy, 700 for chips, tags, labels and meta lines. Base size 16px, line height 1.45. Button labels use the display font.
- **Code**: system monospace, 500, 15px, line height 1.7, on an ink panel. Keywords are pink, functions mint, numbers sun, comments lilac.

## Shape and elevation

| Class | Spec | Use |
|---|---|---|
| `.card` | white or one palette fill, 3px ink border, 24px radius (22px on phone), 5px 5px 0 ink shadow (4px on phone) | stat cards, generator, hero, path cards, community cards |
| `.btn` | inline-flex, min-height 48px, padding 0 22px, Lilita One 19px, 3px ink border, 14px radius, 4px 4px 0 ink shadow | every button |
| `.btn-sun` | sun fill, ink text | generator submit |
| `.btn-ink` | ink fill, sun text | Continue, Retry, Enter league, Start |
| `.btn-blue` | blue fill, white text | Try the generator (empty state) |
| `.btn-surface` | white fill, ink text | Join, Start on course cards |
| `.chip` | pill, 2.5px ink border, white fill, DM Sans 700 15px, 3px ink shadow, min-height 44px | quick picks |
| `.pill` | pill, 3px ink border, white fill, 3px ink shadow, min-height 44px | streak and XP counters in the top bar |
| `.sticker` | Lilita One 13px (12px on phone), 2.5px ink border, 8px radius, 2px ink shadow, tilted by the tilt variable | short labels: AI, HOT, NEW, OFFICIAL, SHARED, LOCKED |
| `.tag` | pill, white fill, 2.5px ink border, DM Sans 700 14px | course label in the hero |
| `.meter` | pill track, 3px ink border, `#F1E6CF` fill, 18px to 26px tall, colored fill with 8px diagonal stripes | progress, daily goal, league |
| `.tile` | white card, 3px ink border, 18px radius (16px on phone), 4px 4px 0 ink shadow, 206px wide (176px on phone) | course tiles in Your paths |
| `.msg` | 3px ink border, 14px radius, 3px 3px 0 ink shadow, DM Sans 700 16px | status lines under the generator |
| `.code` | ink fill, 3px ink border, 20px radius, offset white and ink shadow | predict panel in the hero |

Press behavior: a button lifts 2px left and 3px up on hover, and its shadow grows to 6px 7px. On press it moves 3px down and right, and the shadow drops to 1px. Cards with `.lift` move 3px left and 5px up on hover. On phone, cards only sink on press. Chips lift 3px and tilt on hover.

## Component rules

- **Sticker borders.** Stickers have a 2.5px ink border and an 8px radius. They tilt. Keep them to a few words, such as AI, HOT, NEW or LOCKED.
- **Hard shadows.** Each size has one offset shadow with no blur: cards 5px (4px on phone), buttons 4px, chips, pills and messages 3px, stickers 2px. In night mode the shadow is pink.
- **Buttons.** Use `.btn-sun` for the generator submit. Use `.btn-ink` for the main action of a state (Continue, Retry, Enter league, Start). Use `.btn-surface` for list actions (Join, Start). Use `.btn-blue` for the empty-state call to action. A disabled button shows a progress cursor.
- **Cards.** Cards have a 3px ink border and one fill each: white or one palette color. A card may tilt up to 2.4 degrees. Empty states use a dashed 3px border on a white card.
- **Pills and chips.** Use `.pill` for counters in the top bar. Use `.chip` for choices the learner taps, such as quick picks. Use `.tag` for a course label.
- **Focus.** Focus shows a 3px outline with a 3px offset. The outline is blue, or sun on blue cards.

## Home screen layout

### Desktop

- **Top bar.** Logo at the left: a blue square mark and the wordmark, with a sun "Quest" tag. Streak and XP pills at the right. The page is 1360px wide with 40px side padding.
- **Two columns.** The main column is at least 620px and grows. The sidebar is 330px. The columns have a 36px gap. Main column sections are 44px apart. Sidebar cards are 28px apart.
- **Main column, returning learner:** generator, Continue hero, Your paths, Community. The hero is a pink card with the course tag, title, level badge, lesson meter, a large ink Continue button, and a predict code panel on the right.
- **Main column, new learner:** generator (with a START HERE sticker), Start a path, Community. There is no hero.
- **Start a path.** A tall sun feature card (Python Quest) on the left, with a code preview. Two cards sit at the top right. SQL Detective spans the bottom right.
- **Sidebar:** Streak (sun), Daily goal (white), Leagues (locked).
- **Your paths.** One card per path, with a badge, title, tagline and a horizontal track of five course tiles joined by a dashed line.
- **Community.** Four cards in one row, each with a palette fill.

### Phone (390px)

- One column, 480px maximum width, 16px side padding, 28px between sections.
- Top bar: logo 34px, streak and XP pills.
- **Returning learner:** stats (streak full width, daily goal, leagues), generator, Continue hero with a full-width button, Your paths, Community in two columns.
- **New learner:** stats (streak full width, daily goal, locked leagues), generator, Start a path stacked in one column, then an empty Community card.
- Course tracks scroll sideways with snap points. The scrollbar is hidden.

## States

### Generator

- **Idle.** Pip waves. Generate is enabled.
- **Loading.** Generate is disabled and shows a 22px spinner. The status line is a white message with a sketched line, the text "Pip is sketching your path", and three blinking dots. Pip shows its think pose. The Generator-States file adds four dashed ghost slots that pulse in turn. The home demo resolves after 2.2 seconds.
- **Error.** A pink message with a pink alert icon: "Oops, Pip dropped the pencil. We couldn't generate that path. Check your connection and try again." A Retry button (`.btn-ink`, 44px tall) sits inside the message. The message shakes once. Pip shows its oops pose.
- **Empty input.** A pink message: "Type what you want to learn first, or tap a quick pick." It shakes once. Pip shows its oops pose.
- **Done.** A mint message with a NEW sticker: "Your path is ready. Find it in Your paths below."

### Empty states

- **No official paths.** A dashed card with Pip (150px), the heading "No official paths here yet.", and muted copy: "Pip is still drawing them up. Tell the generator what you want to learn and get a path of your own right now." The card has an OFFICIAL sticker above it and a Try the generator button.
- **No shared paths.** A dashed card with Pip holding a sheet of paper, the heading "No shared paths yet.", and copy: "Pip is waiting for the first one. Make a path and share it, and it shows up here for everyone." The phone copy is shorter. A lilac SHARED sticker sits above it.

### League unlock

- A sun card, 380px wide on the 1100px reference, tilted 1.4 degrees. It has an UNLOCKED sticker (white) and a NEW sticker (pink, tilted).
- A 130px trophy pops in. White rays turn behind it. Four confetti pieces fall in a loop.
- Heading "Leagues" at 40px. Copy: "You hit 500 XP. Welcome to the league."
- A full striped meter reads "500 / 500 XP".
- An "Enter league" button (`.btn-ink`).

### League locked

- A striped, lilac-tinted card with a LOCKED sticker and a grayscale trophy at 55% opacity.
- Copy: "Unlocks at 500 XP". A lilac meter shows the current XP.
- Desktop shows the XP left to go (for example "80 XP to go", or "500 XP to go" at zero). Phone shows "420 / 500 XP" only.

## Motion

- Timing: fast 120ms, medium 240ms, slow 560ms. Entrance cards stagger by 70ms.
- Easing: bounce `cubic-bezier(.34,1.56,.64,1)`, ease-out `cubic-bezier(.2,.8,.2,1)`.
- Keyframes used in the artifact: `rise` (entrance), `pop` (trophy), `stamp` (completed tile badge), `shake` (errors, 420ms), `bob` (Pip float, 3.2s), `wave` (Pip wing, 2.2s), `flicker` (streak flame), `spin` (loader, 900ms), `draw` (sketched lines), `blink` (loading dots), `pulse` (ghost slots), `stripes` (meter fill), `twinkle` (done sparkle), `fall` (confetti), `turn` (League rays), `fly` and `xpop` (Continue burst and "+10 XP").
- Reduced motion. Under `prefers-reduced-motion: reduce`, or the `calm` class, animations run once at 1ms, the tilt is 0, and bursts are hidden.

## Illustration (Pip)

- Pip is a mint sprout drawn in flat SVG with an ink outline. It has a mint body (`#5EE6B0`), a sun sprout (`#FFD23F`), sprout-green leaves (`#3FD69B`), a pale belly (`#D9FFEF`) and a flame beak (`#FF6A1F`). The outline is 4 units on a 120-unit viewBox.
- Poses in the artifact: wave (idle and done), think (loading), oops (error and empty input). The empty-state cards use a sketch pose with a sheet of paper.
- Pip has no offset shadow and no text in the artifact.
- Pip floats at every size. Its wing waves in the wave pose.
- Pip peeks over the top edge of the hero and the feature cards. The card clips the peek.
- Sizes: 220px to 250px in the desktop generator, 130px in the phone generator, 104px for the desktop peek, 84px for the phone peek, 150px in the empty state.

Generate every illustration with this prompt prefix, then add the scene:

> Flat vector sticker illustration, playful and chunky. Thick uniform near-black outline (#15121F) on every shape, rounded corners and round line caps, no gradients, no textures, no soft shadows. Flat fills from this palette only: sun yellow #FFD23F, pink #FF7AB6, lilac #B9A6FF, mint #5EE6B0, sprout #3FD69B, blue #2257FF, flame #FF6A1F, warm cream #FFF4E0. Friendly, bouncy, slightly squashed proportions, like a modern kids' learning app. Transparent background. No text or letters unless I specify. No watermark.

Assets live in `apps/web/public/img/` (`pip-wave`, `pip-think`, `pip-cheer`, `pip-oops`, `pip-sheet`, plus scene art for predict, hint, reveal, adapt, mastery, finale). Transparent PNG, no baked-in text.

## Voice

Short, friendly, concrete. Predict first, then watch. Never claim hints earn mastery. Each recommendation states its reason.

## Do and don't

- Do put an ink outline and a hard shadow on every new component.
- Do reuse `.card`, `.btn`, `.pill`, `.chip`, `.sticker`, `.meter` and `.tile` before inventing styles.
- Don't add colors outside the tables above.
- Don't add gradients beyond the dot grid, meter stripes, League rays and locked stripes.
- Don't use blurred shadows, or outlines under 2.5px.
- Don't put text inside generated illustrations.
