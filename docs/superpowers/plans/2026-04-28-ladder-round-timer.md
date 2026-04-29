# Ladder Round Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-round countdown timer to Traditional Ladder mode with editable minutes (default 10), Pause/Resume/Reset, visual-only expiry, refresh-survivable wall-clock persistence, and a per-court "✓ Done" badge.

**Architecture:** All timer state lives in a new `ladderState.roundTimer` object (durationSec, startedAt, pausedRemaining, expired, lastDurationSec). A single module-level `setInterval` ticks at 500 ms cadence only while the timer is running and updates the displayed `MM:SS` from the wall-clock delta. Pause/Resume re-arms the interval; Reset returns to idle; expiry shows `0:00` in red with a pulse. Persistence is automatic via the existing `saveLadderState()` because `roundTimer` lives inside `ladderState`.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step, no external libraries. Native `setInterval` for ticking.

**Testing note:** The repo's automated test harness (`npm test`) covers Round Robin scheduling only. Per the design spec, this change adds no automated tests. Each task ends with explicit **manual verification** steps in the browser. Frequent small commits keep each step independently revertible.

**Spec reference:** `docs/superpowers/specs/2026-04-28-ladder-round-timer-design.md`

---

## File Structure

| File | Role |
|---|---|
| `js/ladder.js` | All timer logic. `ladderState.roundTimer` lifecycle (init, between rounds, on restore), `renderLadderRoundTimer()`, button handlers, `setInterval` management, expiry detection. Also gets the per-court "Done" badge inside `renderLadderCurrentRound`. |
| `css/styles.css` | Styling for the four timer states (idle / running / paused / expired) plus the expired pulse animation; per-court "Done" badge style. |
| `index.html` | No changes. The timer DOM is rendered by JS into the current round card. |
| `README.md` | One-bullet update under "Traditional Ladder Mode" mentioning the timer. |
| `package.json` | Version bump. |

---

## Task 1: Initialize `roundTimer` in `ladderState` lifecycle

Adds the `roundTimer` field to the in-memory `ladderState` object and resets it between rounds. Pure data-model change. No UI, no behavior visible yet.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add a small helper to mint a fresh idle timer state**

Add this helper near the top of `js/ladder.js`, just below the existing `getLadderPlayerCount()` helper:

```js
function newRoundTimerState(lastDurationSec) {
  return {
    durationSec: lastDurationSec,
    startedAt: null,
    pausedRemaining: null,
    expired: false,
    lastDurationSec,
  };
}
```

- [ ] **Step 2: Initialize `roundTimer` in `ladderStart`**

Find `ladderStart` in `js/ladder.js`. Inside the `ladderState = { ... }` object literal, add `roundTimer: newRoundTimerState(600),` as a new property (after `playerLosses`):

```js
ladderState = {
  round: 1,
  names,
  genders,
  preferMixed,
  courtPlayers,
  courtTeams,
  partnerHistory,
  rounds: [],
  playerWins: new Array(getLadderPlayerCount()).fill(0),
  playerLosses: new Array(getLadderPlayerCount()).fill(0),
  roundTimer: newRoundTimerState(600),
};
```

- [ ] **Step 3: Reset the timer between rounds in `ladderCompleteRound`**

Find `ladderCompleteRound`. After the line `ladderState.round++;` and before the rendering calls, add:

```js
const lastDuration = (ladderState.roundTimer && ladderState.roundTimer.lastDurationSec) || 600;
ladderState.roundTimer = newRoundTimerState(lastDuration);
```

(The defensive `|| 600` covers the edge case where `roundTimer` is missing because the user upgraded mid-tournament from a pre-feature build.)

- [ ] **Step 4: Defensively seed `roundTimer` on restore**

Find `restoreLadderState`. Inside the `if (state.ladderState)` block (where `ladderState = state.ladderState;` is assigned), immediately after that line, add:

```js
if (!ladderState.roundTimer) {
  ladderState.roundTimer = newRoundTimerState(600);
}
```

This guards against an existing localStorage blob from before this feature shipped.

- [ ] **Step 5: Verify**

```bash
node --check js/ladder.js
npm test
```

Both should pass. Open the page, switch to Ladder mode, click Fill Random Names → Start Ladder. Open DevTools console:

```js
ladderState.roundTimer
```

