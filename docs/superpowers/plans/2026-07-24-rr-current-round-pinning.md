# Round Robin Current-Round Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Round Robin mode, always show the current round directly beneath the round timer at every viewport width, with rounds still to play next and completed rounds sunk to the bottom.

**Architecture:** Pure CSS flexbox `order`. `#scheduleSection` becomes a flex column so `order` applies to its children; the schedule header, timer banner, and current round get negative `order` values, and completed rounds get `order: 1`. `updateRoundStates()` in `js/schedule-ui.js` already toggles `.current-round` / `.round-completed` / `.round-future` on every state change, so the browser re-pins with zero JavaScript changes. Four of the five rules already exist inside `@media (max-width: 640px)` and are being promoted to the base stylesheet.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step, no dependencies. Verification uses headless Google Chrome driven over the Chrome DevTools Protocol from Node, using Node's built-in global `WebSocket` (no npm packages).

**Spec reference:** `docs/superpowers/specs/2026-07-24-rr-current-round-pinning-design.md`

## Global Constraints

- No JavaScript changes. `js/schedule-ui.js` and every other `js/*.js` file must be byte-identical when this plan completes.
- CSS only, in `css/styles.css`, plus a version bump and a README line.
- Traditional Ladder mode must be visually unaffected. Scope every new rule to `#scheduleSection`.
- Printed / exported PDF output must keep strict numeric round order 1..N.
- Mobile (≤640px) behaviour must not regress. Do **not** add any rule that sets a width on `.ladder-score-input`; the `@media (max-width: 640px)` block sets `width: 100%` there and an ID-scoped selector would silently override it.
- `APP_VERSION` in `index.html` and `version` in `package.json` must both be bumped to `2.11.0` and must match exactly. `APP_VERSION` is the cache-buster for every JS and CSS URL — without the bump, returning visitors keep the old stylesheet.
- The repo has no CSS test harness and `npm test` does not cover layout. `npm test` must still exit 0 (3631 + 89 + 40 assertions passing) as a regression check that nothing else broke.

---

## File Structure

| File | Role |
|---|---|
| `css/styles.css` | All layout changes. Base-stylesheet ordering rules (new), removal of the duplicated `@media (max-width: 640px)` copies, and a print-order reset. |
| `index.html` | `APP_VERSION` bump only. |
| `package.json` | `version` bump only. |
| `README.md` | One line documenting the pinning behaviour. |
| `/tmp/pin-verify.mjs` | Throwaway CDP verification harness. Not committed. |

---

### Task 1: Promote ordering rules to the base stylesheet and sink completed rounds

**Files:**
- Modify: `css/styles.css:293` (insert after the `.round.round-future` rule)
- Modify: `css/styles.css:695-700` (delete the promoted duplicates from the mobile block)
- Modify: `css/styles.css:815` (add print reset after `#scheduleSection { order: 1; }`)

**Interfaces:**
- Consumes: the existing classes `.current-round`, `.round-completed`, `.round-future` toggled by `updateRoundStates()` at `js/schedule-ui.js:911-914`, and the element ids `#scheduleSection`, `#currentRoundBanner`, plus the class `.schedule-header`.
- Produces: no JS-visible interface. Later tasks rely only on the rules landing in the base stylesheet rather than inside a media query.

- [ ] **Step 1: Confirm the starting state so the edits land in the right place**

Run:

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
sed -n '293p' css/styles.css
sed -n '695,700p' css/styles.css
sed -n '815p' css/styles.css
```

Expected output, in order:

```
  .round.round-future { opacity: 0.4; pointer-events: none; }
    /* Pin the current round to the top (right under the timer) so people on a
       later round don't have to scroll. Order-only; DOM/tab order is unchanged. */
    #scheduleSection { display: flex; flex-direction: column; }
    #scheduleSection .schedule-header { order: -3; }
    #scheduleSection #currentRoundBanner { order: -2; }
    #scheduleSection .round.current-round { order: -1; }
    #scheduleSection { order: 1; }
