# Round Robin Smooth Transition + Completed Divider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate the Round Robin round-advance reorder with the View Transitions API, and add a muted "Completed · N rounds" divider marking where played rounds begin.

**Architecture:** Two independent pieces. (1) A `.rounds-divider` element emitted by `renderSchedule`, slotted at `order: 1` with completed rounds moving to `order: 2`, shown by a chained `:has()` rule and counted by JS. (2) `document.startViewTransition()` wrapping only the class-toggling loop in `updateRoundStates()`, gated on the current round actually changing, with per-card `view-transition-name` and asymmetric animations — the arriving current round morphs positionally, the completing round cross-fades to avoid a 2000px+ travel.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step, no dependencies. View Transitions API and CSS `:has()`, both feature-detected or naturally inert where unsupported. Verification uses headless Google Chrome over the Chrome DevTools Protocol driven from Node's built-in global `WebSocket` (no npm packages).

**Spec reference:** `docs/superpowers/specs/2026-07-24-rr-round-transition-and-completed-divider-design.md`

## Global Constraints

- Files you may modify: `css/styles.css`, `js/schedule-ui.js`, `index.html` (version only), `package.json` (version only), `README.md`. Nothing else. In particular do not touch `js/schedule.js`, `js/utils.js`, `js/state.js`, or `js/ladder.js`.
- Traditional Ladder mode must be visually and behaviourally unaffected. Scope every new CSS rule to `#scheduleSection`.
- Printed / exported PDF output must keep strict numeric round order 1..N and must not show the divider. `@media print` already sets `#scheduleSection { display: block }` at `css/styles.css:833`, which makes `order` inert — do not remove that.
- Mobile (≤640px) must not regress. Do **not** add any rule setting a width on `.ladder-score-input`; the `@media (max-width: 640px)` block sets `width: 100%` there and an ID-scoped selector would silently override it and break a 44px tap target.
- Browsers without `document.startViewTransition` must get exactly today's instant behaviour. Feature-detect; no polyfill.
- `prefers-reduced-motion: reduce` must disable the new animations. The stylesheet has no reduced-motion rules today — scope the new ones to these new animations only, do not retrofit the whole file.
- The schedule's DOM order must stay numeric 1..N. Ordering remains CSS-only; do not reorder in JS.
- `APP_VERSION` in `index.html` and `version` in `package.json` must both read `2.12.0` and match exactly. `APP_VERSION` is the cache-buster on every JS and CSS URL — without the bump returning visitors keep the old assets.
- `npm test` must exit 0. Expect `3631 passed, 0 failed`, `89 passed, 0 failed`, `40 passed, 0 failed`. It does not cover layout; it is a regression check that nothing else broke.

---

## File Structure

| File | Role |
|---|---|
| `css/styles.css` | Divider styling, the `order` shift, the `:has()` visibility rule, print suppression, view-transition animations, reduced-motion guard. |
| `js/schedule-ui.js` | Emit the divider element and per-card `view-transition-name` in `renderSchedule`; set the divider count and wrap the class-toggle loop in `startViewTransition` in `updateRoundStates`. |
| `index.html` / `package.json` | Version bump to `2.12.0`. |
| `README.md` | One bullet. |
| `/tmp/anim-verify.mjs` | Throwaway CDP harness. Not committed. |

---

### Task 1: Completed-rounds divider

Deliberately first and standalone: it is assertable by measurement, unlike the animation, so it can be fully verified before any motion work lands.

**Files:**
- Modify: `css/styles.css:310` (change completed rounds to `order: 2`, add divider rules after)
- Modify: `css/styles.css` `@media print` block near line 833 (suppress the divider)
- Modify: `js/schedule-ui.js:1036` (emit the divider element)
- Modify: `js/schedule-ui.js` inside `updateRoundStates` (set the count text)

**Interfaces:**
- Consumes: existing classes `.round-completed` / `.current-round` toggled by `updateRoundStates` (`js/schedule-ui.js:907-914`); the flex container `#scheduleSection` (`css/styles.css:306`).
- Produces: a DOM element `<div id="roundsDivider" class="rounds-divider">` with a child `<span class="rounds-divider-text">` whose textContent JS sets. Task 2 does not depend on this, but must not break it.

