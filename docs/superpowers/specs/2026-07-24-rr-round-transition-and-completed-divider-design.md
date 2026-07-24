# Round Robin — Smooth Round Transition + Completed Divider — Design

## Background

v2.11.0 pins the current Round Robin round directly under the timer using CSS flex `order` (`css/styles.css:306-310`). It works, but completing a round is visually abrupt. Six things happen in the same frame when the last winner of a round is tapped:

1. The finished card loses `.current-round`, gains `.round-completed` — opacity 1 → 0.35, title struck through.
2. That card's `order` flips from `-1` to `1`, so it **teleports** from the top to the bottom.
3. The next round gains `.current-round`, teleports up, opacity 0.4 → 1.
4. The banner text swaps `Current Round: 4 of 10` → `5 of 10`.
5. The round timer resets to idle and re-renders.
6. `renderLeaderboard()` replaces the leaderboard's entire `innerHTML`.

`order` cannot produce smooth motion. Even where it interpolates, it steps between integers, so a card snaps between discrete flex positions rather than sliding. Real motion needs a mechanism that animates layout change.

Separately, the completed rounds sit at the bottom with no label, so there is nothing marking where the played rounds begin.

## Goals

1. Completing a round animates rather than snapping.
2. A labelled divider marks the start of the completed-rounds section, showing how many are done.
3. Respect `prefers-reduced-motion`.
4. Degrade to current behaviour on browsers without the View Transitions API.
5. Printed output unaffected.

## Non-goals

- **Not** calming the other five simultaneous changes. The user explicitly chose "cards slide" over "slide and calm the flashing", so the banner swap, timer reset, and leaderboard re-render stay exactly as they are.
- No collapsing or hiding of completed rounds behind a toggle. The divider labels them; it does not fold them.
- No change to Traditional Ladder mode.
- No change to the schedule's DOM order. Ordering stays CSS-only, so the accessibility tradeoff already documented in `2026-07-24-rr-current-round-pinning-design.md` is unchanged in kind.

## Approach: asymmetric motion

The two moving cards travel very different distances, and treating them identically would look worse than the current snap.

| Card | Distance | Treatment |
|---|---|---|
| Round becoming **current** | ~one card height (position 2 → 1) | Real positional morph, ~350ms eased. Reads as a genuine slide. |
| Round becoming **completed** | past every upcoming round to the bottom of the completed section — on a 10-round schedule, easily 2000px+ | Cross-fade: fade out at the old position, fade in at the new one. No travel. |

Rationale: View Transitions render the moving snapshot in a fixed-position overlay above the page. A 2000px morph in 350ms means the card visibly rockets down the page past all the other content — more distracting than the instant jump it replaces. Fading avoids that while still reading as "this moved away".

### Mechanism

Wrap **only the class-toggling loop** of `updateRoundStates()` (`js/schedule-ui.js:907`, the `for` loop that toggles `.round-completed` / `.current-round` / `.round-future` and the team winner/loser classes) in `document.startViewTransition()`.

Gate it on the current round having actually advanced. `updateRoundStates()` already computes this at `js/schedule-ui.js:887` for the timer reset; capture the comparison before `rrCurrentRound = currentRound` executes at line 891. So:

- Initial render, `restoreState()`, and score edits that do not change the current round → no animation, mutation runs directly.
- Round advances (forward or backward, since un-tapping a winner also moves the current round) → animate.

Each `.round` card carries `view-transition-name: rr-round-<N>`, set as an inline style when `renderSchedule` emits the card. Names must be unique per element and stable across the mutation for the browser to pair old and new snapshots.

The two participating cards get different animations via CSS on the generated pseudo-elements, keyed off which class the card ends up with. The completing card is the one that gains `.round-completed`; the arriving card is the one that gains `.current-round`.

The root snapshot's cross-fade is suppressed so the page does not flash-fade as a whole underneath the moving cards:

```css
::view-transition-old(root),
::view-transition-new(root) { animation: none; }
```

### Guards

- `if (!document.startViewTransition) { mutate(); return; }` — browsers without support get exactly today's instant behaviour. No polyfill.
- `@media (prefers-reduced-motion: reduce)` disables the view-transition animations. **The stylesheet currently has no reduced-motion support at all**, so this is the first instance; scope it to these new rules only rather than retrofitting the whole file.

## Completed-rounds divider