```

If any line differs, stop — the line numbers have drifted. Re-locate with
`grep -n "round.round-future\|round.current-round { order\|#scheduleSection { order" css/styles.css`
and adjust the anchors below before editing.

- [ ] **Step 2: Add the base ordering rules**

Insert immediately **after** the `.round.round-future { opacity: 0.4; pointer-events: none; }` line in `css/styles.css`:

```css
  /* Pin the current round directly under the timer, at every width, so someone
     on round 10 of 10 doesn't have to scroll up to reach the timer controls.
     Then upcoming rounds (default order 0), then completed rounds last so
     played rounds don't fill the screen.

     Order-only: DOM order — and so tab and screen-reader order — stays numeric
     1..N. Accepted deliberately; reordering in JS would mean renderSchedule
     emitting a state-dependent sequence, which fights the substitution and
     score-entry re-render paths that address cards by id="round-N".

     #scheduleSection must be a flex container or the order declarations are
     inert. Scoped to #scheduleSection so Traditional Ladder is untouched. */
  #scheduleSection { display: flex; flex-direction: column; }
  #scheduleSection .schedule-header { order: -3; }
  #scheduleSection #currentRoundBanner { order: -2; }
  #scheduleSection .round.current-round { order: -1; }
  #scheduleSection .round.round-completed { order: 1; }
```

- [ ] **Step 3: Delete the now-duplicated copies from the mobile block**

Delete these six lines (the comment and four rules) from inside `@media (max-width: 640px)`:

```css
    /* Pin the current round to the top (right under the timer) so people on a
       later round don't have to scroll. Order-only; DOM/tab order is unchanged. */
    #scheduleSection { display: flex; flex-direction: column; }
    #scheduleSection .schedule-header { order: -3; }
    #scheduleSection #currentRoundBanner { order: -2; }
    #scheduleSection .round.current-round { order: -1; }
```

The base rules added in Step 2 already apply at every width, so the mobile
copies are redundant. Removing them prevents the two from drifting apart.

Leave every other rule in that media query alone — in particular do not touch
`.ladder-score-input { min-height: 44px; width: 100%; ... }`.

- [ ] **Step 4: Reset the ordering for print**

Insert immediately **after** the `#scheduleSection { order: 1; }` line inside `@media print`:

```css
    /* A printed schedule is a reference handout: keep rounds in numeric order
       rather than reshuffled around whichever round was current at export. */
    #scheduleSection .round.current-round,
    #scheduleSection .round.round-completed { order: 0; }
```

Note the surrounding `#scheduleSection { order: 1; }` orders `#scheduleSection`
as a sibling *inside* `#output`; it is unrelated to ordering the round cards and
must be left as-is.

- [ ] **Step 5: Verify the stylesheet still parses and the rules are where intended**

Run:

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
python3 -c "s=open('css/styles.css').read(); print('braces', s.count('{'), s.count('}'), 'balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
grep -n "round.current-round { order\|round.round-completed { order\|#scheduleSection { display: flex" css/styles.css
awk 'NR>=663 && NR<=790 && /current-round { order|scheduleSection { display: flex/' css/styles.css
```

Expected:
- braces balanced (equal counts).
- `#scheduleSection { display: flex` appears exactly **once**.
- `round.current-round { order` appears exactly **twice** — once in the base stylesheet, once in the print reset.
- `round.round-completed { order` appears exactly **twice** — base and print reset.
- The `awk` line prints **nothing**, proving no ordering rules remain inside the `@media (max-width: 640px)` block.

- [ ] **Step 6: Confirm no JavaScript changed and the suite still passes**

Run:

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git diff --name-only
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
```

Expected: `git diff --name-only` lists **only** `css/styles.css`. `npm test`
exits 0 with `3631 passed, 0 failed`, `89 passed, 0 failed`, `40 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add css/styles.css
git commit -m "Pin the Round Robin current round under the timer at all widths

