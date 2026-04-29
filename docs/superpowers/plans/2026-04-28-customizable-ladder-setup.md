# Customizable Traditional Ladder Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 20-player / `[2,3,7,8,9]` Traditional Ladder layout with a fully configurable setup: variable court count (1–10), per-court editable court numbers, dynamic setup message, and a drag-and-drop initial court-assignment UI.

**Architecture:** All state moves into a new `ladderConfig` object (`numCourts`, `courtNumbers`, `manualAssignment`) replacing the `LADDER_PLAYER_COUNT` and `LADDER_COURTS` constants. The setup UI grows two new cards (`Setup`, `Court Numbers`) and one new card after the player grid (`Court Assignments`) that renders each court as a vertical column of draggable player chips. `ladderInitialAllocation` is split into a pure-random helper (`randomGenderBalancedAssignment`) and a team-pairing helper (`pairTeamsForAssignment`) so the user's manual placement can flow into `ladderStart` instead of the always-random behavior.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step. HTML5 native drag-and-drop (no library). LocalStorage for persistence.

**Testing note:** The repo's automated test harness (`npm test`) covers Round Robin scheduling only. Per the design spec ("Out of scope"), this change adds no automated tests. Each task ends with explicit **manual verification** steps — open `index.html` in a browser (or run `python3 -m http.server` and visit `http://localhost:8000`) and step through the interactions. Frequent small commits keep each step independently revertible.

**Spec reference:** `docs/superpowers/specs/2026-04-28-customizable-ladder-setup-design.md`

---

## File Structure

| File | Role |
|---|---|
| `js/ladder.js` | All ladder logic. New `ladderConfig` state, accessors, refactored allocation helpers, build/render functions for the new cards, drag-and-drop wiring, validation/start/persist updates. |
| `js/state.js` | Hook the new ladder setup builders into `setMode('ladder')` so the cards render when the mode is selected. |
| `index.html` | Markup for the three new ladder cards (Setup, Court Numbers, Court Assignments). Remove the hardcoded "20 players on courts 2, 3, 7, 8, 9" message. |
| `css/styles.css` | Styling for the assignment chips, drag-over highlight, dragging state, and the column layout. |
| `README.md` | One-bullet update under "Traditional Ladder Mode" reflecting the new flexibility. |

---

## Task 1: Refactor `LADDER_PLAYER_COUNT` and `LADDER_COURTS` into `ladderConfig`

Pure refactor — no UI changes, no behavior changes. Lays the groundwork for everything that follows.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Replace the constants with a `ladderConfig` object and accessors**

Open `js/ladder.js`. Find these lines near the top:

```js
const LADDER_STORAGE_KEY = 'powerplay_pickleball_ladder_state';
const LADDER_COURTS = [2, 3, 7, 8, 9]; // lowest to highest
const LADDER_PLAYER_COUNT = 20;
```

Replace with:

```js
const LADDER_STORAGE_KEY = 'powerplay_pickleball_ladder_state';

let ladderConfig = {
  numCourts: 5,
  courtNumbers: [2, 3, 7, 8, 9],
  manualAssignment: null,
};

function getLadderCourts() { return ladderConfig.courtNumbers; }
function getLadderPlayerCount() { return ladderConfig.numCourts * 4; }
```

- [ ] **Step 2: Replace all uses of `LADDER_COURTS` with `getLadderCourts()`**

Search `js/ladder.js` for `LADDER_COURTS`. There are uses in:
- `ladderExportCSV` (line ~32): `const courtsHighToLow = [...LADDER_COURTS].reverse();` → `const courtsHighToLow = [...getLadderCourts()].reverse();`
- Inside the `for (const round of ladderState.rounds)` loop (line ~36): same replacement, but pull from the saved-round snapshot once persistence is updated. **For now**, just replace `LADDER_COURTS` with `getLadderCourts()` everywhere it appears.
- `newPartnerHistory` (line ~182): `Array.from({length: LADDER_PLAYER_COUNT}, ...)` → `Array.from({length: getLadderPlayerCount()}, ...)` and the inner `new Array(LADDER_PLAYER_COUNT)` → `new Array(getLadderPlayerCount())`.
- `ladderInitialAllocation`: `LADDER_PLAYER_COUNT`, `LADDER_COURTS` (multiple places).
- `ladderProcessMovement`: `LADDER_COURTS` in five places, plus `LADDER_COURTS.forEach`, `LADDER_COURTS.length`, etc.
- `ladderStart`: `playerWins: new Array(LADDER_PLAYER_COUNT).fill(0)` etc.
- `renderLadderCurrentRound`: `LADDER_COURTS` (multiple).
- `renderLadderLeaderboard`: `LADDER_COURTS` (multiple).
- `renderLadderHistory`: `LADDER_COURTS` (one place).
- `ladderCompleteRound`: `LADDER_COURTS` (multiple).
- `buildLadderPlayerGrid`, `getLadderNames`, `getLadderGenders`, `ladderFillDefaults`, `ladderValidate`, `saveLadderPlayerData`: `LADDER_PLAYER_COUNT` (multiple).

After the search-and-replace, **`LADDER_COURTS` and `LADDER_PLAYER_COUNT` should not appear anywhere in the file.**

- [ ] **Step 3: Manual verification — behavior identical to before**

