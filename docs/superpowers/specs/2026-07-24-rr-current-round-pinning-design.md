# Round Robin — Pin Current Round To Top — Design

## Background

In Round Robin mode the schedule renders rounds 1..N top to bottom, with the round timer in `#currentRoundBanner` above them. By round 10 of 10 the timer is far off screen, so anyone running the event has to scroll to the top to start, pause, or reset it, then scroll back down to find the round they are actually playing.

This is already solved on narrow screens. `css/styles.css` (added in v2.9.2, commit `422ad99`) carries these rules inside `@media (max-width: 640px)`:

```css
/* Pin the current round to the top (right under the timer) so people on a
   later round don't have to scroll. Order-only; DOM/tab order is unchanged. */
#scheduleSection { display: flex; flex-direction: column; }
#scheduleSection .schedule-header { order: -3; }
#scheduleSection #currentRoundBanner { order: -2; }
#scheduleSection .round.current-round { order: -1; }
```

Desktop never got the same treatment. This design extends it to all viewport widths and adds an ordering refinement for played rounds.

## Goals

1. The current round is always visually adjacent to the timer, at every viewport width.
2. Rounds still to be played come next, in numeric order.
3. Completed rounds sink to the bottom so they do not occupy the screen.
4. Printed / exported PDF schedules keep strict numeric order 1..N.
5. No JavaScript changes.

## Non-goals

- No change to Traditional Ladder mode. It renders one current-round card plus a separate history section, so it does not have this problem.
- No collapsing or hiding of completed rounds behind a toggle. They stay visible, dimmed, at the bottom.
- No auto-scrolling when the round advances. Pinning removes the need.
- No sticky/floating timer. Considered and rejected; see Alternatives.
- No DOM reordering in JavaScript. See Accessibility.

## Approach

Pure CSS. `updateRoundStates()` (`js/schedule-ui.js:911-914`) already toggles `.current-round`, `.round-completed`, and `.round-future` on every state change, so the browser re-flows the pinned card with no extra wiring.

### Changes, all in `css/styles.css`

1. **Promote** the four rules quoted above out of `@media (max-width: 640px)` into the base stylesheet, comment included. `#scheduleSection { display: flex; flex-direction: column; }` is what makes `order` apply at all — without it the `order` declarations are inert.
2. **Add** `#scheduleSection .round.round-completed { order: 1; }`. Played rounds sort below upcoming ones. Future rounds keep the default `order: 0` and so stay numeric in the middle.
3. **Delete** the promoted copies from the `@media (max-width: 640px)` block. Base rules already cover narrow screens, and leaving duplicates invites the two from drifting apart.
4. **Reset** ordering inside `@media print`:
   ```css
   #scheduleSection .round.current-round,
   #scheduleSection .round.round-completed { order: 0; }
   ```
   A printed handout is a reference document; it should not shuffle based on which round happened to be current at export time. Note the print block already sets `#output { display: flex }` with `#leaderboardSection { order: -1 }` and `#scheduleSection { order: 1 }` — that orders siblings *within* `#output` and is unaffected by this change.

### Resulting visual order

```
Schedule header
Current-round banner (timer)
Round 4      <- current, pinned, indigo border
Round 5      <- upcoming, dimmed 0.4, pointer-events: none
Round 6
...
Round 10
Round 1      <- completed, dimmed 0.35, strikethrough title
Round 2
Round 3
```

## Edge cases

| Case | Behaviour |
|---|---|
| All rounds complete | `currentRound` is `null`, so no card gets `.current-round`. Every card gets `order: 1`, all equal, so they fall back to numeric DOM order. |
| Round 1 is current | Already at the top. No visible change; no completed rounds exist yet. |
| Card both pinned and sunk | Impossible. `currentRound` is the *first incomplete* round, so `.current-round` and `.round-completed` are mutually exclusive by construction. |
| Schedule retired mid-setup | `retireSchedule()` empties `#scheduleSection`, so there are no children to order. |
| Single-round schedule | One card, pinned, nothing below. |

## Accessibility

`order` changes visual order only. DOM order — and therefore tab order and screen-reader reading order — stays numeric 1..N. A keyboard user tabbing forward reaches round 1's controls before the pinned current round.

This is the known caveat of flex `order` and is inherited from the existing v2.9.2 mobile rule, whose comment already records it. That inherited caveat was scoped to narrow screens, where a single card moved up; here the visual/DOM divergence extends to every viewport width, including desktop, and its magnitude is larger — up to N-1 completed rounds can move below the upcoming ones rather than just one card shifting. With rounds 1-9 of 10 complete, for instance, tabbing forward from the timer lands in round 1's team buttons at the very bottom of the page, with no surrounding focus context. Accepted deliberately: reordering the DOM in JavaScript would mean `renderSchedule` emitting rounds in a state-dependent sequence, which fights the substitution and score-entry re-render paths that address cards by `id="round-N"`. The cost of the CSS approach is bounded and documented; the cost of the JS approach is spread across code that currently works.

## Testing

No unit tests — this is layout, and the repo has no DOM test harness.

Verify with the headless-Chrome-over-CDP harness used for the v2.10.1 layout fix (launch Chrome with `--remote-debugging-port`, drive it from Node using the built-in global `WebSocket`):

1. Generate 16 players / 3 courts / 10 rounds.
2. Assert by measured `getBoundingClientRect().y` that, at a fresh schedule, the round-1 card sits directly below `#currentRoundBanner`.
3. Drive rounds 1-3 to completion so round 4 becomes current. Assert the round-4 card is directly below the banner, that rounds 5-10 follow in ascending `y`, and that rounds 1-3 have the largest `y` values.
4. Complete every round. Assert cards are back in numeric `y` order.
5. Repeat step 3 at a 390px viewport to confirm the promoted rules match previous mobile behaviour.
6. `Emulation.setEmulatedMedia({ media: 'print' })` and assert numeric `y` order is restored.
7. Capture screenshots at desktop and mobile for review.

## Alternatives considered

**Sticky timer bar** (`position: sticky; top: 0` on `#currentRoundBanner`). Solves timer reachability without ever showing rounds out of sequence. Rejected because you still scroll to find the round you are playing, and it would overlay content on short viewports. Rejected by the user in favour of pinning.

**Pinned current round, everything else strictly numeric.** What the existing mobile rule does today, and zero new rules. Rejected because on round 10 the screen below the pinned card fills with nine dimmed completed rounds.

**Collapse completed rounds behind a "show played rounds" toggle.** Shortest page, but adds UI, state, and a persistence question for a problem that ordering already solves.