Promote the v2.9.2 mobile-only ordering rules into the base stylesheet and
add .round-completed { order: 1 } so played rounds sink below upcoming ones.
Reset the order under @media print so exported schedules stay numeric.

Order-only, so DOM and tab order remain numeric 1..N.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Verify the layout in a real browser over CDP

**Files:**
- Create: `/tmp/pin-verify.mjs` (throwaway, not committed)

**Interfaces:**
- Consumes: the CSS from Task 1, served over HTTP. The app's globals `setRRScoringMode`, `generate`, `pickWinner`, and the element ids `#output`, `#currentRoundBanner`, `#round-N`, `#numPlayers`, `#numCourts`, `#numRounds`, `#p0`..`#p15`.
- Produces: pass/fail assertions on measured `y` positions plus screenshots at `/tmp/pin-desktop.png` and `/tmp/pin-mobile.png`. Nothing later depends on it.

- [ ] **Step 1: Start a static server and headless Chrome**

Run:

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

Expected: the `APP_VERSION` string prints, and the CDP version JSON prints a
`"Browser": "Chrome/..."` line. If CDP does not respond, `cat /tmp/chrome.log`.

- [ ] **Step 2: Write the verification harness**

Create `/tmp/pin-verify.mjs`:

```javascript
// Asserts pinning by measured y position. Node >=22 has a global WebSocket,
// so this speaks CDP with zero dependencies.
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

async function boot(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 900));
  await ev('localStorage.clear()');
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 1200));
  const NAMES = ['Ravi','Rene W','Chandler','Dina','Kevin M','T','Kevin Savage','Hazel',
                 'Matt','Leanne','Iopu','Amy','Phil','Rob','Cyndi','Yolie'];
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

// Absolute document y of the banner and each round card, in visual order.
const geom = () => ev(`(() => {
  const y = el => Math.round(el.getBoundingClientRect().y + window.scrollY);
  const banner = y(document.getElementById('currentRoundBanner'));
  const rounds = [];
  for (let r = 1; r <= 10; r++) {
    const el = document.getElementById('round-' + r);
    if (el) rounds.push({ round: r, y: y(el), cls: el.className });
  }
  rounds.sort((a, b) => a.y - b.y);
  return { banner, visualOrder: rounds.map(r => r.round), rounds };
})()`);

// Marks team A the winner on every court of rounds `from`..`to`.
// pickWinner() is a TOGGLE (js/schedule-ui.js:449) — tapping a team that
// already won clears it. So this checks current state first and is safe to
// call on a range that overlaps rounds already completed.
const completeRange = (from, to) => ev(`(() => {
  for (let r = ${from}; r <= ${to}; r++) for (let c = 0; c < 3; c++) {
    const cur = roundWinners[r] && roundWinners[r][c];
    if (cur !== 'A') pickWinner(r, c, 'A');
  }
})()`);

console.log('\nDesktop 1100px — fresh schedule (round 1 current)');
await boot(1100, 1400, false);
let g = await geom();
check('round 1 is the first card below the banner', g.visualOrder[0] === 1, `order ${g.visualOrder}`);
check('round 1 sits below the banner', g.rounds.find(r => r.round === 1).y > g.banner);
check('remaining rounds are numeric', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);

console.log('\nDesktop 1100px — rounds 1-3 complete (round 4 current)');
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 400));
g = await geom();
check('round 4 is pinned first', g.visualOrder[0] === 4, `order ${g.visualOrder}`);
check('pinned round sits below the banner', g.rounds.find(r => r.round === 4).y > g.banner);
check('upcoming 5-10 follow in order', JSON.stringify(g.visualOrder.slice(1, 7)) === JSON.stringify([5,6,7,8,9,10]), `order ${g.visualOrder}`);
check('completed 1-3 are last, numeric', JSON.stringify(g.visualOrder.slice(7)) === JSON.stringify([1,2,3]), `order ${g.visualOrder}`);
check('round 4 has current-round class', g.rounds.find(r => r.round === 4).cls.includes('current-round'));

await ev(`document.getElementById('currentRoundBanner').scrollIntoView({ block: 'start' })`);
await new Promise(r => setTimeout(r, 300));
let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync('/tmp/pin-desktop.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/pin-desktop.png');

console.log('\nDesktop 1100px — all rounds complete');
await completeRange(4, 10);
await new Promise(r => setTimeout(r, 400));
g = await geom();
check('no card pinned; numeric order restored', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);

console.log('\nPrint emulation — numeric order must be restored');
await send('Emulation.setEmulatedMedia', { media: 'print' });
await boot(1100, 1400, false);
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 400));
g = await geom();
check('print keeps numeric order', JSON.stringify(g.visualOrder) === JSON.stringify([1,2,3,4,5,6,7,8,9,10]), `order ${g.visualOrder}`);
await send('Emulation.setEmulatedMedia', { media: '' });

console.log('\nMobile 390px — pinning must still work');
await boot(390, 844, true);
await completeRange(1, 3);
await new Promise(r => setTimeout(r, 400));
g = await geom();
check('round 4 pinned on mobile', g.visualOrder[0] === 4, `order ${g.visualOrder}`);
check('completed 1-3 last on mobile', JSON.stringify(g.visualOrder.slice(7)) === JSON.stringify([1,2,3]), `order ${g.visualOrder}`);
const inp = await ev(`(() => { setRRScoringMode('scores');
  const i = document.getElementById('rs4c0a'); if (!i) return null;
  const g2 = i.parentElement;
  return { inputW: Math.round(i.getBoundingClientRect().width),
           rowW: Math.round(g2.getBoundingClientRect().width),
           h: Math.round(i.getBoundingClientRect().height) }; })()`);
check('mobile score input still fills its row at 44px tall',
  inp !== null && inp.inputW >= inp.rowW - 2 && inp.h >= 44, JSON.stringify(inp));

await ev(`document.getElementById('currentRoundBanner').scrollIntoView({ block: 'start' })`);
await new Promise(r => setTimeout(r, 300));
shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync('/tmp/pin-mobile.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/pin-mobile.png');

console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness and confirm every assertion passes**

Run:

```bash
cd /tmp && node pin-verify.mjs
```

Expected: `13 passed, 0 failed` and a zero exit code. Every `check` must print
`ok`. If the print-emulation check fails, the `@media print` reset from Task 1
Step 4 is missing or misplaced. If the mobile score-input check fails, a rule
setting a width on `.ladder-score-input` was added — remove it.

- [ ] **Step 4: Look at both screenshots**

Open `/tmp/pin-desktop.png` and `/tmp/pin-mobile.png` and confirm visually:
- The current round card sits immediately under the timer bar.
- Upcoming rounds follow it, dimmed.
- Completed rounds are at the bottom, dimmed with struck-through titles.
- No overlapping or clipped cards.

A blank or malformed image means the page failed to load — check `/tmp/chrome.log`.

- [ ] **Step 5: Tear down**

```bash
pkill -f "http.server 8765"; pkill -f "pb-chrome-profile"
sleep 1; rm -rf /tmp/pb-chrome-profile /tmp/chrome.log /tmp/serve.log /tmp/pin-verify.mjs
curl -s -m 2 -o /dev/null http://127.0.0.1:8765/ && echo "STILL SERVING" || echo "server stopped"
```

Expected: `server stopped`. Keep the two screenshots until they have been shown
to the user, then delete them.

- [ ] **Step 6: No commit for this task**

This task creates no committed artifacts — the harness is throwaway. Confirm
with `git status --short` that the working tree is clean apart from anything
Task 3 will touch.

---

### Task 3: Bump the version and document the behaviour

**Files:**
- Modify: `index.html:13`
- Modify: `package.json:3`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the CSS being in place.
- Produces: `APP_VERSION` / `version` of `2.11.0`, used as the cache-busting query string on every JS and CSS URL.

- [ ] **Step 1: Read the current version and the README section to extend**

Run:

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -n 'APP_VERSION = ' index.html
grep -n '"version"' package.json
grep -n -i "round robin" README.md | head
```