- [ ] **Step 1: Confirm the anchors before editing**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
sed -n '306,310p' css/styles.css
sed -n '1035,1036p' js/schedule-ui.js
grep -n "scheduleSection { display: block" css/styles.css
```

Expected:

```
  #scheduleSection { display: flex; flex-direction: column; }
  #scheduleSection .schedule-header { order: -3; }
  #scheduleSection #currentRoundBanner { order: -2; }
  #scheduleSection .round.current-round { order: -1; }
  #scheduleSection .round.round-completed { order: 1; }
  let html = `<div class="schedule-header"><h2>Schedule</h2></div>`;
  html += '<div id="currentRoundBanner" class="current-round-banner"></div>';
833:    #scheduleSection { display: block; }
```

If any line differs, STOP and report BLOCKED with the actual output. Do not guess replacement line numbers.

- [ ] **Step 2: Shift completed rounds to order 2 and add the divider slot**

In `css/styles.css`, change the line

```css
  #scheduleSection .round.round-completed { order: 1; }
```

to

```css
  /* order 1 is the divider's slot; completed rounds sit below it. `order` takes
     integers only, so there is no value between the upcoming block (0) and the
     divider — completed rounds move down to 2 instead. */
  #scheduleSection .rounds-divider { order: 1; }
  #scheduleSection .round.round-completed { order: 2; }