Should print: `{durationSec: 600, startedAt: null, pausedRemaining: null, expired: false, lastDurationSec: 600}`.

Click Complete Round once (any valid scores). Re-check `ladderState.roundTimer` in console — should still be `{durationSec: 600, ..., lastDurationSec: 600}` (unchanged because we haven't touched the timer yet).

- [ ] **Step 6: Commit**

```bash
git add js/ladder.js
git commit -m "Initialize roundTimer state in ladderState lifecycle"
```

---

## Task 2: Render the timer widget (all four states)

Add `renderLadderRoundTimer()` that builds the timer DOM based on the current `ladderState.roundTimer`. Wire it into `renderLadderCurrentRound`. **No event handlers yet** — buttons exist but do nothing. **No interval** — the running state shows the static initial countdown, not a live tick.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add `formatTimerMMSS` helper**

Add near the other helpers in `js/ladder.js`:

```js
function formatTimerMMSS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Add `getLadderTimerState` helper**

Add this near `formatTimerMMSS`:

```js
function getLadderTimerState() {
  if (!ladderState || !ladderState.roundTimer) return 'idle';
  const t = ladderState.roundTimer;
  if (t.expired) return 'expired';
  if (t.pausedRemaining !== null) return 'paused';
  if (t.startedAt !== null) return 'running';
  return 'idle';
}

function getLadderTimerRemainingSec() {
  if (!ladderState || !ladderState.roundTimer) return 0;
  const t = ladderState.roundTimer;
  if (t.expired) return 0;
  if (t.pausedRemaining !== null) return t.pausedRemaining;
  if (t.startedAt !== null) {
    return Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  }
  return t.durationSec;
}
```

- [ ] **Step 3: Add `renderLadderRoundTimer()`**

Add this near the other render functions:

```js
function renderLadderRoundTimer() {
  const container = document.getElementById('ladderRoundTimer');
  if (!container || !ladderState || !ladderState.roundTimer) {
    if (container) container.innerHTML = '';
    return;
  }
  const t = ladderState.roundTimer;
  const state = getLadderTimerState();
  const remaining = getLadderTimerRemainingSec();
  const lastMin = Math.max(1, Math.round(t.lastDurationSec / 60));

  let html = `<div class="round-timer round-timer-${state}">`;

  if (state === 'idle') {
    html += `
      <span class="round-timer-label">Round Timer</span>
      <input type="number" class="round-timer-input" id="roundTimerMinutes"
             min="1" max="60" value="${lastMin}">
      <span class="round-timer-unit">min</span>
      <button class="btn-timer btn-timer-start" id="roundTimerStartBtn" type="button">Start</button>`;
  } else {
    const display = formatTimerMMSS(remaining);
    html += `<span class="round-timer-label">Round Timer</span>
      <span class="round-timer-display" id="roundTimerDisplay">${display}</span>`;
    if (state === 'paused') html += `<span class="round-timer-tag">paused</span>`;
    if (state === 'running') {
      html += `<button class="btn-timer btn-timer-pause" id="roundTimerPauseBtn" type="button">Pause</button>`;
    } else if (state === 'paused') {
      html += `<button class="btn-timer btn-timer-resume" id="roundTimerResumeBtn" type="button">Resume</button>`;
    }
    html += `<button class="btn-timer btn-timer-reset" id="roundTimerResetBtn" type="button">Reset</button>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}
```

- [ ] **Step 4: Add the timer slot to `renderLadderCurrentRound`**

Find `renderLadderCurrentRound`. Locate the existing block that emits the current-round-banner:

```js
let html = `<div class="card">
  <div class="schedule-header"><h2>Round ${round}</h2></div>
  <div class="current-round-banner">
    <span class="current-round-dot"></span>
    <span class="current-round-text">Enter scores and click <span>"Complete Round"</span></span>
  </div>
  <div class="ladder-courts">`;
```

Replace with:

```js
let html = `<div class="card">
  <div class="schedule-header"><h2>Round ${round}</h2></div>
  <div class="current-round-banner">
    <span class="current-round-dot"></span>
    <span class="current-round-text">Enter scores and click <span>"Complete Round"</span></span>
    <span class="current-round-timer-slot" id="ladderRoundTimer"></span>
  </div>
  <div class="ladder-courts">`;
```

(The timer mounts inside the existing banner, sitting to the right of the "Enter scores..." text.)

- [ ] **Step 5: Call `renderLadderRoundTimer` from `renderLadderCurrentRound`**

At the end of `renderLadderCurrentRound`, after the existing `for (const court of LADDER_COURTS)` block that wires score listeners, add a single call:

```js
renderLadderRoundTimer();
```

- [ ] **Step 6: Verify**

```bash
node --check js/ladder.js
npm test
```

Open the page in Ladder mode, fill names, Start Ladder. Inside the current round card, next to the "Enter scores..." line, you should see:

> `Round Timer  [10] min  [Start]`

Click Start — nothing happens (no handlers yet). Open DevTools and run:

```js
ladderState.roundTimer.startedAt = Date.now() - 30000;  // pretend the timer started 30s ago
renderLadderRoundTimer();
```

The widget should change to running state showing `9:30` (give or take a second), with Pause and Reset buttons. Refresh — back to idle (state isn't saved by this task yet, that's Task 3).

- [ ] **Step 7: Commit**

```bash
git add js/ladder.js
git commit -m "Render ladder round timer widget in current round card"
```

---

## Task 3: Wire Start / Pause / Resume / Reset + expiry detection

Add the event handlers and the single `setInterval` that ticks the running countdown. When remaining hits zero, transition to expired. After this task the timer fully works in-session (refresh still resets it; that's Task 4).

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add a module-level interval reference**

Near the top of `js/ladder.js` where `ladderState` is declared, add:

```js
let ladderTimerInterval = null;
```

- [ ] **Step 2: Add the tick / start-stop helpers**

Add these helpers near `renderLadderRoundTimer`:

```js
function stopLadderTimerInterval() {
  if (ladderTimerInterval !== null) {
    clearInterval(ladderTimerInterval);
    ladderTimerInterval = null;
  }
}

function startLadderTimerInterval() {
  stopLadderTimerInterval();
  ladderTimerInterval = setInterval(tickLadderTimer, 500);
}

function tickLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) {
    stopLadderTimerInterval();
    return;
  }
  const t = ladderState.roundTimer;
  if (t.startedAt === null) {
    stopLadderTimerInterval();
    return;
  }
  const remaining = t.durationSec - (Date.now() - t.startedAt) / 1000;
  const display = document.getElementById('roundTimerDisplay');
  if (display) display.textContent = formatTimerMMSS(remaining);
  if (remaining <= 0) {
    expireLadderTimer();
  }
}
```

- [ ] **Step 3: Add the four button handlers**

Add these in the same area:

```js
function startLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const input = document.getElementById('roundTimerMinutes');
  const minutes = parseInt(input && input.value);
  if (isNaN(minutes) || minutes < 1 || minutes > 60) {
    if (input) {
      input.classList.add('input-error');
      setTimeout(() => input.classList.remove('input-error'), 1200);
    }
    return;
  }
  const seconds = minutes * 60;
  ladderState.roundTimer.durationSec = seconds;
  ladderState.roundTimer.lastDurationSec = seconds;
  ladderState.roundTimer.startedAt = Date.now();
  ladderState.roundTimer.pausedRemaining = null;
  ladderState.roundTimer.expired = false;
  renderLadderRoundTimer();
  startLadderTimerInterval();
  saveLadderState();
}

function pauseLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.startedAt === null) return;
  const remaining = Math.max(0, t.durationSec - (Date.now() - t.startedAt) / 1000);
  t.pausedRemaining = remaining;
  t.startedAt = null;
  stopLadderTimerInterval();
  renderLadderRoundTimer();
  saveLadderState();
}

function resumeLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.pausedRemaining === null) return;
  t.durationSec = t.pausedRemaining;
  t.startedAt = Date.now();
  t.pausedRemaining = null;
  renderLadderRoundTimer();
  startLadderTimerInterval();
  saveLadderState();
}

function resetLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  stopLadderTimerInterval();
  const last = ladderState.roundTimer.lastDurationSec || 600;
  ladderState.roundTimer = newRoundTimerState(last);
  renderLadderRoundTimer();
  saveLadderState();
}

function expireLadderTimer() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  t.expired = true;
  t.startedAt = null;
  t.pausedRemaining = null;
  stopLadderTimerInterval();
  renderLadderRoundTimer();
  saveLadderState();
}
```

- [ ] **Step 4: Wire the buttons in `renderLadderRoundTimer`**

At the end of `renderLadderRoundTimer`, after `container.innerHTML = html;`, add:

```js
const startBtn = document.getElementById('roundTimerStartBtn');
if (startBtn) startBtn.addEventListener('click', startLadderTimer);
const pauseBtn = document.getElementById('roundTimerPauseBtn');
if (pauseBtn) pauseBtn.addEventListener('click', pauseLadderTimer);
const resumeBtn = document.getElementById('roundTimerResumeBtn');
if (resumeBtn) resumeBtn.addEventListener('click', resumeLadderTimer);
const resetBtn = document.getElementById('roundTimerResetBtn');
if (resetBtn) resetBtn.addEventListener('click', resetLadderTimer);

const minutesInput = document.getElementById('roundTimerMinutes');
if (minutesInput) {
  minutesInput.addEventListener('input', function() { this.classList.remove('input-error'); });
  minutesInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); startLadderTimer(); }
  });
}
```

(The Enter-on-input shortcut means typing `5` then Enter starts a 5-minute timer without clicking.)

- [ ] **Step 5: Stop the interval on round transition / reset / start of a new ladder**

The `setInterval` is module-level state, separate from the persisted `roundTimer`. It needs to be cleared when:

- The ladder is reset (`ladderReset`).
- A round completes (`ladderCompleteRound`) — Task 1 already re-arms `roundTimer`; we just need to also stop the live interval.

In `ladderReset`, add `stopLadderTimerInterval();` at the very beginning of the function (before the `confirm()` call won't work because the user might cancel — instead, add it right after the `if (!confirm(...)) return;` line, before `clearLadderState();`):

```js
function ladderReset() {
  if (!confirm('Reset the ladder? All results will be cleared.')) return;
  stopLadderTimerInterval();
  clearLadderState();
  // ... rest unchanged
}
```

In `ladderCompleteRound`, in the block where you reset `ladderState.roundTimer = newRoundTimerState(lastDuration);`, also call `stopLadderTimerInterval();` immediately before that line.

- [ ] **Step 6: Verify**

```bash
node --check js/ladder.js
npm test
```

Open the page in Ladder mode, Fill Random Names, Start Ladder. The current round card should show `Round Timer 10 min [Start]`.

1. Type `1` (one minute), click Start. The widget changes to `Round Timer 1:00 [Pause] [Reset]` and counts down. Wait ~2 seconds: should read `0:58` etc.
2. Click Pause — countdown freezes, button changes to Resume. Wait 5 seconds. Click Resume — picks up from where it left off (NOT 5 seconds further along).
3. Click Reset — back to idle with `1` still in the input.
4. Type `0.05` (3 sec — wait, the input min=1; you can't enter less than 1 via the UI. Use DevTools instead):
   ```js
   ladderState.roundTimer.durationSec = 3;
   ladderState.roundTimer.startedAt = Date.now();
   renderLadderRoundTimer();
   startLadderTimerInterval();
   ```
   Wait 3 seconds — the timer should hit 0:00 and stay there. `ladderState.roundTimer.expired` is `true` in the console.
5. Try entering `0` minutes and clicking Start — the input briefly highlights red (input-error) and nothing starts.
6. Refresh the page mid-countdown — timer resets to idle (Task 4 fixes this).

- [ ] **Step 7: Commit**

```bash
git add js/ladder.js
git commit -m "Wire Start/Pause/Resume/Reset and expiry detection for ladder timer"
```

---

## Task 4: Restore the timer on page refresh

Make the timer survive refresh. Reads the saved `roundTimer`, computes the right state, and re-starts the interval if running. Wall-clock-based, so a 3-minute laptop sleep correctly subtracts 3 minutes from the remaining time.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add `resumeLadderTimerOnRestore` helper**

Add near the other timer helpers:

```js
function resumeLadderTimerOnRestore() {
  if (!ladderState || !ladderState.roundTimer) return;
  const t = ladderState.roundTimer;
  if (t.expired) return;
  if (t.pausedRemaining !== null) return; // paused stays paused
  if (t.startedAt !== null) {
    const remaining = t.durationSec - (Date.now() - t.startedAt) / 1000;
    if (remaining <= 0) {
      t.expired = true;
      t.startedAt = null;
      t.pausedRemaining = null;
      saveLadderState();
      return;
    }
    startLadderTimerInterval();
  }
}
```

- [ ] **Step 2: Call `resumeLadderTimerOnRestore` from `restoreLadderState`**

Find `restoreLadderState`. Locate the existing block that re-renders the active ladder:

```js
if (ladderState) {
  document.getElementById('ladderOutput').style.display = 'block';
  renderLadderCurrentRound();
  renderLadderLeaderboard();
  renderLadderHistory();
}
```

After `renderLadderHistory();`, before the closing `}`, add:

```js
resumeLadderTimerOnRestore();
```

(This must run AFTER `renderLadderCurrentRound()` so the `#ladderRoundTimer` container exists in the DOM when the interval starts ticking and tries to update `#roundTimerDisplay`.)

- [ ] **Step 3: Verify**

```bash
node --check js/ladder.js
npm test
```

Open the page, Ladder mode, Fill Random Names, Start Ladder.

1. Type `2` minutes, click Start. Wait ~10 seconds (count down to ~1:50). Refresh the page. The timer should restore to roughly `1:50` (a tick or two off is fine) and continue counting.
2. Pause the timer at e.g. `1:30`. Refresh. The timer should restore to `1:30` paused, with the Resume button showing.
3. Click Start, wait until the timer expires (use a 1-minute timer or use DevTools to set `durationSec = 5`). Refresh while expired — should still show `0:00` red/expired.
4. Sleep test (optional but worth doing): start a 5-minute timer, close the laptop lid for 1 minute, reopen. The timer should now show ~4:00 — wall-clock based, not interval-counted.

- [ ] **Step 4: Commit**

```bash
git add js/ladder.js
git commit -m "Restore ladder round timer on page refresh"
```

---

## Task 5: Style the timer widget + expired pulse

Adds CSS for the four timer states and the expired pulse animation. After this task the timer is visually polished.

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Append the new styles**

At the end of `css/styles.css`, append:

```css
  /* --- Ladder round timer widget --- */
  .current-round-banner .current-round-timer-slot {
    margin-left: auto;
    display: flex;
  }
  .round-timer {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    font-family: 'Inter', sans-serif;
  }
  .round-timer-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #7c8091;
  }
  .round-timer-input {
    width: 56px;
    padding: 0.35rem 0.4rem;
    border-radius: 8px;
    text-align: center;
    border: 1px solid #2a2d37;
    background: #1e2028;
    color: #e4e7ec;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    outline: none;
    -moz-appearance: textfield;
    transition: all 0.15s ease;
  }
  .round-timer-input::-webkit-outer-spin-button,
  .round-timer-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .round-timer-input:hover { border-color: #383c48; }
  .round-timer-input:focus {
    border-color: #818cf8;
    box-shadow: 0 0 0 3px rgba(129,140,248,0.1);
  }
  .round-timer-input.input-error {
    border-color: #f87171;
    box-shadow: 0 0 0 3px rgba(248,113,113,0.18);
  }
  .round-timer-unit {
    font-size: 0.72rem;
    color: #7c8091;
    margin-left: -0.2rem;
  }
  .round-timer-display {
    font-family: 'Inter', monospace;
    font-variant-numeric: tabular-nums;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #a5b4fc;
    min-width: 4ch;
    text-align: center;
  }
  .round-timer-paused .round-timer-display { color: #9ca3af; }
  .round-timer-tag {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    background: #1e2028;
    border: 1px solid #2a2d37;
    border-radius: 6px;
    padding: 0.1rem 0.4rem;
  }
  .btn-timer {
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.32rem 0.7rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }
  .btn-timer-start, .btn-timer-resume {
    background: rgba(129,140,248,0.12);
    color: #a5b4fc;
    border-color: rgba(129,140,248,0.18);
  }
  .btn-timer-start:hover, .btn-timer-resume:hover {
    background: rgba(129,140,248,0.2);
    color: #c7d2fe;
  }
  .btn-timer-pause {
    background: rgba(253,224,71,0.1);
    color: #fde68a;
    border-color: rgba(253,224,71,0.18);
  }
  .btn-timer-pause:hover { background: rgba(253,224,71,0.16); }
  .btn-timer-reset {
    background: rgba(248,113,113,0.08);
    color: #fca5a5;
    border-color: rgba(248,113,113,0.15);
  }
  .btn-timer-reset:hover { background: rgba(248,113,113,0.14); }

  .round-timer-expired .round-timer-display {
    color: #fca5a5;
    animation: pulse-timer-expired 1.4s ease-in-out infinite;
  }
  .round-timer-expired .round-timer-label { color: #fca5a5; }
  @keyframes pulse-timer-expired {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(1.05); }
  }
```

- [ ] **Step 2: Verify**

Open the page, Ladder mode, Start Ladder.

1. The Round Timer should now look polished, sitting on the right side of the "Enter scores..." banner with a `10 min` input + a soft purple Start button.
2. Click Start — large purple `MM:SS` countdown with a yellow Pause and red Reset.
3. Pause — countdown grays out, "PAUSED" tag appears.
4. Reset — back to the idle input.
5. Trigger expiry via DevTools (`ladderState.roundTimer.durationSec = 2; ladderState.roundTimer.startedAt = Date.now(); renderLadderRoundTimer(); startLadderTimerInterval();`). After 2 seconds the display should show `0:00` in red with a gentle pulse.
6. Brace count check: `tr -cd '{' < css/styles.css | wc -c` and `tr -cd '}' < css/styles.css | wc -c` — same number.

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "Style ladder round timer widget and expired pulse animation"
```

---

## Task 6: Per-court "✓ Done" badge

Adds a small "✓ Done" badge next to each court label that shows when the court has a completed game. Pure CSS visibility — the existing `.court-done` class is already toggled by `checkLadderCourtScore`, so we just append the badge element and let CSS handle visibility.

**Files:**
- Modify: `js/ladder.js`
- Modify: `css/styles.css`

- [ ] **Step 1: Add the badge to the court markup in `renderLadderCurrentRound`**

Find the existing court markup in `renderLadderCurrentRound`:

```js
html += `<div class="${cls}" id="lc${court}">
  <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.6rem;">
    <div class="court-label" style="margin-bottom:0;">${label}</div>
    <button class="btn-swap" onclick="ladderSwapPartners(${court})">Mix Partners (if necessary)</button>
  </div>
```

Add a `<span class="court-done-badge">✓ Done</span>` right after the court label `<div>`:

```js
html += `<div class="${cls}" id="lc${court}">
  <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.6rem;">
    <div class="court-label" style="margin-bottom:0;">${label}</div>
    <span class="court-done-badge">\u2713 Done</span>
    <button class="btn-swap" onclick="ladderSwapPartners(${court})">Mix Partners (if necessary)</button>
  </div>
```

- [ ] **Step 2: Style the badge with conditional visibility**

At the end of `css/styles.css`, append:

```css
  .court-done-badge {
    display: none;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6ee7b7;
    background: rgba(110,231,183,0.1);
    border: 1px solid rgba(110,231,183,0.2);
    border-radius: 6px;
    padding: 0.15rem 0.45rem;
  }
  .ladder-court.court-done .court-done-badge {
    display: inline-flex;
    align-items: center;
  }
```

- [ ] **Step 3: Verify**

```bash
node --check js/ladder.js
```

Open the page, Ladder mode, Start Ladder. On any court, enter `11` and `7`. The court should fade as today, AND a green `✓ DONE` badge should appear next to the "Court N (Top)" label. Clear one of the score inputs — the badge disappears (court no longer counts as done).

Try Complete Game Early on a court that's, say, `5` to `3` — the badge should also appear because the court is now `court-done`.

- [ ] **Step 4: Commit**

```bash
git add js/ladder.js css/styles.css
git commit -m "Show per-court Done badge when a court has a completed game"
```

---

## Task 7: README + version bump + final verification

Bump the version to `2.5.0` and document the timer in the README. Run a final end-to-end check.

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `package.json`

- [ ] **Step 1: Update the README**

Find the "Traditional Ladder Mode" section in `README.md`:

```markdown
### Traditional Ladder Mode
- **Configurable layout** — pick 1–10 courts (4 players per court) and customize each court number
- **Manual or random initial assignment** — drag players between courts to set starting positions, or click Re-shuffle for a gender-balanced random layout
- Winners move up, losers move down each round
- Score validation for standard pickleball scoring
- Full round history and leaderboard
```

Replace with:

```markdown
### Traditional Ladder Mode
- **Configurable layout** — pick 1–10 courts (4 players per court) and customize each court number
- **Manual or random initial assignment** — drag players between courts to set starting positions, or click Re-shuffle for a gender-balanced random layout
- **Per-round countdown timer** — set the round length (default 10 min), Pause / Resume / Reset; survives page refresh; goes red and pulses when time's up
- **Per-court Done badge** — at-a-glance status of which courts have finished while the round is in progress
- Winners move up, losers move down each round
- Score validation for standard pickleball scoring
- Full round history and leaderboard
```

- [ ] **Step 2: Bump `APP_VERSION` in `index.html`**

Find:

```html
<script>const APP_VERSION = "2.4.0";</script>
```

Change to:

```html
<script>const APP_VERSION = "2.5.0";</script>
```

- [ ] **Step 3: Bump `version` in `package.json`**

Change `"version": "2.4.0"` to `"version": "2.5.0"`.

- [ ] **Step 4: Run the existing test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Final end-to-end manual check**

Open the page in a fresh browser tab (or hard-refresh).

1. Switch to Ladder. Fill Random Names. Start Ladder.
2. Type `1` minute, click Start. Verify the timer counts down.
3. Enter scores on one court (e.g., 11–7). Verify the `✓ Done` badge appears.
4. Pause the timer mid-countdown. Refresh the page. Timer should still be paused at the same time.
5. Resume. Wait until expiry. Verify the `0:00` red pulse.
6. Click Reset. Verify it returns to idle with `1` still in the input.
7. Click Complete Round (after entering valid scores on all courts). Verify the timer auto-resets to idle with `1` still as the default minutes for the new round.
8. Click Reset Ladder. Verify the ladder fully resets and the timer is gone (because there's no active round).

- [ ] **Step 6: Commit**

```bash
git add README.md index.html package.json
git commit -m "v2.5.0: Add ladder round timer and per-court Done badge"
```

---

## Self-Review (already complete)

**Spec coverage:**

- Per-round timer with editable minutes (default 10) — Task 1 (init), Task 2 (render idle UI), Task 3 (Start handler).
- Pause / Resume / Reset — Task 3.
- Visual-only expiry (red + pulse) — Task 3 (state transition), Task 5 (CSS animation).
- Wall-clock persistence — Task 1 (state shape), Task 3 (saveLadderState calls), Task 4 (resume on restore).
- Per-court "✓ Done" badge — Task 6.
- Setup-lock interaction (timer always usable during active ladder) — covered implicitly: timer DOM lives in current round card, not in the locked setup cards.
- README + version bump — Task 7.

**Placeholder scan:** every step contains the exact code or CSS to write. No "TBD", no "similar to above".

**Type / name consistency:**

- State shape `{ durationSec, startedAt, pausedRemaining, expired, lastDurationSec }` is used identically in Tasks 1, 3, 4.
- Element IDs: `ladderRoundTimer` (container), `roundTimerMinutes` (input), `roundTimerDisplay` (countdown text), `roundTimerStartBtn`, `roundTimerPauseBtn`, `roundTimerResumeBtn`, `roundTimerResetBtn` — referenced consistently.
- CSS classes: `round-timer`, `round-timer-idle`, `round-timer-running`, `round-timer-paused`, `round-timer-expired`, `round-timer-label`, `round-timer-input`, `round-timer-unit`, `round-timer-display`, `round-timer-tag`, `btn-timer`, `btn-timer-start`, `btn-timer-pause`, `btn-timer-resume`, `btn-timer-reset`, `court-done-badge` — defined in Task 5/6, referenced in Task 2/6.
- Function names: `formatTimerMMSS`, `getLadderTimerState`, `getLadderTimerRemainingSec`, `renderLadderRoundTimer`, `startLadderTimer`, `pauseLadderTimer`, `resumeLadderTimer`, `resetLadderTimer`, `expireLadderTimer`, `tickLadderTimer`, `startLadderTimerInterval`, `stopLadderTimerInterval`, `resumeLadderTimerOnRestore`, `newRoundTimerState` — consistent across tasks.

---

## Execution Handoff

After saving the plan, two execution options are available:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Pick whichever you prefer when ready.
