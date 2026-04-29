# Ladder Round Timer — Design

## Background

Traditional Ladder rounds today have no timing mechanism. Officials running tournaments manually time each round, often with a phone stopwatch. Adding a built-in countdown that survives refreshes and visually expires when time's up makes the tool more self-contained for a real venue.

## Goals

1. Per-round countdown timer in Ladder mode with editable duration.
2. Pause / Resume / Reset controls during a round.
3. Visual-only expiry (timer turns red and pulses at zero) — no audio, no auto-actions.
4. Timer persists across page refresh; countdown remains accurate even if the tab was hidden or the laptop slept (uses wall-clock timestamps, not interval ticks).
5. Per-court "✓ Done" badge that appears next to the court label once a court has a valid winner (or Complete Game Early was clicked).

## Non-goals

- No round-robin support (ladder mode only for now).
- No auto-completing the round when the timer expires.
- No per-court timers — single shared round timer.
- No audio cues.
- No timer in the Ladder Setup card (the timer widget lives only on the active-round UI).

## UI

### Timer widget

Lives **inside the current round card**, visually next to the existing "Enter scores and click Complete Round" banner. Compact, single-row layout that wraps on narrow screens.

States:

| State | Visible elements | Notes |
|---|---|---|
| **Idle** | Label "Round Timer", `<input type="number">` minutes, **Start** button | Default value `10`. Range `1`-`60`. |
| **Running** | `MM:SS` countdown (large, monospace), **Pause** button, **Reset** button | Countdown text in `#a5b4fc` (purple). |
| **Paused** | `MM:SS` countdown (frozen), **Resume** button, **Reset** button | Countdown text in `#9ca3af` (gray) + small "(paused)" tag. |
| **Expired** | `0:00` in red with a pulse animation, **Reset** button | Same animation timing as the existing `pulse-dot` keyframe (~2s loop). |

The widget always shows; it just changes state. Tab order: minutes input → Start.

The minutes input is hidden in Running / Paused / Expired states. On Reset it returns and is pre-filled with the duration that was just used.

### Per-court "Done" badge

In the existing `renderLadderCurrentRound` markup, each court already has a label like `Court 9 (Top)`. Add a small inline badge after that label, only visible when the court is "done":

> `Court 9 (Top)` `✓ Done`

A court is "done" when:

- Both score inputs hold a valid pickleball result (one is `11`, the other `0`-`10`), OR
- The user clicked **Complete Game Early** (existing `dataset.earlyDone === 'true'`).

The existing `court-done` class on the court element already triggers an opacity fade (0.45) — keep that. The badge complements it for at-a-glance status while the timer is running.

## Behavior

### Lifecycle within a round

1. Round starts (via `ladderStart` for round 1, or after `ladderCompleteRound` for subsequent rounds). Timer state is **idle**, with the minutes input pre-filled with the previously used duration (default `10`).
2. User clicks **Start**. Timer transitions to **running**; we record `startedAt = Date.now()` and `durationSec = N * 60`.
3. User can click **Pause** at any time. Timer transitions to **paused**; we save `pausedRemaining` (computed: `durationSec - (Date.now() - startedAt) / 1000`, clamped to ≥ 0). `startedAt` is cleared.
4. User clicks **Resume**. Timer transitions to **running** with `durationSec = pausedRemaining`, `startedAt = Date.now()`, `pausedRemaining = null`.
5. User clicks **Reset** at any time. Timer transitions to **idle** with the input pre-filled with the most recent `durationSec / 60`.
6. When `Date.now() - startedAt >= durationSec * 1000` while running, transition to **expired**. The display tick stops at `0:00`. Round itself does NOT auto-complete.
7. User clicks **Complete Round** as today. Timer is reset to idle (with the duration prefilled) for the new round.

### Tick mechanism

A single `setInterval` (500 ms cadence) updates the displayed countdown when the timer is in **running** state. The interval handler:

- Reads `startedAt` and `durationSec` from `ladderState.roundTimer`.
- Computes `remainingSec = max(0, durationSec - (now - startedAt) / 1000)`.
- Updates the DOM text.
- If `remainingSec === 0`, transitions to expired (sets a flag, removes the running class, adds the expired class), saves state, stops the interval.