Open `index.html` in a browser. Switch to Traditional Ladder mode. Click **Fill Random Names**, then **Start Ladder**. Verify the round renders with 5 courts (2, 3, 7, 8, 9), 20 players, 4 per court. Complete a round; check that movement still happens. Refresh the page; check that state is restored (it should still work because the persistence format hasn't changed yet).

- [ ] **Step 4: Commit**

```bash
git add js/ladder.js
git commit -m "Refactor ladder constants into ladderConfig with accessors"
```

---

## Task 2: Add the Setup card with `Number of Courts` input

Adds the editable Number of Courts input + a derived Number of Players display. Wires up the player grid to resize when courts change.

**Files:**
- Modify: `index.html`
- Modify: `js/ladder.js`

- [ ] **Step 1: Add the Setup card markup to `index.html`**

In `index.html`, find the existing ladder setup section:

```96:97:index.html
      <div class="card-title">Ladder Setup</div>
      <p style="font-size:0.82rem; color:#94a3b8; margin-bottom:0;">20 players on courts 2, 3, 7, 8, 9 &mdash; winners move up, losers move down</p>
```

Replace the entire `<div class="card">...Ladder Setup...</div>` block with:

```html
<div class="card">
  <div class="card-title">Ladder Setup</div>
  <div style="display:flex; gap:1.5rem; flex-wrap:wrap; margin-bottom:1.25rem;">
    <div style="display:flex; align-items:center; gap:0.6rem;">
      <label class="option-label" for="ladderNumCourts">Number of Courts</label>
      <input type="number" class="rounds-input" id="ladderNumCourts" value="5" min="1" max="10">
    </div>
    <div style="display:flex; align-items:center; gap:0.6rem;">
      <span class="option-label">Number of Players</span>
      <span class="option-label" id="ladderNumPlayersDisplay" style="color:#a5b4fc; font-weight:600;">20 players</span>
    </div>
  </div>
  <p id="ladderSetupMessage" style="font-size:0.82rem; color:#94a3b8; margin-bottom:0;">Winners move up, losers move down.</p>
</div>
```

- [ ] **Step 2: Add a `setLadderNumCourts` handler in `js/ladder.js`**

Add this function near the top of `js/ladder.js`, just below the `getLadderPlayerCount()` definition:

```js
function setLadderNumCourts(n) {
  if (n < 1 || n > 10 || isNaN(n)) return false;
  const oldN = ladderConfig.numCourts;
  if (n === oldN) return true;

  if (n < oldN) {
    const droppedNames = [];
    for (let i = n * 4; i < oldN * 4; i++) {
      const el = document.getElementById(`lp${i}`);
      if (el && el.value.trim()) droppedNames.push(el.value.trim());
    }
    if (droppedNames.length > 0) {
      const ok = confirm(
        `Reducing the court count will remove the last ${oldN * 4 - n * 4} players ` +
        `(${droppedNames.join(', ')}). Continue?`
      );
      if (!ok) {
        document.getElementById('ladderNumCourts').value = oldN;
        return false;
      }
    }
  }

  ladderConfig.numCourts = n;
  if (ladderConfig.courtNumbers.length > n) {
    ladderConfig.courtNumbers = ladderConfig.courtNumbers.slice(0, n);
  } else {
    while (ladderConfig.courtNumbers.length < n) {
      let candidate = ladderConfig.courtNumbers.length + 1;
      while (ladderConfig.courtNumbers.includes(candidate)) candidate++;
      ladderConfig.courtNumbers.push(candidate);
    }
  }
  ladderConfig.manualAssignment = null;

  buildLadderPlayerGrid();
  updateLadderSetupMessage();
  saveLadderState();
  return true;
}
```

- [ ] **Step 3: Add `updateLadderSetupMessage` and a Number-of-Players display updater**

Add these helpers in the same area:

```js
function updateLadderSetupMessage() {
  const display = document.getElementById('ladderNumPlayersDisplay');
  if (display) display.textContent = `${getLadderPlayerCount()} players`;

  const msg = document.getElementById('ladderSetupMessage');
  if (msg) {
    const courts = getLadderCourts().join(', ');
    msg.textContent =
      `${getLadderPlayerCount()} players on courts ${courts} \u2014 winners move up, losers move down.`;
  }
}
```

- [ ] **Step 4: Update `buildLadderPlayerGrid` to use `getLadderPlayerCount()`**

This was already done in Task 1, but verify the loop bound `for (let i = 0; i < getLadderPlayerCount(); i++)` is correct. Then ensure the function is called without the old `LADDER_PLAYER_COUNT` argument anywhere.

- [ ] **Step 5: Wire up the input event**

Find the bottom of `js/ladder.js` (after `restoreLadderState` and `clearLadderState`). Add a small initializer that runs once on script load:

```js
(function initLadderSetupInputs() {
  const numCourtsEl = document.getElementById('ladderNumCourts');
  if (numCourtsEl) {
    numCourtsEl.addEventListener('input', function() {
      this.classList.remove('input-error');
      const v = parseInt(this.value);
      if (!isNaN(v) && v >= 1 && v <= 10) setLadderNumCourts(v);
    });
  }
})();
```

- [ ] **Step 6: Update the Players card title to be dynamic**

In `index.html`, change:

```html
<div class="card-title">Players (20)</div>
```

to:

```html
<div class="card-title" id="ladderPlayersCardTitle">Players (20)</div>
```

In `js/ladder.js`, at the top of `buildLadderPlayerGrid`, add:

```js
const titleEl = document.getElementById('ladderPlayersCardTitle');
if (titleEl) titleEl.textContent = `Players (${getLadderPlayerCount()})`;
```

- [ ] **Step 7: Call `updateLadderSetupMessage` from `restoreLadderState` and on first build**

In `restoreLadderState`, after `buildLadderPlayerGrid()`, add `updateLadderSetupMessage();`.

In the `setMode` listener for ladder mode (in `js/state.js`, line ~79), the existing code is:

```83:84:js/state.js
document.getElementById('modeLadder').addEventListener('change', () => {
  setMode('ladder');
  if (!document.getElementById('ladderPlayerGrid').children.length) buildLadderPlayerGrid();
});
```

Update this to also call `updateLadderSetupMessage()`:

```js
document.getElementById('modeLadder').addEventListener('change', () => {
  setMode('ladder');
  if (!document.getElementById('ladderPlayerGrid').children.length) buildLadderPlayerGrid();
  updateLadderSetupMessage();
});
```

- [ ] **Step 8: Manual verification**

Open the page. Switch to Ladder mode. Verify:

- The Setup card shows "Number of Courts: 5" and "Number of Players: 20 players".
- The setup message reads: "20 players on courts 2, 3, 7, 8, 9 — winners move up, losers move down."
- Change Number of Courts to 6. The Players card grows to 24 inputs, the message updates to "24 players on courts 2, 3, 7, 8, 9, 10 — ...", and the players-count display shows "24 players".
- Change to 4 with no names entered: shrinks silently to 16 players.
- Fill in some names, change to 3: the confirm dialog appears listing the dropped names. Cancel → reverts to 4. Accept → drops them.
- Refresh the page: state is restored (the saved blob still has older format; the `numCourts` defaults to 5 because we haven't updated persistence yet).

- [ ] **Step 9: Commit**

```bash
git add index.html js/ladder.js js/state.js
git commit -m "Add ladder Setup card with editable court count"
```

---

## Task 3: Add the Court Numbers card

Adds a card with one input per court (top-to-bottom of the ladder), wired to `ladderConfig.courtNumbers` and to `ladderValidate`.

**Files:**
- Modify: `index.html`
- Modify: `js/ladder.js`

- [ ] **Step 1: Add the Court Numbers card markup**

In `index.html`, immediately after the new Setup card and before the Players card, add:

```html
<div class="card">
  <div class="card-title">Court Numbers (Top to Bottom)</div>
  <div class="court-inputs" id="ladderCourtInputs"></div>
</div>
```

- [ ] **Step 2: Add `buildLadderCourtInputs` function in `js/ladder.js`**

Add this near `buildLadderPlayerGrid`:

```js
function buildLadderCourtInputs() {
  const container = document.getElementById('ladderCourtInputs');
  if (!container) return;
  container.innerHTML = '';

  const courtsHighToLow = [...ladderConfig.courtNumbers].reverse();
  for (let i = 0; i < ladderConfig.numCourts; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'court-num-group';
    const label = document.createElement('span');
    label.textContent = i === 0 ? 'Top' : (i === ladderConfig.numCourts - 1 ? 'Bottom' : `#${i + 1}`);
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'court-num-input';
    input.id = `ladderCourt${i}`;
    input.min = 1; input.max = 99;
    input.value = courtsHighToLow[i];
    input.addEventListener('input', function() {
      this.classList.remove('input-error');
      const v = parseInt(this.value);
      if (!isNaN(v) && v >= 1 && v <= 99) {
        const idx = ladderConfig.numCourts - 1 - i;
        ladderConfig.courtNumbers[idx] = v;
        updateLadderSetupMessage();
        saveLadderState();
      }
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}
```

- [ ] **Step 3: Call `buildLadderCourtInputs` whenever `numCourts` changes**

In `setLadderNumCourts`, after `buildLadderPlayerGrid();`, also call `buildLadderCourtInputs();`.

In the modeLadder listener in `js/state.js`, after `buildLadderPlayerGrid()`, also call `buildLadderCourtInputs();`.

In `restoreLadderState`, after `buildLadderPlayerGrid()`, also call `buildLadderCourtInputs();`.

- [ ] **Step 4: Update `ladderValidate` to validate court numbers**

Find `ladderValidate` in `js/ladder.js`. After the duplicate-name check, before `return errors;`, add:

```js
const courtVals = [];
for (let i = 0; i < ladderConfig.numCourts; i++) {
  const el = document.getElementById(`ladderCourt${i}`);
  if (!el) continue;
  const v = parseInt(el.value);
  if (!el.value.trim() || isNaN(v) || v < 1 || v > 99) {
    el.classList.add('input-error');
    errors.push(`Court ${i + 1} must be a number between 1 and 99`);
  }
  courtVals.push(el.value.trim());
}
for (let i = 0; i < courtVals.length; i++) {
  for (let j = i + 1; j < courtVals.length; j++) {
    if (courtVals[i] && courtVals[j] && courtVals[i] === courtVals[j]) {
      const a = document.getElementById(`ladderCourt${i}`);
      const b = document.getElementById(`ladderCourt${j}`);
      if (a) a.classList.add('input-error');
      if (b) b.classList.add('input-error');
      errors.push(`Duplicate court number: ${courtVals[i]}`);
    }
  }
}
```

- [ ] **Step 5: Manual verification**

Open the page in Ladder mode. Verify:

- "Court Numbers (Top to Bottom)" card appears with 5 inputs labeled "Top", "#2", "#3", "#4", "Bottom" with values 9, 8, 7, 3, 2 left-to-right.
- The setup message reads "20 players on courts 2, 3, 7, 8, 9 — winners move up, losers move down." (always low-to-high in the message).
- Change the "Top" input from 9 to 10. The message updates to "20 players on courts 2, 3, 7, 8, 10 — ...".
- Set two inputs to the same number, click Start Ladder: validation error "Duplicate court number: X" appears.
- Change Number of Courts to 7 in the Setup card: Court Numbers card rebuilds with 7 inputs, defaults extending the previous values.
- Change Number of Courts to 3: Court Numbers card shrinks to 3 inputs, top-most preserved.

- [ ] **Step 6: Commit**

```bash
git add index.html js/ladder.js js/state.js
git commit -m "Add editable Court Numbers card to ladder setup"
```

---

## Task 4: Refactor `ladderInitialAllocation` into two helpers

Splits the existing function into a pure-random assignment (returning per-court player slots) and a separate team-pairing step. Keeps end-to-end behavior identical.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Replace `ladderInitialAllocation` with two helpers**

Find the existing `ladderInitialAllocation` function (~line 185 originally). Replace it with:

```js
function randomGenderBalancedAssignment(genders, numCourts) {
  const totalSlots = numCourts * 4;
  const allIndices = Array.from({ length: totalSlots }, (_, i) => i);
  const males = shuffle(allIndices.filter(i => genders[i] === 'M'));
  const females = shuffle(allIndices.filter(i => genders[i] === 'F'));

  const courts = [];
  for (let c = 0; c < numCourts; c++) courts.push([]);

  let mi = 0, fi = 0;
  for (let c = 0; c < numCourts; c++) {
    for (let k = 0; k < 2 && fi < females.length; k++) courts[c].push(females[fi++]);
    for (let k = 0; k < 2 && mi < males.length; k++) courts[c].push(males[mi++]);
  }
  for (let c = 0; c < numCourts; c++) {
    while (courts[c].length < 4) {
      if (mi < males.length) courts[c].push(males[mi++]);
      else if (fi < females.length) courts[c].push(females[fi++]);
      else break;
    }
  }
  return courts; // index 0 = lowest court, last = highest
}

function pairTeamsForAssignment(courtSlots, courtNumbers, genders, preferMixed, partnerHistory) {
  const courtPlayers = {};
  const courtTeams = {};
  for (let c = 0; c < courtNumbers.length; c++) {
    const court = courtNumbers[c];
    courtPlayers[court] = courtSlots[c];
    courtTeams[court] = bestPairing(courtSlots[c], genders, preferMixed, partnerHistory);
  }
  return { courtPlayers, courtTeams };
}
```

- [ ] **Step 2: Update `ladderStart` to use the two helpers**

Find `ladderStart`. Replace this block:

```js
const partnerHistory = newPartnerHistory();
const { courtPlayers, courtTeams } = ladderInitialAllocation(genders, preferMixed, partnerHistory);
```

with:

```js
const partnerHistory = newPartnerHistory();
const courtSlots = ladderConfig.manualAssignment
  ? ladderConfig.manualAssignment.map(arr => [...arr])
  : randomGenderBalancedAssignment(genders, ladderConfig.numCourts);
const { courtPlayers, courtTeams } =
  pairTeamsForAssignment(courtSlots, ladderConfig.courtNumbers, genders, preferMixed, partnerHistory);
```

- [ ] **Step 3: Manual verification**

Open the page, switch to Ladder mode, click Fill Random Names → Start Ladder. The ladder should still launch with 5 courts (2, 3, 7, 8, 9), 4 players per court, gender-balanced where possible. Complete a round; movement should still work.

- [ ] **Step 4: Commit**

```bash
git add js/ladder.js
git commit -m "Split ladder allocation into random + team-pairing helpers"
```

---

## Task 5: Build the Court Assignments card (static rendering)

Adds the Court Assignments card markup and renders one column per court with 4 player chips. No drag-and-drop yet — just static rendering, kept in sync with player names/genders and `ladderConfig.manualAssignment`.

**Files:**
- Modify: `index.html`
- Modify: `js/ladder.js`

- [ ] **Step 1: Add the Court Assignments card markup**

In `index.html`, insert this new card **after** the Players card and **before** the Controls card:

```html
<div class="card">
  <div class="card-title" style="display:flex; align-items:center; gap:0.75rem;">
    <span>Court Assignments</span>
    <button class="btn-swap" id="ladderReshuffleBtn" type="button">Re-shuffle</button>
  </div>
  <p style="font-size:0.78rem; color:#7c8091; margin: -0.5rem 0 1rem 0;">Drag players between courts to set initial positions, or click Re-shuffle for a new random gender-balanced layout.</p>
  <div id="ladderResizeBanner" style="display:none; font-size:0.78rem; color:#fbbf24; margin-bottom:0.75rem;">Re-shuffled because court count changed.</div>
  <div id="ladderCourtAssignments" class="ladder-assignments"></div>
</div>
```

- [ ] **Step 2: Add `ensureLadderAssignment` and `buildLadderCourtAssignments` in `js/ladder.js`**

Add near the other build helpers:

```js
function ensureLadderAssignment() {
  const expectedSlots = getLadderPlayerCount();
  const cfg = ladderConfig.manualAssignment;
  const isValid = Array.isArray(cfg)
    && cfg.length === ladderConfig.numCourts
    && cfg.every(c => Array.isArray(c) && c.length === 4)
    && cfg.flat().slice().sort((a, b) => a - b).every((v, i) => v === i)
    && cfg.flat().length === expectedSlots;
  if (!isValid) {
    ladderConfig.manualAssignment =
      randomGenderBalancedAssignment(getLadderGenders(), ladderConfig.numCourts);
  }
}

function buildLadderCourtAssignments() {
  const container = document.getElementById('ladderCourtAssignments');
  if (!container) return;
  ensureLadderAssignment();

  container.innerHTML = '';
  const courtsHighToLow = [...ladderConfig.courtNumbers]
    .map((num, idx) => ({ num, idx }))
    .sort((a, b) => b.num - a.num);

  const names = getLadderNames();
  const genders = getLadderGenders();

  for (const { num, idx } of courtsHighToLow) {
    const col = document.createElement('div');
    col.className = 'ladder-assignment-court';
    col.dataset.courtIdx = String(idx);

    const head = document.createElement('div');
    head.className = 'ladder-assignment-head';
    const isTop = num === Math.max(...ladderConfig.courtNumbers);
    const isBottom = num === Math.min(...ladderConfig.courtNumbers);
    const tag = isTop ? ' (Top)' : isBottom ? ' (Bottom)' : '';
    head.textContent = `Court ${num}${tag}`;
    col.appendChild(head);

    const slots = ladderConfig.manualAssignment[idx];
    for (let s = 0; s < 4; s++) {
      const pIdx = slots[s];
      const chip = document.createElement('div');
      chip.className = 'ladder-chip';
      chip.dataset.playerIdx = String(pIdx);
      chip.dataset.courtIdx = String(idx);
      chip.dataset.slotIdx = String(s);
      chip.draggable = true;

      const label = document.createElement('span');
      label.className = 'ladder-chip-name';
      label.textContent = names[pIdx] || `Player ${pIdx + 1}`;

      const badge = document.createElement('span');
      badge.className = 'ladder-chip-gender ' + (genders[pIdx] === 'F' ? 'g-f' : 'g-m');
      badge.textContent = genders[pIdx] === 'F' ? 'F' : 'M';

      chip.appendChild(label);
      chip.appendChild(badge);
      col.appendChild(chip);
    }
    container.appendChild(col);
  }
}
```

- [ ] **Step 3: Wire `Re-shuffle` button**

Inside the `initLadderSetupInputs` IIFE you added in Task 2, add:

```js
const reshuffleBtn = document.getElementById('ladderReshuffleBtn');
if (reshuffleBtn) {
  reshuffleBtn.addEventListener('click', function() {
    ladderConfig.manualAssignment =
      randomGenderBalancedAssignment(getLadderGenders(), ladderConfig.numCourts);
    document.getElementById('ladderResizeBanner').style.display = 'none';
    buildLadderCourtAssignments();
    saveLadderState();
  });
}
```

- [ ] **Step 4: Show the resize banner on court count changes; rebuild the card**

In `setLadderNumCourts`, after the line `ladderConfig.manualAssignment = null;`, also clear & re-show the banner. Replace that block (everything from `ladderConfig.manualAssignment = null;` to the end of the function) with:

```js
ladderConfig.manualAssignment = null;

buildLadderPlayerGrid();
buildLadderCourtInputs();
buildLadderCourtAssignments();
const banner = document.getElementById('ladderResizeBanner');
if (banner) banner.style.display = '';
updateLadderSetupMessage();
saveLadderState();
return true;
```

- [ ] **Step 5: Build the card on mode entry, restore, and after court-number edits**

Add `buildLadderCourtAssignments();` at the same call sites where you added `buildLadderCourtInputs();` in Task 3:

- In the modeLadder listener in `js/state.js`, after `buildLadderCourtInputs();`.
- In `restoreLadderState`, after `buildLadderCourtInputs();`.

In the `input` handler inside `buildLadderCourtInputs` (Step 2 of Task 3), after `updateLadderSetupMessage();`, also call `buildLadderCourtAssignments();` so the column headers re-label when the user edits a court number.

- [ ] **Step 6: Live-update chip names and gender badges**

Find the player-input `'input'` handler inside `buildLadderPlayerGrid` (it currently updates `ladderState.names[idx]`). At the very end of that handler, before `saveLadderPlayerData();`, add a small call to refresh chips:

```js
debounce('ladderAssignChips', () => buildLadderCourtAssignments(), 80);
```

Find the gender-radio handlers below it:

```js
document.getElementById(`lg${i}m`).addEventListener('change', () => saveLadderPlayerData());
document.getElementById(`lg${i}f`).addEventListener('change', () => saveLadderPlayerData());
```

Replace with:

```js
document.getElementById(`lg${i}m`).addEventListener('change', () => {
  saveLadderPlayerData();
  buildLadderCourtAssignments();
});
document.getElementById(`lg${i}f`).addEventListener('change', () => {
  saveLadderPlayerData();
  buildLadderCourtAssignments();
});
```

- [ ] **Step 7: Manual verification**

Open the page in Ladder mode. Verify:

- "Court Assignments" card appears after Players, with 5 columns left-to-right: "Court 9 (Top)", "Court 8", "Court 7", "Court 3", "Court 2 (Bottom)".
- Each column has 4 unstyled chips (styling comes in Task 7) showing player names + M/F badges.
- Click Fill Random Names: the chips update to show the new names.
- Toggle one player from M to F: that chip's badge updates.
- Click Re-shuffle: the chips reshuffle into different positions. Each player still appears exactly once across all courts.
- Change Number of Courts to 6: the card rebuilds with 6 columns, the resize banner appears.
- Click Re-shuffle: the banner disappears.
- Edit a court number in the Court Numbers card (e.g., 9 → 11): the corresponding column header updates to "Court 11 (Top)".

- [ ] **Step 8: Commit**

```bash
git add index.html js/ladder.js js/state.js
git commit -m "Render Court Assignments card with player chips per court"
```

---

## Task 6: Add drag-and-drop swap behavior

Wires HTML5 drag-and-drop on the chips so dropping one chip onto another swaps their positions in `ladderConfig.manualAssignment`.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add drag event handlers inside `buildLadderCourtAssignments`**

After the chip is fully constructed in `buildLadderCourtAssignments` (just before `col.appendChild(chip);`), add:

```js
chip.addEventListener('dragstart', function(e) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain',
    `${this.dataset.courtIdx}:${this.dataset.slotIdx}`);
  this.classList.add('dragging');
});
chip.addEventListener('dragend', function() {
  this.classList.remove('dragging');
  document.querySelectorAll('.ladder-chip.drag-over')
    .forEach(el => el.classList.remove('drag-over'));
});
chip.addEventListener('dragover', function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
});
chip.addEventListener('dragleave', function() {
  this.classList.remove('drag-over');
});
chip.addEventListener('drop', function(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const data = e.dataTransfer.getData('text/plain');
  if (!data) return;
  const [srcCourt, srcSlot] = data.split(':').map(Number);
  const dstCourt = parseInt(this.dataset.courtIdx);
  const dstSlot = parseInt(this.dataset.slotIdx);
  if (srcCourt === dstCourt && srcSlot === dstSlot) return;
  const a = ladderConfig.manualAssignment[srcCourt][srcSlot];
  const b = ladderConfig.manualAssignment[dstCourt][dstSlot];
  ladderConfig.manualAssignment[srcCourt][srcSlot] = b;
  ladderConfig.manualAssignment[dstCourt][dstSlot] = a;
  document.getElementById('ladderResizeBanner').style.display = 'none';
  buildLadderCourtAssignments();
  saveLadderState();
});
```

- [ ] **Step 2: Manual verification**

Open the page in Ladder mode. Verify:

- Drag a chip from Court 9 onto a chip in Court 2. They swap. Both columns still have exactly 4 chips.
- Refresh the page: assignments are persisted (because `saveLadderState` runs on swap).
- Drag a chip onto itself: nothing happens.
- Drag and release on empty space (outside any chip): chip returns to original position.
- The dragged chip should look semi-transparent during drag (CSS comes in Task 7, but the `dragging` class is already applied).
- Click Re-shuffle: assignments randomize again.

- [ ] **Step 3: Commit**

```bash
git add js/ladder.js
git commit -m "Add drag-and-drop swap on ladder court assignment chips"
```

---

## Task 7: Style the Court Assignments card and chips

Adds CSS for the column layout, chips, and drag interactions.

**Files:**
- Modify: `css/styles.css`

- [ ] **Step 1: Append the new styles**

At the end of `css/styles.css`, before the final `}` of the outermost block (or at file end if there's no wrapper), append:

```css
.ladder-assignments {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}
.ladder-assignment-court {
  background: #1a1d24;
  border: 1px solid #252830;
  border-radius: 12px;
  padding: 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 1px;
}
.ladder-assignment-head {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9ca3af;
  text-align: center;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid #252830;
  margin-bottom: 0.2rem;
}
.ladder-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  background: #1e2028;
  border: 1px solid #2a2d37;
  border-radius: 8px;
  font-size: 0.78rem;
  cursor: grab;
  user-select: none;
  transition: all 0.15s ease;
}
.ladder-chip:hover { border-color: #383c48; background: #22252e; }
.ladder-chip:active { cursor: grabbing; }
.ladder-chip.dragging { opacity: 0.4; }
.ladder-chip.drag-over {
  border-color: #818cf8;
  box-shadow: 0 0 0 2px rgba(129,140,248,0.25);
  background: #232636;
}
.ladder-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.ladder-chip-gender {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  flex-shrink: 0;
}
.ladder-chip-gender.g-m {
  background: rgba(129,140,248,0.15);
  color: #a5b4fc;
}
.ladder-chip-gender.g-f {
  background: rgba(244,114,182,0.15);
  color: #f9a8d4;
}
.ladder-setup-locked .ladder-chip { cursor: not-allowed; opacity: 0.6; }
.ladder-setup-locked .ladder-chip:hover { border-color: #2a2d37; background: #1e2028; }
```

- [ ] **Step 2: Manual verification**

Open the page in Ladder mode. Verify:

- The Court Assignments card shows tidy columns with header bars, each with 4 chips.
- Chip text is clipped with ellipsis if a name is very long.
- M chips show a soft purple badge; F chips show a pink badge.
- During drag: dragged chip becomes semi-transparent; hovering over another chip highlights it with a purple border and faint glow.
- Layout collapses gracefully on a narrow window (chips wrap, columns shrink).

- [ ] **Step 3: Commit**

```bash
git add css/styles.css
git commit -m "Style ladder Court Assignments card and drag-and-drop chips"
```

---

## Task 8: Lock setup during an active ladder

When a ladder is in progress (`ladderState !== null`), all setup inputs (court count, court numbers, drag) become read-only. The user must Reset Ladder to change them. Player names stay editable for live substitution.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Add `applyLadderSetupLock` helper**

Add near the other helpers in `js/ladder.js`:

```js
function applyLadderSetupLock() {
  const locked = !!ladderState;
  const numCourtsEl = document.getElementById('ladderNumCourts');
  if (numCourtsEl) numCourtsEl.disabled = locked;
  for (let i = 0; i < ladderConfig.numCourts; i++) {
    const el = document.getElementById(`ladderCourt${i}`);
    if (el) el.disabled = locked;
  }
  const reshuffleBtn = document.getElementById('ladderReshuffleBtn');
  if (reshuffleBtn) reshuffleBtn.disabled = locked;
  const container = document.getElementById('ladderCourtAssignments');
  if (container) {
    container.classList.toggle('ladder-setup-locked', locked);
    container.querySelectorAll('.ladder-chip').forEach(chip => {
      chip.draggable = !locked;
    });
  }
}
```

- [ ] **Step 2: Call `applyLadderSetupLock` from key state-change sites**

Call `applyLadderSetupLock();` at the end of:

- `ladderStart` (after `saveLadderState();`).
- `ladderReset` (after `buildLadderPlayerGrid();`).
- `restoreLadderState` (at the very end, after the `if (ladderState) { ... }` block).
- `buildLadderCourtAssignments` (at the very end of the function, so re-renders preserve the lock state).

- [ ] **Step 3: Manual verification**

Open the page, fill names, click Start Ladder. Verify:

- Number of Courts input is disabled.
- All Court Numbers inputs are disabled.
- Re-shuffle button is disabled.
- Chips are not draggable; they appear dimmed (`not-allowed` cursor).
- Player names are still editable, and live-substitution still works.
- Click Reset Ladder, confirm. Verify everything is editable again.

- [ ] **Step 4: Commit**

```bash
git add js/ladder.js
git commit -m "Lock ladder setup inputs while a ladder is active"
```

---

## Task 9: Persistence for `ladderConfig`

Save and restore the new `ladderConfig` (numCourts, courtNumbers, manualAssignment). Backward-compatible with old saved blobs.

**Files:**
- Modify: `js/ladder.js`

- [ ] **Step 1: Update `saveLadderState`**

Replace the existing `saveLadderState`:

```js
function saveLadderState() {
  const state = {
    ladderPlayerData,
    ladderConfig: {
      numCourts: ladderConfig.numCourts,
      courtNumbers: [...ladderConfig.courtNumbers],
      manualAssignment: ladderConfig.manualAssignment
        ? ladderConfig.manualAssignment.map(arr => [...arr])
        : null,
    },
    preferMixed: true,
    ladderState: ladderState ? { ...ladderState } : null,
    mode: document.getElementById('modeLadder').checked ? 'ladder' : 'rr',
  };
  try { localStorage.setItem(LADDER_STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}
```

- [ ] **Step 2: Update `restoreLadderState`**

Replace `restoreLadderState`:

```js
function restoreLadderState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(LADDER_STORAGE_KEY)); } catch(e) {}
  if (!state) return;

  ladderPlayerData = state.ladderPlayerData || [];
  if (state.ladderConfig
      && typeof state.ladderConfig.numCourts === 'number'
      && Array.isArray(state.ladderConfig.courtNumbers)
      && state.ladderConfig.numCourts >= 1
      && state.ladderConfig.numCourts <= 10
      && state.ladderConfig.courtNumbers.length === state.ladderConfig.numCourts) {
    ladderConfig = {
      numCourts: state.ladderConfig.numCourts,
      courtNumbers: [...state.ladderConfig.courtNumbers],
      manualAssignment: Array.isArray(state.ladderConfig.manualAssignment)
        ? state.ladderConfig.manualAssignment.map(arr => [...arr])
        : null,
    };
  }
  if (state.ladderState) ladderState = state.ladderState;

  if (state.mode === 'ladder') {
    document.getElementById('modeLadder').checked = true;
    setMode('ladder');
    document.getElementById('ladderNumCourts').value = ladderConfig.numCourts;
    buildLadderPlayerGrid();
    buildLadderCourtInputs();
    buildLadderCourtAssignments();
    updateLadderSetupMessage();
    if (ladderState) {
      document.getElementById('ladderOutput').style.display = 'block';
      renderLadderCurrentRound();
      renderLadderLeaderboard();
      renderLadderHistory();
    }
  }
  applyLadderSetupLock();
}
```

- [ ] **Step 3: Reset `ladderConfig` on `ladderReset`**

Update `ladderReset`:

```js
function ladderReset() {
  if (!confirm('Reset the ladder? All results will be cleared.')) return;
  clearLadderState();
  ladderState = null;
  ladderPlayerData = [];
  ladderConfig.manualAssignment = null;
  document.getElementById('ladderOutput').style.display = 'none';
  buildLadderPlayerGrid();
  buildLadderCourtInputs();
  buildLadderCourtAssignments();
  updateLadderSetupMessage();
  applyLadderSetupLock();
}
```

Note: we keep `numCourts` and `courtNumbers` from the user's config — only clear the manual assignment so a fresh re-shuffle happens on the next render.

- [ ] **Step 4: Save state on drag-swap and re-shuffle**

Both already call `saveLadderState();` (added in Tasks 5/6) — verify those calls remain.

- [ ] **Step 5: Manual verification**

- Open page, switch to Ladder, change Number of Courts to 6, change court 4 number, drag two chips to swap. Refresh. Verify all settings restore: 6 courts, the edited court number, and the swapped assignment.
- Open the developer console, run `localStorage.removeItem('powerplay_pickleball_ladder_state')`, refresh. Verify the ladder defaults back to 5 courts with `[2, 3, 7, 8, 9]`.
- Open page in Ladder mode, configure 7 courts, click Start Ladder, complete a round, refresh. Verify the active ladder restores with the same court layout and locked setup.

- [ ] **Step 6: Commit**

```bash
git add js/ladder.js
git commit -m "Persist ladderConfig (numCourts, courtNumbers, manualAssignment)"
```

---

## Task 10: Update README

Reflect the new flexibility in the Traditional Ladder section.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Traditional Ladder Mode bullets**

In `README.md`, find the "Traditional Ladder Mode" section:

```20:23:README.md
### Traditional Ladder Mode
- 20 players across 5 courts with winners moving up and losers moving down
- Score validation for standard pickleball scoring
- Full round history and leaderboard
```

Replace with:

```markdown
### Traditional Ladder Mode
- **Configurable layout** — pick 1–10 courts (4 players per court) and customize each court number
- **Manual or random initial assignment** — drag players between courts to set starting positions, or click Re-shuffle for a gender-balanced random layout
- Winners move up, losers move down each round
- Score validation for standard pickleball scoring
- Full round history and leaderboard
```

- [ ] **Step 2: Manual verification**

Open `README.md` in a viewer (or `cat` it). Confirm the bullets read clearly and reflect the new behavior.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Update README for configurable ladder setup"
```

---

## Task 11: Bump version

Bump the in-page `APP_VERSION` so the cache-busting query string forces a fresh CSS/JS download for users who already had the page cached.

**Files:**
- Modify: `index.html`
- Modify: `package.json`

- [ ] **Step 1: Bump `APP_VERSION` in `index.html`**

Find:

```13:13:index.html
<script>const APP_VERSION = "2.3.4";</script>
```

Change `"2.3.4"` to `"2.4.0"` (minor bump for new feature).

- [ ] **Step 2: Bump `version` in `package.json`**

Change `"version": "2.3.2"` to `"version": "2.4.0"` to keep package metadata aligned with the displayed version.

- [ ] **Step 3: Run the existing test suite to make sure round-robin still works**

```bash
npm test
```

Expected: all tests pass (this change should not affect round-robin scheduling at all). If anything fails, the regression came from this work — investigate before proceeding.

- [ ] **Step 4: Final end-to-end manual verification**

Open the page in a fresh browser tab (or hard-refresh). Walk through the full feature:

1. Switch to Traditional Ladder mode.
2. Set Number of Courts to 4. Verify 16 players, 4 columns.
3. Set court numbers to 5, 4, 2, 1 (top-to-bottom).
4. Click Fill Random Names.
5. Drag 2 players to swap them. Verify visual feedback and final positions.
6. Click Start Ladder. Verify the round renders with courts 5, 4, 2, 1 (highest first) and the players you placed on each court.
7. Verify all setup is locked (greyed out, non-draggable).
8. Complete the round. Verify movement (winners up, losers down) works.
9. Click Reset Ladder. Verify setup is editable again, the manual assignment is gone (re-shuffled).
10. Refresh the page. Verify all settings persist (court count, court numbers).

- [ ] **Step 5: Commit**

```bash
git add index.html package.json
git commit -m "v2.4.0: Configurable Traditional Ladder setup"
```

---

## Self-Review (already complete)

**Spec coverage:**
- Custom number of courts → Task 2 (`Number of Courts` input + handler).
- Custom number of players → Task 2 (read-only derived display); validation in Task 3 (player names) and Task 8 (lock during active ladder).
- Custom court numbers → Task 3 (Court Numbers card + validation).
- Updated setup message → Task 2 (`updateLadderSetupMessage`) and refined in Task 3 once court inputs exist.
- Manual court assignment with drag-and-drop → Tasks 5, 6, 7 (markup, drag wiring, styling).
- Re-shuffle button → Task 5.
- Court count change behavior (confirm dialog, full re-shuffle, banner) → Tasks 2, 5.
- Locked setup during active ladder → Task 8.
- Persistence with backward compat → Task 9.
- README + version bump → Tasks 10, 11.
- The two-helper refactor (`randomGenderBalancedAssignment`, `pairTeamsForAssignment`) → Task 4.

**Placeholder scan:** all steps include the actual code or exact CSS to write. No "TBD", no "similar to above", no "add validation here".

**Type/name consistency:**
- `ladderConfig` shape: `{ numCourts, courtNumbers, manualAssignment }` — used consistently across Tasks 1, 2, 3, 4, 5, 6, 9.
- Element IDs: `ladderNumCourts`, `ladderNumPlayersDisplay`, `ladderSetupMessage`, `ladderCourtInputs`, `ladderCourt${i}`, `ladderCourtAssignments`, `ladderResizeBanner`, `ladderReshuffleBtn`, `ladderPlayersCardTitle` — all defined in their respective tasks and referenced consistently.
- Function names: `getLadderCourts`, `getLadderPlayerCount`, `setLadderNumCourts`, `updateLadderSetupMessage`, `buildLadderCourtInputs`, `buildLadderCourtAssignments`, `ensureLadderAssignment`, `randomGenderBalancedAssignment`, `pairTeamsForAssignment`, `applyLadderSetupLock` — used consistently across tasks.
- CSS classes: `ladder-assignments`, `ladder-assignment-court`, `ladder-assignment-head`, `ladder-chip`, `ladder-chip-name`, `ladder-chip-gender`, `ladder-chip-gender.g-m`, `ladder-chip-gender.g-f`, `ladder-chip.dragging`, `ladder-chip.drag-over`, `ladder-setup-locked` — defined in Task 7, referenced in Tasks 5, 6, 8.

---

## Execution Handoff

After saving the plan, two execution options are available:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Pick whichever you prefer when ready.