Expected: both version strings read `2.10.1`. Note the README line numbers for
the Round Robin feature list.

- [ ] **Step 2: Bump both version strings to 2.11.0**

In `index.html` line 13, change:

```html
<script>const APP_VERSION = "2.10.1";</script>
```

to:

```html
<script>const APP_VERSION = "2.11.0";</script>
```

In `package.json` line 3, change `"version": "2.10.1",` to `"version": "2.11.0",`.

Minor rather than patch: this is a visible behaviour change to how the schedule
is laid out, not a defect fix.

- [ ] **Step 3: Add one README bullet**

Add to the Round Robin feature list in `README.md`, matching the surrounding
bullet style exactly:

```markdown
- **Current round pinned to the top** — the round you're playing sits directly under the round timer, with upcoming rounds next and completed rounds tucked at the bottom, so you never scroll to reach the timer.
```

- [ ] **Step 4: Verify both versions match and the suite still passes**

Run:

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -rn '2\.11\.0' package.json index.html
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
```

Expected: exactly two `2.11.0` matches, one per file. `npm test` exits 0.
`git diff --name-only` lists only `index.html`, `package.json`, `README.md`
(`css/styles.css` was already committed in Task 1).

- [ ] **Step 5: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add index.html package.json README.md
git commit -m "v2.11.0: Pin the Round Robin current round under the timer

Bump APP_VERSION so returning visitors get the new stylesheet instead of a
cached copy, and document the behaviour in the README.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Report before pushing**

Do **not** push. Show the user the two screenshots and the harness results,
then ask whether to push to `main` — it deploys straight to
`pickle.choxmox.com`. Note that the spec commit `d7e8ffa` is also unpushed and
will go out with these.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Current round adjacent to timer at every width | Task 1 Step 2 |
| Upcoming rounds next, numeric | Task 1 Step 2 (default `order: 0`) |
| Completed rounds sink to bottom | Task 1 Step 2 (`.round-completed { order: 1 }`) |
| Print keeps numeric order 1..N | Task 1 Step 4; asserted Task 2 Step 3 |
| No JavaScript changes | Global Constraints; asserted Task 1 Step 6 and Task 3 Step 4 via `git diff --name-only` |
| Ladder mode unaffected | Global Constraints; every rule `#scheduleSection`-scoped |
| Mobile not regressed | Task 2 mobile checks incl. the `.ladder-score-input` trap |
| Duplicated mobile rules removed | Task 1 Step 3; asserted Step 5 via `awk` |
| Edge case: all rounds complete | Task 2 "all rounds complete" check |
| Edge case: round 1 current | Task 2 "fresh schedule" checks |
| Accessibility caveat recorded | Task 1 Step 2 CSS comment |
| Testing via CDP harness | Task 2 |

No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"add validation". Every
code step contains literal CSS, shell, or JavaScript. Expected outputs are
stated for every verification step.

**Type consistency:** Class and id names used across tasks are consistent and
match the codebase: `#scheduleSection`, `#currentRoundBanner`,
`.schedule-header`, `.round.current-round`, `.round.round-completed`,
`.round.round-future`, `#round-N`, `#rs4c0a`, `#p0`..`#p15`. The harness calls
only real globals: `generate()`, `pickWinner(round, courtIdx, team)`,
`setRRScoringMode('scores')`. Version `2.11.0` is used identically in Task 3
Steps 2, 4, and 5.