```

- [ ] **Step 3: Add the divider's own styling and visibility rule**

Add immediately after the block from Step 2:

```css
  /* Mirrors .current-round-banner (see above) but muted, and with no pulsing
     dot, so it reads as the same family of UI without competing with the
     active-round banner for attention. */
  .rounds-divider {
    display: none;
    background: rgba(255,255,255,0.02);
    border: 1px solid #252830; border-radius: 12px;
    padding: 0.7rem 1.25rem; margin-bottom: 1.25rem;
    align-items: center; gap: 0.6rem;
  }
  .rounds-divider-check { color: #6ee7b7; font-size: 0.85rem; font-weight: 700; }
  .rounds-divider-text { font-size: 0.82rem; font-weight: 600; color: #7c8091; }
  /* Shown only when there is something to separate AND rounds still to play.
     "All rounds complete" is exactly the state with no .current-round, so the
     second :has() suppresses the divider there — the main banner already says
     "All N rounds complete" and a header beneath it would be redundant. */
  #scheduleSection:has(.round.round-completed):has(.round.current-round)
    .rounds-divider { display: flex; }
```

- [ ] **Step 4: Suppress the divider in print**

Inside the `@media print` block, immediately after the `#scheduleSection { display: block; }` line, add:

```css
    /* Print restores numeric order 1..N, so a divider sitting at its DOM
       position would claim rounds are grouped when they are not. */
    #scheduleSection .rounds-divider { display: none !important; }
```

- [ ] **Step 5: Emit the divider element in renderSchedule**

In `js/schedule-ui.js`, immediately after the line

```javascript
  html += '<div id="currentRoundBanner" class="current-round-banner"></div>';
```

add:

```javascript
  // Sits between the upcoming and completed blocks via order: 1. CSS decides
  // whether it is visible; updateRoundStates fills in the count.
  html += '<div id="roundsDivider" class="rounds-divider">' +
    '<span class="rounds-divider-check">✓</span>' +
    '<span class="rounds-divider-text"></span></div>';
```

- [ ] **Step 6: Set the count text in updateRoundStates**

In `js/schedule-ui.js`, inside `updateRoundStates`, immediately **after** the `for` loop that toggles the round classes closes and **before** the `renderLeaderboard();` call, add:

```javascript
  // Count after the toggles above, so this reflects the state just applied.
  const dividerText = document.querySelector('#roundsDivider .rounds-divider-text');
  if (dividerText) {
    let doneCount = 0;
    for (let i = 1; i <= totalRounds; i++) if (isRoundComplete(i)) doneCount++;
    dividerText.textContent = 'Completed · ' + doneCount +
      (doneCount === 1 ? ' round' : ' rounds');
  }
```

- [ ] **Step 7: Verify syntax and the suite**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
for f in js/*.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done && echo "all js parse"
python3 -c "s=open('css/styles.css').read(); print('braces', s.count('{'), s.count('}'), 'balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
grep -n "rounds-divider { order\|round-completed { order\|rounds-divider { display: none !important" css/styles.css
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
```

Expected: all js parse; braces balanced; the three greps each hit once; `npm test` exit 0 with `3631`/`89`/`40`; `git diff --name-only` lists only `css/styles.css` and `js/schedule-ui.js`.

- [ ] **Step 8: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add css/styles.css js/schedule-ui.js
git commit -m "Add a completed-rounds divider to the Round Robin schedule

Slot the divider at order 1 and move completed rounds to order 2. Visibility
is a chained :has() so it appears only when there is something to separate and
rounds remain to play; 'all complete' has no .current-round, so the same rule
suppresses it there. Hidden in print, where order is inert and rounds print
numerically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Animate the round-advance reorder

**Files:**
- Modify: `js/schedule-ui.js:1038` area (add `view-transition-name` to each card)
- Modify: `js/schedule-ui.js:877-930` (`updateRoundStates`: capture the previous round, wrap the toggle loop)
- Modify: `css/styles.css` (view-transition animations + reduced-motion guard)

**Interfaces:**
- Consumes: `.round` cards with `id="round-N"` emitted by `renderSchedule`; the module-level `rrCurrentRound` and the local `currentRound` computed at the top of `updateRoundStates`; the divider from Task 1 (must keep working).
- Produces: each card carries `style="view-transition-name: rr-round-<N>"`. No new exported function.

- [ ] **Step 1: Confirm the anchors**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
sed -n '1038p' js/schedule-ui.js
sed -n '887p;891p' js/schedule-ui.js
grep -n "// Update round cards and team states" js/schedule-ui.js
```

Expected:

```
    html += `<div class="round" id="round-${round.round}">
  if (rrRoundTimer && rrCurrentRound !== null && currentRound !== rrCurrentRound) {
  rrCurrentRound = currentRound;
907:  // Update round cards and team states
```

Line numbers will have shifted by Task 1's edits — locate by content, not by number, and report what you actually found. If the content does not match, STOP and report BLOCKED.

- [ ] **Step 2: Give each card a view-transition-name**

Change the card-opening line in `renderSchedule` from

```javascript
    html += `<div class="round" id="round-${round.round}">
```

to

```javascript
    // A unique, stable view-transition-name lets the browser pair this card's
    // before/after snapshots and animate it individually when order changes.
    html += `<div class="round" id="round-${round.round}" style="view-transition-name:rr-round-${round.round}">
```

- [ ] **Step 3: Capture the previous round before it is overwritten**

`updateRoundStates` overwrites `rrCurrentRound` at the `rrCurrentRound = currentRound;` line. Add, immediately **before** the `// Auto-reset the round timer` comment block:

```javascript
  // Captured before rrCurrentRound is overwritten below: the reorder is worth
  // animating only when the current round actually moved. Initial render,
  // restoreState, and score edits that leave the round alone stay instant.
  const roundAdvanced = rrCurrentRound !== null && currentRound !== rrCurrentRound;
```

- [ ] **Step 4: Extract the toggle loop into a local function and wrap it**

Replace the whole `// Update round cards and team states` for-loop plus the divider-count block added in Task 1 Step 6 with this. The loop body is byte-identical to what is there now — only the wrapping changes:

```javascript
  // Update round cards and team states
  const applyRoundClasses = () => {
    for (let i = 1; i <= totalRounds; i++) {
      const el = document.getElementById(`round-${i}`);
      if (!el) continue;
      const done = isRoundComplete(i);
      el.classList.toggle('round-completed', done);
      el.classList.toggle('current-round', i === currentRound);
      el.classList.toggle('round-future', currentRound !== null && i > currentRound);

      for (let c = 0; c < numCourtsInSchedule; c++) {
        const teamAEl = document.getElementById(`r${i}c${c}a`);
        const teamBEl = document.getElementById(`r${i}c${c}b`);
        if (!teamAEl || !teamBEl) continue;
        const winner = roundWinners[i] && roundWinners[i][c];
        teamAEl.classList.toggle('winner', winner === 'A');
        teamAEl.classList.toggle('loser', winner === 'B');
        teamBEl.classList.toggle('winner', winner === 'B');
        teamBEl.classList.toggle('loser', winner === 'A');
      }
    }

    // Count after the toggles above, so this reflects the state just applied.
    const dividerText = document.querySelector('#roundsDivider .rounds-divider-text');
    if (dividerText) {
      let doneCount = 0;
      for (let i = 1; i <= totalRounds; i++) if (isRoundComplete(i)) doneCount++;
      dividerText.textContent = 'Completed · ' + doneCount +
        (doneCount === 1 ? ' round' : ' rounds');
    }
  };

  // Animate only a real round change, and only where the API exists. Everything
  // else — first paint, restore, editing a score without finishing a round —
  // applies instantly, exactly as before.
  if (roundAdvanced && document.startViewTransition) {
    document.startViewTransition(applyRoundClasses);
  } else {
    applyRoundClasses();
  }
```

- [ ] **Step 5: Add the view-transition animations**

Append to `css/styles.css`, at the very end of the file (outside every media query):

```css
  /* --- Round-advance transition -----------------------------------------
     Suppress the whole-page cross-fade so only the round cards animate; the
     banner, timer and leaderboard update instantly as they always have. */
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }

  /* The arriving current round travels about one card height, so a genuine
     positional morph reads well. This is the API default; stated explicitly
     for the duration and easing. */
  ::view-transition-group(*) {
    animation-duration: 350ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Reduced motion: apply the change with no animation at all. */
  @media (prefers-reduced-motion: reduce) {
    ::view-transition-group(*),
    ::view-transition-old(*),
    ::view-transition-new(*) { animation: none !important; }
  }
```

Note on the completing card: the spec calls for it to cross-fade rather than travel 2000px+. Whether the default group morph already looks acceptable, or the completing card needs its own opacity-only override, is a judgement that must be made while watching it — see Task 3 Step 4. Do not add a speculative override now.

- [ ] **Step 6: Verify syntax and the suite**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
for f in js/*.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done && echo "all js parse"
python3 -c "s=open('css/styles.css').read(); print('braces', s.count('{'), s.count('}'), 'balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
grep -n "startViewTransition\|view-transition-name:rr-round\|prefers-reduced-motion" js/schedule-ui.js css/styles.css
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
```

Expected: all js parse; braces balanced; `startViewTransition` appears twice in `js/schedule-ui.js` (the guard and the call), `view-transition-name:rr-round` once, `prefers-reduced-motion` once in `css/styles.css`; `npm test` exit 0; only `css/styles.css` and `js/schedule-ui.js` modified.

- [ ] **Step 7: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add css/styles.css js/schedule-ui.js
git commit -m "Animate the Round Robin round-advance reorder

Wrap only the class-toggle loop in document.startViewTransition, gated on the
current round actually changing so first paint, restore and non-advancing
score edits stay instant. Each card carries a unique view-transition-name so
the browser animates cards individually; the page-level cross-fade is
suppressed. Feature-detected, and disabled under prefers-reduced-motion.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify in a real browser, then version and document

**Files:**
- Create: `/tmp/anim-verify.mjs` (throwaway, not committed)
- Modify: `index.html` (version), `package.json` (version), `README.md` (one bullet)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2, served over HTTP. App globals `generate`, `pickWinner`, `setRRScoringMode`; element ids `#output`, `#currentRoundBanner`, `#roundsDivider`, `#round-N`, `#numPlayers`, `#numCourts`, `#numRounds`, `#p0`..`#p15`.
- Produces: `2.12.0` in both version files; screenshots at `/tmp/anim-divider.png` and `/tmp/anim-mobile.png`.

- [ ] **Step 1: Start the server and headless Chrome**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
python3 -m http.server 8765 --bind 127.0.0.1 > /tmp/serve.log 2>&1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --no-first-run --no-default-browser-check \
  --user-data-dir=/tmp/pb-chrome-profile --hide-scrollbars about:blank > /tmp/chrome.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:8765/index.html | grep -o 'APP_VERSION = "[^"]*"'
curl -s http://127.0.0.1:9222/json/version | head -2
```

Expected: the version string prints, and the CDP JSON prints a `"Browser": "Chrome/..."` line. If CDP does not answer, `cat /tmp/chrome.log`.

- [ ] **Step 2: Write the harness**

Create `/tmp/anim-verify.mjs`:

```javascript
// Asserts divider placement/visibility by measured position. Node >=22 has a
// global WebSocket, so this speaks CDP with zero dependencies.
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8765/index.html';

const t = await (await fetch(`${CDP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pend.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description));
  return r.result.value;
};
let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

await send('Page.enable'); await send('Runtime.enable');

const NAMES = ['Ravi','Rene W','Chandler','Dina','Kevin M','T','Kevin Savage','Hazel',
               'Matt','Leanne','Iopu','Amy','Phil','Rob','Cyndi','Yolie'];

async function boot(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 900));
  await ev('localStorage.clear()');
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 1200));
  await ev(`(() => {
    const fire = (el, ty) => el.dispatchEvent(new Event(ty, { bubbles: true }));
    const set = (i, v) => { const el = document.getElementById(i); el.value = v; fire(el, 'input'); };
    set('numPlayers', 16); set('numCourts', 3); set('numRounds', 10);
    ${JSON.stringify(NAMES)}.forEach((n, i) => { const el = document.getElementById('p' + i); el.value = n; fire(el, 'input'); });
  })()`);
  await ev('generate()');
  for (let i = 0; i < 60; i++) {
    if (await ev(`document.getElementById('output').style.display`) === 'block') break;
    await new Promise(r => setTimeout(r, 250));
  }
}

// pickWinner() is a TOGGLE — calling it on a team that already won clears it.
// Check state first so this is safe over an overlapping range.
const completeRange = (from, to) => ev(`(() => {
  for (let r = ${from}; r <= ${to}; r++) for (let c = 0; c < 3; c++) {
    const cur = roundWinners[r] && roundWinners[r][c];
    if (cur !== 'A') pickWinner(r, c, 'A');
  }
})()`);

const geom = () => ev(`(() => {
  const y = el => Math.round(el.getBoundingClientRect().y + window.scrollY);
  const d = document.getElementById('roundsDivider');
  const shown = d ? getComputedStyle(d).display !== 'none' : false;
  const rounds = [];
  for (let r = 1; r <= 10; r++) {
    const el = document.getElementById('round-' + r);
    if (el) rounds.push({ round: r, y: y(el) });
  }
  rounds.sort((a, b) => a.y - b.y);
  return {
    dividerShown: shown,
    dividerY: shown ? y(d) : null,
    dividerText: d ? d.textContent.trim() : null,
    visualOrder: rounds.map(r => r.round),
    rounds,
  };
})()`);

console.log('\nDesktop 1100px — fresh schedule, nothing completed');
await boot(1100, 1400, false);
let g = await geom();
check('divider hidden with zero completed rounds', g.dividerShown === false, `shown=${g.dividerShown}`);
check('rounds still numeric', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);

console.log('\nDesktop 1100px — rounds 1-3 complete');
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('divider visible', g.dividerShown === true);
check('divider count reads 3 rounds', /Completed\s*·\s*3 rounds/.test(g.dividerText), `text ${JSON.stringify(g.dividerText)}`);
check('round 4 still pinned first', g.visualOrder[0] === 4, `order ${g.visualOrder}`);
check('divider sits below the last upcoming round (10)',
  g.dividerY > g.rounds.find(r => r.round === 10).y, `divider ${g.dividerY}`);
check('divider sits above the first completed round (1)',
  g.dividerY < g.rounds.find(r => r.round === 1).y, `divider ${g.dividerY}`);
check('completed 1-3 last, numeric', JSON.stringify(g.visualOrder.slice(7)) === JSON.stringify([1,2,3]), `order ${g.visualOrder}`);

console.log('\nSingular wording — exactly one round complete');
await boot(1100, 1400, false);
await completeRange(1, 1);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('reads "1 round" not "1 rounds"', /Completed\s*·\s*1 round(?!s)/.test(g.dividerText), `text ${JSON.stringify(g.dividerText)}`);

await ev(`document.getElementById('currentRoundBanner').scrollIntoView({ block: 'start' })`);
await new Promise(r => setTimeout(r, 300));
let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync('/tmp/anim-divider.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/anim-divider.png');

console.log('\nAll rounds complete — divider must disappear');
await completeRange(2, 10);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('divider hidden when everything is complete', g.dividerShown === false, `shown=${g.dividerShown}`);
check('numeric order restored', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);

console.log('\nPrint emulation — divider hidden, numeric order');
await send('Emulation.setEmulatedMedia', { media: 'print' });
await boot(1100, 1400, false);
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('divider hidden in print', g.dividerShown === false, `shown=${g.dividerShown}`);
check('print keeps numeric order', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);
await send('Emulation.setEmulatedMedia', { media: '' });

console.log('\nView Transitions actually fire');
await boot(1100, 1400, false);
const fired = await ev(`(() => new Promise(resolve => {
  if (!document.startViewTransition) return resolve('unsupported');
  const orig = document.startViewTransition.bind(document);
  let calls = 0;
  document.startViewTransition = cb => { calls++; return orig(cb); };
  for (let c = 0; c < 3; c++) pickWinner(1, c, 'A');
  setTimeout(() => resolve(calls), 600);
}))()`);
check('startViewTransition called on a round advance', fired === 1 || fired === 'unsupported',
  `calls=${fired}`);
const notFired = await ev(`(() => new Promise(resolve => {
  if (!document.startViewTransition) return resolve('unsupported');
  const orig = document.startViewTransition.bind(document);
  let calls = 0;
  document.startViewTransition = cb => { calls++; return orig(cb); };
  pickWinner(5, 0, 'A');   // does not finish round 5, so the round must not advance
  setTimeout(() => resolve(calls), 600);
}))()`);
check('not called when the round does not advance', notFired === 0 || notFired === 'unsupported',
  `calls=${notFired}`);

console.log('\nReduced motion');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await boot(1100, 1400, false);
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('reduced motion still reorders correctly', g.visualOrder[0] === 4, `order ${g.visualOrder}`);
check('reduced motion still shows the divider', g.dividerShown === true);
await send('Emulation.setEmulatedMedia', { features: [] });

console.log('\nMobile 390px');
await boot(390, 844, true);
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 800));
g = await geom();
check('divider visible on mobile', g.dividerShown === true);
check('round 4 pinned on mobile', g.visualOrder[0] === 4, `order ${g.visualOrder}`);
await ev(`document.getElementById('currentRoundBanner').scrollIntoView({ block: 'start' })`);
await new Promise(r => setTimeout(r, 300));
shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
(await import('node:fs')).writeFileSync('/tmp/anim-mobile.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/anim-mobile.png');

console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness**

```bash
cd /tmp && node anim-verify.mjs
```

Expected: `19 passed, 0 failed`, exit 0. If the "not called when the round does not advance" check fails, the `roundAdvanced` gate is wrong — report it; do not weaken the assertion. If a print or all-complete check fails, the `:has()` rule or the print suppression is wrong.

- [ ] **Step 4: Watch the animation and tune it**

This step is the point of the task; do not skip it because the assertions passed.

Leave the server running. Open `http://127.0.0.1:8765/index.html` in a real browser, generate a 10-round schedule, and complete a round while watching. Judge:

1. Does the arriving current round slide up smoothly?
2. Does the completing round **rocket down the page**? If it visibly flies past the other rounds, give it an opacity-only animation instead of a positional morph, per the spec's asymmetric-motion requirement.

   The obstacle is that static CSS cannot name "whichever card is leaving", because its round number varies. Two routes, in order of preference:

   **(a) Rename the leaving card's transition name in JS** — portable, works wherever the API does. Before calling `startViewTransition`, find the card that is about to gain `.round-completed` and set `style.viewTransitionName = 'rr-leaving'`; restore it to `rr-round-<N>` when the transition's `finished` promise settles. Static CSS can then target it directly:
   ```css
   ::view-transition-old(rr-leaving),
   ::view-transition-new(rr-leaving) {
     animation-duration: 250ms;
     /* fade only — no positional morph */
   }
   ::view-transition-group(rr-leaving) { animation: none; }
   ```

   **(b) `view-transition-class`** — cleaner CSS, but it is a newer property with narrower support than the API itself, so it may silently do nothing.

   Try (a) first. Whichever you use, confirm in the browser that the card no longer travels; do not assume the CSS took effect.
3. Is 350ms right? Adjust if it feels sluggish or abrupt.

Report what you observed and what you changed. If you changed CSS, re-run Step 3 and commit the tuning separately with a message describing what you saw.

- [ ] **Step 5: Tear down**

```bash
pkill -f "http.server 8765"; pkill -f "pb-chrome-profile"
sleep 1; rm -rf /tmp/pb-chrome-profile /tmp/chrome.log /tmp/serve.log /tmp/anim-verify.mjs
curl -s -m 2 -o /dev/null http://127.0.0.1:8765/ && echo "STILL SERVING" || echo "server stopped"
```

Keep `/tmp/anim-divider.png` and `/tmp/anim-mobile.png` for the controller.

- [ ] **Step 6: Bump the version**

In `index.html`, change `APP_VERSION = "2.11.0"` to `APP_VERSION = "2.12.0"`. In `package.json`, change `"version": "2.11.0",` to `"version": "2.12.0",`. Minor bump: new user-visible behaviour.

- [ ] **Step 7: Add a README bullet**

Read the existing Round Robin feature list and match the surrounding bullet style exactly (the existing bullets have no trailing period). Add:

```markdown
- **Smooth round transitions** — finishing a round animates the reshuffle instead of snapping, and a "Completed · N rounds" divider marks where the played rounds begin
```

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -rn '2\.12\.0' package.json index.html
grep -rn '2\.11\.0' package.json index.html || echo "no stale version"
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
git add index.html package.json README.md
git commit -m "v2.12.0: Smooth round transitions and a completed-rounds divider

Bump APP_VERSION so returning visitors get the new assets instead of cached
copies, and document the behaviour in the README.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: exactly two `2.12.0` matches, no stale `2.11.0`, `npm test` exit 0, and `git diff --name-only` listing only `index.html`, `package.json`, `README.md`.

- [ ] **Step 9: Do not push**

Report to the controller instead. Pushing deploys to a live public site and needs the human partner's approval. Note that the spec commit `5b98f84` is also unpushed and will go out with this work.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Completing a round animates rather than snapping | Task 2 Steps 2-5 |
| Asymmetric motion: arriving morphs, completing fades | Task 2 Step 5 + Task 3 Step 4 (tuned while watching) |
| Gate on the round actually changing | Task 2 Step 3; asserted Task 3 Step 3 (both directions) |
| Feature-detect `startViewTransition` | Task 2 Step 4 |
| Respect `prefers-reduced-motion` | Task 2 Step 5; asserted Task 3 Step 3 |
| Suppress the root cross-fade | Task 2 Step 5 |
| Divider with count, mirroring the banner | Task 1 Steps 3, 5, 6 |
| `order`: divider 1, completed 2 | Task 1 Step 2 |
| Hide at zero-complete and all-complete via chained `:has()` | Task 1 Step 3; both asserted Task 3 Step 3 |
| Hide in print | Task 1 Step 4; asserted Task 3 Step 3 |
| Singular/plural count wording | Task 1 Step 6; asserted Task 3 Step 3 |
| DOM order stays numeric 1..N | Global Constraints; no JS reordering anywhere in the plan |
| Ladder unaffected | Global Constraints; every rule `#scheduleSection`-scoped |
| Version bump + README | Task 3 Steps 6-8 |

No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step carries literal CSS, JS, or shell. Task 3 Step 4 is intentionally open-ended about the *outcome* of watching the animation — that is a judgement that cannot be pre-decided from a spec — but it states concrete criteria, a starting CSS shape, and the requirement to report what was observed.

**Type consistency:** Names are consistent across tasks: element id `roundsDivider`, classes `rounds-divider` / `rounds-divider-check` / `rounds-divider-text`, `view-transition-name` values `rr-round-<N>`, the local `applyRoundClasses`, and the flag `roundAdvanced`. Task 2 Step 4 restates the divider-count block from Task 1 Step 6 verbatim inside the extracted function, because Task 2's implementer may not have read Task 1. Version `2.12.0` is used identically in Task 3 Steps 6 and 8.

**Known risk, flagged deliberately:** Task 2 Step 5 sets a duration on `::view-transition-group(*)`, a universal selector that also matches the divider and any other named group. Since only `.round` cards get names, the practical blast radius is the cards themselves — but if Task 3 Step 4 reveals unwanted animation on other elements, narrowing the selector is the fix.