A `.rounds-divider` element emitted by `renderSchedule` immediately after the `#currentRoundBanner` line (`js/schedule-ui.js:1036`), styled to mirror `.current-round-banner` (`css/styles.css:257-262`) but muted and without the pulsing dot:

```
✓ Completed · 3 rounds
```

Ordering shifts to give it a slot. `order` accepts integers only, so there is no value between `0` and `1` — the completed rounds move down to make room:

| Element | order (before) | order (after) |
|---|---|---|
| `.schedule-header` | -3 | -3 |
| `#currentRoundBanner` | -2 | -2 |
| `.round.current-round` | -1 | -1 |
| upcoming rounds (default) | 0 | 0 |
| **`.rounds-divider`** | — | **1** |
| `.round.round-completed` | 1 | **2** |

Visibility is CSS, not JS bookkeeping. Both hide cases fall out of one rule: the divider shows only when there is at least one completed round **and** a current round still exists. "All rounds complete" is exactly the state where no card carries `.current-round`, so the second `:has()` covers it without any JS flag:

```css
#scheduleSection .rounds-divider { display: none; }
#scheduleSection:has(.round.round-completed):has(.round.current-round)
  .rounds-divider { display: flex; }
```

The count text is written by JS, since CSS cannot count matched elements. `updateRoundStates()` sets it alongside the existing banner update.

### When the divider hides

| Case | Behaviour | Why |
|---|---|---|
| No rounds complete | No `.round-completed` exists, so the first `:has()` fails | Nothing to separate. |
| All rounds complete | No `.current-round` exists, so the second `:has()` fails | The main banner already reads "All N rounds complete"; a "Completed · N rounds" header directly beneath it is pure redundancy. |
| Print / PDF export | Hidden in `@media print` | Print sets `#scheduleSection { display: block }`, making `order` inert, so rounds print numerically 1..N. A divider sitting at its DOM position would then be actively misleading. |
| Schedule retired | N/A | `retireSchedule()` empties `#scheduleSection`. |

## Edge cases

| Case | Behaviour |
|---|---|
| Un-tapping a winner (round moves backward) | Current round changes, so the transition fires. A card leaves `.round-completed` and returns to the upcoming block. Cross-fade applies in reverse. |
| Round completed out of numeric order | Pre-existing quirk, unchanged: such a card gets both `.round-completed` and `.round-future` and is frozen by `pointer-events: none`. It sinks below the divider like any completed round. This design neither fixes nor worsens it. |
| Rapid taps mid-transition | `startViewTransition` skips/finishes any in-flight transition when a new one starts. The mutation callback always runs, so state never diverges from the DOM. |
| Single-round schedule | Completing it means all rounds complete → divider hidden, no reorder to animate. |
| `view-transition-name` collision | Names are `rr-round-<N>` and N is unique per schedule. The Ladder never renders into `#scheduleSection`, so no cross-mode collision. |

## Testing

Extend the existing headless-Chrome-over-CDP harness (Node's built-in global `WebSocket`, no npm packages):

1. Divider `y` sits between the last upcoming card and the first completed card when some rounds are done.
2. Divider absent at zero-complete.
3. Divider absent at all-complete.
4. Divider absent under `Emulation.setEmulatedMedia({ media: 'print' })`.
5. Divider count text matches the number of completed rounds.
6. Existing v2.11.0 ordering assertions still pass with completed rounds at `order: 2`.
7. With `Emulation.setEmulatedMedia({ features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })`, confirm the transition does not animate.

**Animation feel cannot be asserted from a static measurement.** Verify by eye: serve locally, complete a round, and watch it. The 350ms duration and easing are judgment calls to tune while looking at the real thing, not values to fix from a spec. This is an explicit step, not an afterthought.

## Alternatives considered

**FLIP (measure, invert with transforms, play).** Works in every browser and gives full control. Rejected as materially more code — manual before/after measurement of every card plus transform bookkeeping — for a result the View Transitions API produces declaratively, on a project whose whole idiom is vanilla with no build step.

**Symmetric motion, both cards genuinely sliding.** Simplest to describe and what "smooth reorder" naively implies. Rejected because of the 2000px+ travel on the completing card; flagged to the user, who agreed to the asymmetric treatment.

**Animating `order` directly.** Not viable. Even where it interpolates, it steps between integers, so the card snaps between discrete flex positions.

**Deferring the reorder** until the user scrolls or after a delay, so nothing moves under their finger. Rejected: it adds timing state, and the user asked for the movement to be smooth rather than postponed.
