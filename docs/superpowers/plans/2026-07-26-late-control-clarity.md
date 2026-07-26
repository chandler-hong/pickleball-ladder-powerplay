# Late-Arrival Control Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the late-arrival control legible and self-explanatory — a labelled `⏱ Late` chip that meets contrast standards, an always-visible hint under the Players heading, and a visible keyboard focus ring.

**Architecture:** Presentational only. `js/schedule-ui.js` emits a text label inside the existing `.late-label`; `css/styles.css` raises the chip's contrast in both themes, enlarges the glyph, adds a `:focus-visible` ring and a mobile tap target; `index.html` gains one hint line under the Players card title. No scheduling logic changes.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step, no dependencies. Verification uses headless Google Chrome over the Chrome DevTools Protocol driven from Node's built-in global `WebSocket`.

**Spec reference:** `docs/superpowers/specs/2026-07-26-late-control-clarity-design.md`

## Global Constraints

- Presentational only. Do **not** modify `js/schedule.js`, `js/ladder.js`, `js/utils.js`, `js/state.js`, or anything under `tests/`. The control's behaviour, persistence and validation stay exactly as they are.
- The control's DOM contract must not change: the checkbox keeps `id="late{i}"` and class `late-check`; the number input keeps `id="joinRound{i}"` and class `join-round-input`. `getJoinRounds()`, `savePlayerData()`, `collectValidationErrors()` and the Task-4 CDP harness from the previous plan all address those ids.
- The label must remain a `<label for="late{i}">` so clicking it still toggles the checkbox without JavaScript.
- Contrast targets, measured against the real backgrounds — dark card `#181a20`, light card `#ffffff`:
  - unticked chip **≥ 4.5:1** in both themes
  - ticked chip **≥ 4.5:1** in both themes
- Traditional Ladder mode must be visually unaffected.
- `npm test` must exit 0 with schedule `4477 passed, 0 failed`, utils exactly `89 passed, 0 failed`, ladder exactly `40 passed, 0 failed`. These are scheduling tests; presentational changes must not move them.
- Do NOT run `git push`.

### Measured starting values

Computed against the real card backgrounds. The current colours **fail in both themes**:

| | Colour | Contrast | |
|---|---|---|---|
| Dark, unticked (current) | `#5a5f72` on `#181a20` | **2.75:1** | fails |
| Dark, unticked (target) | `#a5b4fc` on `#181a20` | **8.72:1** | passes |
| Dark, hover | `#c7d2fe` on `#181a20` | 11.66:1 | passes |
| Dark, ticked (current) | `#fbbf24` on `#181a20` | 10.42:1 | already passes |
| Light, unticked (current) | `#9aa1ad` on `#ffffff` | **2.60:1** | fails |
| Light, unticked (target) | `#4f46e5` on `#ffffff` | **6.29:1** | passes |

`#a5b4fc` and `#c7d2fe` are already this palette's indigo text and hover values; `#4f46e5` is the light-theme indigo family. Nothing new is being introduced.

The light theme has **no** rule for the ticked state today — `[data-theme="light"] .late-label` sets only the resting colour, so a ticked chip inherits the dark theme's `#fbbf24` on white. Task 1 must add one; `#b45309` is the amber this file already uses for light-theme warnings (`[data-theme="light"] .gender-hint`).

---

## File Structure

| File | Role |
|---|---|
| `js/schedule-ui.js` | Emit `⏱ Late` inside `.late-label` instead of the bare glyph, with the glyph in its own span so it can be sized independently. |
| `css/styles.css` | Chip contrast in both themes, glyph size, `:focus-visible` ring, mobile tap target, hint-line styling. |
| `index.html` | One hint line under the Players card title. |
| `package.json` | Version bump. |
| `README.md` | Update the late-arrivals bullet to mention the chip. |
| `/tmp/clarity-verify.mjs` | Throwaway CDP harness. Not committed. |

---

### Task 1: The labelled chip, contrast, focus ring and hint line