The interval is started/stopped lazily — we only run it when the timer is in **running** state. Pause / Reset / Expire all stop the interval. Resume re-creates it.

500 ms cadence is more than enough for visual smoothness on `MM:SS` display and avoids any risk of skipping a second.

### Persistence

The timer state lives in `ladderState.roundTimer`:

```js
roundTimer: {
  durationSec: 600,         // total countdown duration in seconds
  startedAt: null,          // ms-since-epoch when the current run started; null if not running
  pausedRemaining: null,    // remaining sec when paused; null otherwise
  expired: false,           // true once countdown reached zero (sticky until Reset/round change)
  lastDurationSec: 600,     // remembered for prefilling the input on the next round
}
```

The full `ladderState` is already saved to localStorage by `saveLadderState()`. No new persistence logic needed beyond serializing this object.

On `restoreLadderState`, after the rest of the ladder restores:

- If `roundTimer` is missing entirely (older saved blob from before this feature) → seed it with the defaults shown in **Initialization in `ladderStart`** below and render idle.
- If `expired === true` → render expired state (no interval).
- If `pausedRemaining !== null` → render paused state with that remaining time (no interval).
- If `startedAt !== null` → compute `remainingSec = durationSec - (Date.now() - startedAt) / 1000`. If `remainingSec <= 0`, set `expired = true`, persist, render expired. Otherwise re-start the interval and render running.
- Otherwise → render idle with the input prefilled to `lastDurationSec / 60`.

The four cases are mutually exclusive in practice (the four states), but the order above is the safe restore order to use. This means a sleeping laptop or a deliberate refresh both pick up exactly where the wall clock left them.

### Round transitions

In `ladderCompleteRound` (after the existing logic that records the round and increments `ladderState.round`):

```js
ladderState.roundTimer = {
  durationSec: ladderState.roundTimer.lastDurationSec,
  startedAt: null,
  pausedRemaining: null,
  expired: false,
  lastDurationSec: ladderState.roundTimer.lastDurationSec,
};
```

This re-arms the timer for the new round in idle state with the same duration as the last round.

### Initialization in `ladderStart`

When `ladderStart` builds the initial `ladderState`, set:

```js
roundTimer: {
  durationSec: 600,         // 10 minutes default
  startedAt: null,
  pausedRemaining: null,
  expired: false,
  lastDurationSec: 600,
},
```

### Setup-lock interaction

The setup lock added in the previous feature disables the upstream setup inputs but doesn't touch the in-round UI. The timer widget lives in the round, so it's unaffected — Pause/Resume/Reset always work during an active ladder.

## Validation

The minutes input clamps to `[1, 60]` via the HTML `min`/`max` attributes plus a JS guard at click time:

```js
const minutes = parseInt(input.value);
if (isNaN(minutes) || minutes < 1 || minutes > 60) return;
```

Invalid values just don't start the timer (the input gets a brief `input-error` class).

## Files touched

- `index.html` — no changes (the timer DOM is rendered by JS into the current round container).
- `js/ladder.js`
  - Initialize `ladderState.roundTimer` in `ladderStart`.
  - Reset `ladderState.roundTimer` between rounds in `ladderCompleteRound`.
  - Add `renderLadderRoundTimer()` to render the widget into the current round card.
  - Add `startLadderTimer()`, `pauseLadderTimer()`, `resumeLadderTimer()`, `resetLadderTimer()`, `expireLadderTimer()` handlers.
  - Add a single `lastTimerInterval` module-level reference to manage the `setInterval`.
  - Update `renderLadderCurrentRound` to include the timer slot and the per-court "✓ Done" badge.
  - Update `restoreLadderState` to re-start the interval if the restored timer was running.
- `css/styles.css` — styles for the timer widget (idle / running / paused / expired states), the expired pulse animation, and the per-court "Done" badge.

## Open questions resolved during brainstorming

- Scope: ladder only, shared round timer + per-court "Done" badge.
- Expiration: visual only (red + pulse). No sound, no auto-action.
- Configuration: minutes input on the round itself (no setup-card option). Default 10. Pause/Resume/Reset on the running timer.
- Persistence: survives refresh. Computed via wall-clock timestamps so backgrounded tabs / sleeping laptops are accurate.
