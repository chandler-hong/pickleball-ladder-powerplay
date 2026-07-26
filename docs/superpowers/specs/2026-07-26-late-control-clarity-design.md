# Late-Arrival Control — Clarity and Visibility — Design

## Background

v2.13.0 added the late-arrival feature: each player row carries a control that marks someone as joining from a later round. It works, but it is close to undiscoverable.

Measured on the live page at 1100px:

| | Current |
|---|---|
| Icon | `⏱` at **12.8px** |
| Colour | `#5A5F72` on the card |
| Contrast | **2.83:1** — below WCAG's 3:1 minimum for UI components |
| Control size | 23 × 23px |
| Explanation | a `title` tooltip, and nothing else |

Next to the bright M/F toggle it reads as a smudge. The `title` attribute does not exist on touch, so on a phone there is no way to discover what the control does short of tapping it. Nothing anywhere on the page says the feature exists.

A third problem surfaced while measuring. The control is a visually-hidden checkbox driven by a `<label>`. The checkbox **is** keyboard-focusable — `tabIndex` 0, and `.focus()` succeeds — but `css/styles.css` contains no `:focus` or `:focus-visible` rule for it. A keyboard user can tab onto it and toggle it with Space while seeing no indication of focus at all.

## Goals

1. The control is legible at a glance, at the same visual weight as the M/F toggle beside it.
2. A first-time user can tell what it does without hovering, tapping, or guessing.
3. Keyboard focus is visible.
4. No change to behaviour — this is presentational only.

## Non-goals

- No change to `js/schedule.js` or any scheduling logic.
- No change to what the control does, what it persists, or how it validates.
- No change to Traditional Ladder mode.
- No new icon library or dependency. The project is vanilla with no build step.

## Approach

### 1. Labelled chip

Replace the bare icon with `⏱ Late`. The word carries the meaning so the glyph no longer has to, which fixes discoverability and legibility in one move. Ticking still reveals the round-number input beside it, and the ticked state keeps its gold treatment.

### 2. Contrast

The unticked chip must clear **4.5:1** against the card background — comfortably above the 3:1 UI-component floor, so it sits at the same perceived weight as the M/F toggle rather than receding behind it. Give it a visible border in the unticked state so it reads as a button rather than as decoration. The exact colour is chosen to hit the ratio and must be **measured, not assumed** — see Verification.

### 3. Icon size

Up from 12.8px so the glyph resolves rather than smudging. It should not exceed the chip's text size by enough to unbalance the pill.

### 4. Hint line

A line under the Players card heading:

> Tap ⏱ Late for anyone arriving after the start, then set the round they join.

Style it after the existing `.ladder-assignment-hint` (`css/styles.css`) for visual consistency, with one deliberate difference: that rule is `display: none` by default and only revealed inside the `@media (max-width: 640px)` block, because on the Ladder the drag interaction is discoverable on desktop and not on touch. Here the problem exists at every width, so **this hint is always visible**.

### 5. Focus ring

Add `.late-check:focus-visible + .late-label` styling, matching the focus treatment the other inputs in this file already use. `:focus-visible` rather than `:focus` so a mouse click does not leave a ring behind.

### 6. Mobile

Allow `.player-input` to wrap so the chip drops onto its own line on very narrow screens instead of crushing the name field, and give the label a 44px tap target inside the `@media (max-width: 640px)` block — the convention this codebase already applies to other mobile controls.

## The width tradeoff

The name input is `flex: 1`, so it absorbs whatever the chip takes. Measured widths per player row today:

| Viewport | Row | Name input | Gender toggle | Late control | Slack |
|---|---|---|---|---|---|
| 1100px | 308px | 179px | 58px | 23px | 24px |
| 900px | 258px | 129px | 58px | 23px | 24px |
| 390px | 324px | 152px | 101px | 23px | 24px |

The chip adds roughly 35px, all of which comes out of the name input: **179 → ~144px** at desktop, **152 → ~117px** at mobile, and **129 → ~94px at 900px**, which is the pinch point. At ~94px a long name such as "Kevin Savage" will scroll within the field sooner than it does today.

This was raised with the user explicitly and accepted, with the expand-on-tick variant named as the fallback if 94px proves too tight in practice. The wrap rule in item 6 is the relief valve.

## Edge cases

| Case | Behaviour |
|---|---|
| 40-player grid | Every row gains the chip; the grid is already 3-column and scrolls, so only per-row width changes. |
| Ticked state | Chip turns gold and the round input appears beside it, exactly as now. |
| Light theme | Both chip states need their own contrast check; the existing `[data-theme="light"]` rules for `.late-label` and `.join-round-input` must be updated to match. |
| Print | The chip is setup UI and lives outside the printed schedule; no print rule needed. |
| Long names at 900px | Accepted, above. |

## Verification

No unit tests — this is presentational, and `npm test` must simply stay green at `4477 / 89 / 40`.

Verify in headless Chrome over CDP, as with previous layout work in this repo:

1. **Measure the computed contrast ratio** of the unticked chip against its background and assert it clears 4.5:1. Do not eyeball this — the current 2.83:1 looked acceptable to the eye and was not.
2. Repeat that measurement in the light theme.
3. Measure the name input's actual width at 1100, 900 and 390px and confirm it matches the projection above, so the tradeoff is the one that was agreed rather than a worse one.
4. Confirm the hint line is visible at all three widths, not just mobile.
5. Tab to the control and confirm a visible focus ring; click it and confirm no lingering ring.
6. Confirm the ticked state still reveals the round input and still reads gold.
7. Screenshots at all three widths, before and after, for review.

## Alternatives considered

**Brighter icon plus hint line, no label.** Keeps the name input at full width, which matters most at 900px. Rejected by the user in favour of the label: a word is self-explanatory in a way an icon is not, and the hint line alone still leaves the control itself ambiguous once the user has scrolled past the hint.

**Chip that expands only when ticked** — icon-only until used, then widening to "Late from R3". Costs no width in the common case. Rejected as the primary approach because the unticked state is exactly the state a first-time user meets, so it is the one that most needs to explain itself. Retained as the fallback if 94px proves too tight.

**Dropping the emoji and using text alone.** Cleanest rendering, since emoji are inconsistent across platforms at small sizes. Rejected because the user explicitly asked for the clock to be clearer, not removed.