**Files:**
- Modify: `js/schedule-ui.js:41` (the `.late-control` markup)
- Modify: `css/styles.css:132-156` (the `.late-control` block and its two light-theme rules)
- Modify: `css/styles.css` inside `@media (max-width: 640px)` (opens at `:745`, closes before `@media print` at `:866`)
- Modify: `index.html:81-85` (the Players card title block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `.late-label` containing a `<span class="late-icon">⏱</span>` and the text `Late`; a `.late-hint` element under the Players card title. The ids `late{i}` and `joinRound{i}` and the classes `late-check`, `late-label`, `join-round-input` are unchanged.

- [ ] **Step 1: Confirm the anchors**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -n "late-control" js/schedule-ui.js
sed -n '132,134p' css/styles.css
sed -n '155,156p' css/styles.css
sed -n '81,84p' index.html
grep -n "@media (max-width: 640px)" css/styles.css
```

Expected: `late-control` appears once in `js/schedule-ui.js` at line 41; `css/styles.css:132` is `.late-control { display: flex; ... }`; `:155-156` are the two `[data-theme="light"]` rules; `index.html:81-84` is the `player-card-title` div containing the `Players` span and `playerGenderCount`; the mobile block opens at `css/styles.css:745`.

If anything differs, STOP and report BLOCKED with the actual output.

- [ ] **Step 2: Emit the labelled chip**

In `js/schedule-ui.js`, replace this line:

```javascript
      `<label for="late${i}" class="late-label" title="Arrives late — sits out until their join round">⏱</label>` +
```

with:

```javascript
      `<label for="late${i}" class="late-label" title="Arrives late — sits out until their join round">` +
      `<span class="late-icon" aria-hidden="true">⏱</span>Late</label>` +
```

The glyph goes in its own span so it can be sized independently of the word, and `aria-hidden` on it stops a screen reader announcing "stopwatch Late" — the word alone is the accessible name. Change nothing else about the markup: the `for`, the `title`, and the surrounding `.late-control` div all stay.

- [ ] **Step 3: Rewrite the chip's styling**

In `css/styles.css`, replace lines 132-156 — the whole block from `.late-control` through the two `[data-theme="light"]` rules — with:

```css
  .late-control { display: flex; align-items: center; gap: 0.3rem; }
  .late-check { position: absolute; opacity: 0; pointer-events: none; }
  /* A labelled chip, not a bare glyph. The word does the explaining, so a
     first-time user does not have to hover a tooltip that does not exist on
     touch. Resting colour is the palette's indigo text at 8.72:1 on the card —
     the previous #5a5f72 measured 2.75:1, below the 3:1 floor for UI
     components, and read as a smudge beside the M/F toggle. */
  .late-label {
    display: inline-flex; align-items: center; gap: 0.25rem;
    cursor: pointer; font-size: 0.72rem; font-weight: 600; line-height: 1;
    padding: 0.3rem 0.5rem; border-radius: 7px;
    color: #a5b4fc; background: rgba(129,140,248,0.08);
    border: 1px solid rgba(129,140,248,0.22);
    transition: all 0.2s ease; user-select: none; white-space: nowrap;
  }
  .late-icon { font-size: 0.9rem; line-height: 1; }
  .late-label:hover { color: #c7d2fe; border-color: rgba(129,140,248,0.45); }
  /* The checkbox is visually hidden but still keyboard-focusable, and until now
     had no focus styling at all — you could tab onto it and toggle it with
     Space while seeing nothing. Matches the focus treatment used by the text
     inputs in this file. */
  .late-check:focus-visible + .late-label {
    border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129,140,248,0.25);
  }
  .late-check:checked + .late-label {
    color: #fbbf24; background: rgba(251,191,36,0.12);
    border-color: rgba(251,191,36,0.4);
  }
  .join-round-input {
    display: none; width: 42px; padding: 0.25rem; border-radius: 6px;
    text-align: center; border: 1px solid #2a2d37;
    background: #1e2028; color: #e4e7ec;
    font-family: inherit; font-size: 0.78rem; font-weight: 600; outline: none;
    -webkit-appearance: none; -moz-appearance: textfield; appearance: textfield;
  }
  .join-round-input::-webkit-outer-spin-button,
  .join-round-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .late-check:checked ~ .join-round-input { display: block; }
  /* Hint under the Players heading. The Ladder has an equivalent
     (.ladder-assignment-hint) but that one is display:none until <=640px,
     because its drag interaction is only unclear on touch. This control is
     unclear at every width, so this hint is always visible. */
  .late-hint {
    font-size: 0.72rem; color: #a5b4fc;
    background: rgba(129,140,248,0.08);
    border: 1px solid rgba(129,140,248,0.18);
    border-radius: 8px; padding: 0.5rem 0.75rem;
    margin: -0.25rem 0 1rem 0;
  }
  .late-hint .late-hint-icon { font-size: 0.85rem; }
  /* Light theme: the previous #9aa1ad measured 2.60:1 on the white card and
     also failed. There was no ticked-state rule at all, so a ticked chip
     inherited the dark theme's amber on white. */
  [data-theme="light"] .late-label {
    color: #4f46e5; background: rgba(99,102,241,0.07);
    border-color: rgba(99,102,241,0.22);
  }
  [data-theme="light"] .late-label:hover { color: #4338ca; border-color: rgba(99,102,241,0.45); }
  [data-theme="light"] .late-check:checked + .late-label {
    color: #b45309; background: rgba(234,88,12,0.1);
    border-color: rgba(234,88,12,0.35);
  }
  [data-theme="light"] .late-hint {
    color: #4338ca; background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.2);
  }
  [data-theme="light"] .join-round-input { background: #fff; border-color: #d5d9e2; color: #1b1e26; }
```

- [ ] **Step 4: Add the mobile tap target**

Inside the `@media (max-width: 640px)` block (opens at `css/styles.css:745`), add:

```css
    /* 44px tap target, matching the other mobile controls in this file.
       .player-input already has flex-wrap: wrap, so the chip drops to its own
       line when the row runs out of width — no extra rule needed for that. */
    .late-label { min-height: 44px; padding: 0.3rem 0.7rem; font-size: 0.78rem; }
    .late-icon { font-size: 1rem; }
    .join-round-input { min-height: 44px; width: 52px; font-size: 0.9rem; }
```

Do **not** add any rule setting a width on `.ladder-score-input` — the mobile block sets `width: 100%` there and an ID-scoped or later selector would silently override it and break its tap target. This has bitten this codebase before.

- [ ] **Step 5: Add the hint line**

In `index.html`, the Players card currently reads:

```html
    <div class="card-title player-card-title">
      <span>Players</span>
      <span class="player-gender-count" id="playerGenderCount" style="display:none;"></span>
    </div>
    <div class="player-grid" id="playerGrid"></div>
```

Insert the hint between the title div and the grid:

```html
    <div class="card-title player-card-title">
      <span>Players</span>
      <span class="player-gender-count" id="playerGenderCount" style="display:none;"></span>
    </div>
    <div class="late-hint">Tap <span class="late-hint-icon">⏱</span> <strong>Late</strong> for anyone arriving after the start, then set the round they join.</div>
    <div class="player-grid" id="playerGrid"></div>
```

- [ ] **Step 6: Verify syntax, scope and the suite**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
for f in js/*.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done && echo "all js parse"
python3 -c "s=open('css/styles.css').read(); print('braces', s.count('{'), s.count('}'), 'balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
grep -c "late-hint" index.html css/styles.css
grep -n "late-check:focus-visible" css/styles.css
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
```

Expected: all js parse; braces balanced; `late-hint` appears in both files; the `:focus-visible` rule exists; `npm test` exit 0 with `4477` / `89` / `40`; `git diff --name-only` lists exactly `css/styles.css`, `index.html`, `js/schedule-ui.js`.

- [ ] **Step 7: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add js/schedule-ui.js css/styles.css index.html
git commit -m "Make the late-arrival control legible and self-explanatory

The control shipped as a 12.8px glyph in #5a5f72 — a measured 2.75:1 against
the card, below the 3:1 floor for UI components — whose only explanation was a
title tooltip, which does not exist on touch. The light theme was worse at
2.60:1 and had no ticked-state rule at all, so a ticked chip rendered the dark
theme's amber on white.

Replace the bare glyph with a labelled chip so the word does the explaining,
lift both themes above 4.5:1, and add a hint under the Players heading. Unlike
the Ladder's equivalent hint this one is always visible, since the control is
unclear at every width rather than only on touch.

Also add a focus ring: the visually-hidden checkbox is keyboard-focusable and
had no focus styling, so you could tab onto it and toggle it with Space while
seeing nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Verify in a browser, then version and document

**Files:**
- Create: `/tmp/clarity-verify.mjs` (throwaway, not committed)
- Modify: `index.html` (version only), `package.json` (version only), `README.md`

**Interfaces:**
- Consumes: the chip, hint and focus ring from Task 1, served over HTTP.
- Produces: `2.13.1` in both version files.

- [ ] **Step 1: Start the server and headless Chrome**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
python3 -m http.server 8765 --bind 127.0.0.1 > /tmp/serve.log 2>&1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --no-first-run --no-default-browser-check \
  --user-data-dir=/tmp/clarity-profile --hide-scrollbars about:blank > /tmp/chrome.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:9222/json/version | head -2
```

Expected: a `"Browser": "Chrome/..."` line. If not, `cat /tmp/chrome.log`.

- [ ] **Step 2: Write the harness**

Create `/tmp/clarity-verify.mjs`:

```javascript
// Measures the chip's real computed contrast in both themes, the name input's
// width at three breakpoints, and the focus ring. Node >=22 has a global
// WebSocket, so this speaks CDP with zero dependencies.
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

// Contrast maths, run in the page against the *actual* computed colours so we
// measure what renders rather than what the stylesheet says.
const CONTRAST_FN = `
  function _lin(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function _lum(rgb){ const m=rgb.match(/\\d+/g).map(Number);
    return 0.2126*_lin(m[0]) + 0.7152*_lin(m[1]) + 0.0722*_lin(m[2]); }
  function _ratio(fg,bg){ const a=_lum(fg), b=_lum(bg); const hi=Math.max(a,b), lo=Math.min(a,b);
    return (hi+0.05)/(lo+0.05); }
`;

const NAMES = ['Ravi','Rene W','Chandler','Dina','Kevin M','T','Kevin Savage','Hazel',
               'Matt','Leanne','Iopu','Amy','Phil','Rob','Cyndi','Yolie'];

async function boot(width, mobile, theme) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 800));
  await ev(`localStorage.clear(); localStorage.setItem('pickleball_theme', ${JSON.stringify(theme)});`);
  await send('Page.navigate', { url: APP });
  await new Promise(r => setTimeout(r, 1200));
  await ev(`(() => {
    const fire = (el, ty) => el.dispatchEvent(new Event(ty, { bubbles: true }));
    const set = (i, v) => { const el = document.getElementById(i); el.value = v; fire(el, 'input'); };
    set('numPlayers', 16); set('numCourts', 3); set('numRounds', 10);
    ${JSON.stringify(NAMES)}.forEach((n, i) => { const el = document.getElementById('p' + i); el.value = n; fire(el, 'input'); });
  })()`);
  await new Promise(r => setTimeout(r, 300));
}

for (const theme of ['dark', 'light']) {
  console.log(`\n${theme} theme — contrast`);
  await boot(1100, false, theme);
  const unticked = await ev(`(() => { ${CONTRAST_FN}
    const l = document.querySelector('label[for="late0"]');
    const bg = getComputedStyle(document.querySelector('.card')).backgroundColor;
    return { ratio: _ratio(getComputedStyle(l).color, bg), color: getComputedStyle(l).color, bg };
  })()`);
  check(`unticked chip >= 4.5:1 (got ${unticked.ratio.toFixed(2)}:1)`, unticked.ratio >= 4.5,
    `${unticked.color} on ${unticked.bg}`);

  await ev(`(() => { const c = document.getElementById('late0');
    c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await new Promise(r => setTimeout(r, 250));
  const ticked = await ev(`(() => { ${CONTRAST_FN}
    const l = document.querySelector('label[for="late0"]');
    const bg = getComputedStyle(document.querySelector('.card')).backgroundColor;
    return { ratio: _ratio(getComputedStyle(l).color, bg), color: getComputedStyle(l).color };
  })()`);
  check(`ticked chip >= 4.5:1 (got ${ticked.ratio.toFixed(2)}:1)`, ticked.ratio >= 4.5, ticked.color);
  check('ticked reveals the round input',
    await ev(`getComputedStyle(document.getElementById('joinRound0')).display`) !== 'none');
}

console.log('\nhint line is visible at every width');
for (const [w, mobile] of [[1100, false], [900, false], [390, true]]) {
  await boot(w, mobile, 'dark');
  const hint = await ev(`(() => { const h = document.querySelector('.late-hint');
    if (!h) return null;
    const s = getComputedStyle(h); const r = h.getBoundingClientRect();
    return { display: s.display, visible: r.height > 0, text: h.textContent.trim() }; })()`);
  check(`hint visible at ${w}px`, hint && hint.visible && hint.display !== 'none', JSON.stringify(hint));
  if (w === 1100) check('hint mentions Late and the join round',
    /Late/.test(hint.text) && /round/i.test(hint.text), hint.text);
}

console.log('\nname-input width at each breakpoint (the accepted tradeoff)');
for (const [w, mobile, floor] of [[1100, false, 130], [900, false, 85], [390, true, 100]]) {
  await boot(w, mobile, 'dark');
  const m = await ev(`(() => {
    const row = document.querySelector('.player-input');
    const name = row.querySelector('input[type="text"]');
    const chip = document.querySelector('label[for="late0"]');
    return { name: Math.round(name.getBoundingClientRect().width),
             chip: Math.round(chip.getBoundingClientRect().width),
             chipH: Math.round(chip.getBoundingClientRect().height) };
  })()`);
  console.log(`    ${w}px: name=${m.name}px chip=${m.chip}x${m.chipH}px`);
  check(`name input still usable at ${w}px (>= ${floor}px)`, m.name >= floor, `${m.name}px`);
  if (mobile) check('chip is a 44px tap target on mobile', m.chipH >= 44, `${m.chipH}px`);
}

console.log('\nkeyboard focus ring');
await boot(1100, false, 'dark');
const focus = await ev(`(() => {
  const c = document.getElementById('late0');
  const l = document.querySelector('label[for="late0"]');
  const before = getComputedStyle(l).boxShadow;
  c.focus();
  const after = getComputedStyle(l).boxShadow;
  return { before, after, focused: document.activeElement === c };
})()`);
check('checkbox is focusable', focus.focused === true);
check('focus produces a visible ring', focus.after !== focus.before && focus.after !== 'none',
  `before=${focus.before} after=${focus.after}`);

await boot(1100, false, 'dark');
await ev(`document.querySelector('.player-grid').scrollIntoView({block:'start'})`);
await new Promise(r => setTimeout(r, 300));
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync('/tmp/late-after.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/late-after.png');

console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness**

```bash
cd /tmp && node clarity-verify.mjs
```

Expected: `16 passed, 0 failed`, exit 0.

Note the `:focus-visible` caveat: a programmatic `.focus()` may not always match `:focus-visible`, which is heuristic. If the focus-ring assertion fails while the rule is present and correct, say so explicitly and verify by sending a real Tab key via `Input.dispatchKeyEvent` instead of weakening the assertion.

If a contrast assertion fails, report the measured ratio and the computed colours — do not adjust the threshold.

- [ ] **Step 4: Look at the screenshot**

Open `/tmp/late-after.png`. Confirm the chip reads clearly at a glance, that it does not overpower the M/F toggle beside it, that the hint line sits under the Players heading and reads naturally, and that names are not unacceptably cramped. Report what you actually see, including anything that looks worse than before.

- [ ] **Step 5: Tear down**

```bash
pkill -f "http.server 8765"; pkill -f "clarity-profile"
sleep 1; rm -rf /tmp/clarity-profile /tmp/chrome.log /tmp/serve.log /tmp/clarity-verify.mjs
curl -s -m 2 -o /dev/null http://127.0.0.1:8765/ && echo "STILL SERVING" || echo "server stopped"
```

Keep `/tmp/late-after.png` for the controller.

- [ ] **Step 6: Bump the version**

`index.html` line 13: `APP_VERSION = "2.13.0"` → `"2.13.1"`. `package.json` line 3: `"version": "2.13.0",` → `"2.13.1",`. Patch bump — this is presentational polish on an existing feature, no behaviour change. Both must match; `APP_VERSION` is the cache-buster on every JS and CSS URL.

- [ ] **Step 7: Update the README bullet**

Read the file first and match its existing bullet style. The current late-arrivals bullet reads:

```markdown
- **Late arrivals** — mark anyone who's running behind and set the round they'll join; they sit out until then and the whole schedule is optimised around their absence in one pass, with their forced byes excluded from bye-fairness so nobody else is penalised for it
```

Change the opening so it names the control:

```markdown
- **Late arrivals** — tap **⏱ Late** on anyone who's running behind and set the round they'll join; they sit out until then and the whole schedule is optimised around their absence in one pass, with their forced byes excluded from bye-fairness so nobody else is penalised for it
```

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -rn '2\.13\.1' index.html package.json
grep -rn '2\.13\.0' index.html package.json || echo "no stale version"
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
git add index.html package.json README.md
git commit -m "v2.13.1: Clearer late-arrival control

Bump APP_VERSION so returning visitors get the new stylesheet instead of a
cached copy, and name the control in the README bullet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: exactly two `2.13.1` matches, no stale `2.13.0`, `npm test` exit 0, and `git diff --name-only` listing only `index.html`, `package.json`, `README.md`.

- [ ] **Step 9: Do not push**

Report to the controller instead.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Labelled `⏱ Late` chip | Task 1 Steps 2-3 |
| Unticked contrast ≥ 4.5:1, both themes | Task 1 Step 3; asserted Task 2 Step 3 |
| Ticked contrast ≥ 4.5:1, both themes | Task 1 Step 3 (light ticked rule added); asserted Task 2 Step 3 |
| Larger glyph | Task 1 Step 3 (`.late-icon`) |
| Always-visible hint under Players | Task 1 Steps 3, 5; asserted at three widths Task 2 Step 3 |
| Focus ring via `:focus-visible` | Task 1 Step 3; asserted Task 2 Step 3 |
| Mobile 44px tap target | Task 1 Step 4; asserted Task 2 Step 3 |
| Mobile wrap | Already satisfied — `.player-input` has `flex-wrap: wrap` (`css/styles.css:74`). Noted in Task 1 Step 4's comment; no rule needed. |
| Name-input width tradeoff measured | Task 2 Step 3 |
| Behaviour unchanged | Global Constraints; DOM contract preserved; `npm test` asserted in both tasks |
| Ladder unaffected | Global Constraints; no rule added outside `.late-*` |
| Version bump + README | Task 2 Steps 6-8 |

No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step carries literal CSS, JS, HTML or shell. Task 2 Step 4 asks for a visual judgement, which cannot be pre-decided, but names what to look at and requires reporting what was actually seen.

**Type consistency:** Class names are consistent across tasks — `.late-control`, `.late-check`, `.late-label`, `.late-icon`, `.join-round-input`, `.late-hint`, `.late-hint-icon`. Element ids `late{i}` and `joinRound{i}` are unchanged from the existing code and match the harness's selectors (`label[for="late0"]`, `#joinRound0`). Version `2.13.1` is used identically in Task 2 Steps 6 and 8. The harness's 16 `check()` calls match the stated expectation.

**Corrections to the spec, folded in deliberately:**

1. The spec quoted the dark-theme contrast as 2.83:1; the precise figure computed against `#181a20` is **2.75:1**. Either way it fails, but the plan uses the accurate number.
2. The spec did not measure the light theme. It **also fails, at 2.60:1**, and has no ticked-state rule at all — so a ticked chip currently renders the dark theme's amber on a white card. Task 1 Step 3 fixes both.
3. The spec proposed adding a mobile wrap rule. `.player-input` already has `flex-wrap: wrap`, so only the 44px tap target is new.
