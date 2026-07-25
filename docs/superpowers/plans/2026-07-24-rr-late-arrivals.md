# Round Robin Late Arrivals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organiser mark, during setup, that a player joins from a given round; the generator keeps them on bye until then and optimises the whole schedule around the absence in one pass.

**Architecture:** `generateSchedule` gains an optional sixth parameter `joinRounds`. Phase 1 (sit-out selection) forces absent players onto byes before the existing fairness logic picks the remaining bye slots. Forced byes are counted separately from voluntary ones and excluded from every fairness signal, so a late arrival is never treated as having already had its share of byes. `scoreSchedule` switches its bye metrics to the voluntary counter. The UI adds a per-row late toggle and blocks Generate when a round would be short of players.

**Tech Stack:** Vanilla HTML/CSS/JS — no frameworks, no build step, no dependencies. Node with a seeded RNG (`mulberry32`) for the test harness. Verification of the UI uses headless Chrome over the Chrome DevTools Protocol driven from Node's built-in global `WebSocket`.

**Spec reference:** `docs/superpowers/specs/2026-07-24-rr-late-arrivals-design.md`

## Global Constraints

- `generateSchedule`'s existing 5-argument form must keep working unchanged. There are 21 call sites across `js/schedule.js` and `tests/schedule.test.js`, and none passes a sixth argument. Omitting `joinRounds` must produce byte-identical output for the same seed.
- `generateBestScheduleAsync(numPlayers, numCourts, numRounds, genders, preferMixed, onProgress, onComplete, options)` already uses positions 6 and 7 for callbacks. `joinRounds` must therefore travel in `options.joinRounds` for **both** `generateBestSchedule` and `generateBestScheduleAsync` — never as a positional parameter on those two.
- `scoreSchedule(result, n, genders)` keeps its exact signature. Anything it needs beyond that must arrive on the `result` object.
- Two distinct bye counters, with this contract: `result.sitOutCount` stays **total** byes (forced + voluntary) because `renderStats` displays it at `js/schedule-ui.js:1350` as "N byes"; `result.voluntaryByeCount` is voluntary-only and is what Phase 1 fairness and `scoreSchedule` read. Confusing these is the most likely bug in this feature.
- Bye fairness must exclude forced byes. The guarantee becomes "bye spread ≤ 1 after every round, measured over rounds in which the player was present."
- No `STATE_SCHEMA_VERSION` bump. `joinRound` is optional on `playerData` entries and absent values read as `1`, applied at read time — never by back-filling the restored array.
- Court count stays global. Do not introduce per-round court counts. Over-capacity is handled by blocking Generate.
- Traditional Ladder mode must be untouched. Do not modify `js/ladder.js`.
- `npm test` must exit 0 at the end of every task. The baseline before this plan is `3631 passed, 0 failed`, `89 passed, 0 failed`, `40 passed, 0 failed`; the schedule count grows as tasks add assertions, the other two must not change.
- Do NOT run `git push`. This repo auto-deploys to a live public site; the owner approves pushes separately.

---

## File Structure

| File | Role |
|---|---|
| `js/schedule.js` | `joinRounds` parameter and its validation; forced byes in Phase 1; the two bye counters; `joinRounds` on the result; `scoreSchedule`'s switch to voluntary byes; `options.joinRounds` pass-through in both multi-start wrappers. |
| `tests/schedule.test.js` | All new assertions. Absence respected, courts full, no duplicates, fairness excludes forced byes, display-vs-fairness split, no-op equivalence. |
| `js/schedule-ui.js` | `playerData.joinRound`; the per-row late toggle and its handlers; `getJoinRounds()`; passing `options.joinRounds` from `generate()`; the availability validation. |
| `css/styles.css` | Styling for the late toggle and its round input. |
| `index.html` / `package.json` | Version bump to `2.13.0`. |
| `README.md` | Feature bullet, and the bye-fairness guarantee qualification. |

---

### Task 1: `joinRounds` parameter and forced byes in Phase 1

**Files:**
- Modify: `js/schedule.js:109` (signature), `:119-129` (derived counts), `:141`+ (Phase 1), `:317` (bye counting), `:534` (result)
- Test: `tests/schedule.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed, joinRounds)` where `joinRounds` is an optional array of length `numPlayers` of 1-based integers, defaulting to all `1`. The returned object gains two fields: `voluntaryByeCount` (array of length `numPlayers`) and `joinRounds` (the normalised array actually used). `sitOutCount` keeps its existing meaning of total byes.

- [ ] **Step 1: Confirm the starting state**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
sed -n '109p' js/schedule.js
sed -n '317p' js/schedule.js
sed -n '534p' js/schedule.js
npm test 2>&1 | grep -E "passed, [0-9]+ failed"
```

Expected:

```
function generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed) {
    sitOuts.forEach(i => sitOutCount[i]++);
  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, playCount, coByeCount };
  3631 passed, 0 failed
  89 passed, 0 failed
  40 passed, 0 failed
```

If any line differs, STOP and report BLOCKED with the actual output. Do not guess replacement line numbers.

- [ ] **Step 2: Write the failing tests**

Add to `tests/schedule.test.js`, immediately before the `console.log('\n' + '='.repeat(60));` summary block at the end of the file:

```javascript
// --- Late arrivals ---------------------------------------------------

// Players absent for the first rounds must not appear in any court or bye-list
// entry of those rounds, and must appear from their join round onward.
function roundsPlayerAppears(result, playerIdx) {
  const rounds = [];
  for (const round of result.schedule) {
    const inCourt = round.courts.some(c =>
      c.teamA.includes(playerIdx) || c.teamB.includes(playerIdx));
    if (inCourt) rounds.push(round.round);
  }
  return rounds;
}

// Voluntary byes only: a bye a player took while actually present.
function voluntaryByeSpread(result, n, joinRounds) {
  const v = new Array(n).fill(0);
  for (const round of result.schedule) {
    for (const p of round.sitOuts) {
      if (joinRounds[p] <= round.round) v[p]++;
    }
  }
  // Only players present for at least one round can be compared fairly.
  const present = [];
  for (let i = 0; i < n; i++) if (joinRounds[i] <= result.schedule.length) present.push(v[i]);
  return { spread: Math.max(...present) - Math.min(...present), counts: v };
}

test('Late arrivals: absent players never appear before their join round', () => {
  setScheduleRng(mulberry32(101));
  const joinRounds = new Array(16).fill(1);
  joinRounds[0] = 3;   // player 0 joins round 3
  joinRounds[5] = 2;   // player 5 joins round 2
  const result = generateSchedule(16, 3, 10, makeGenders(8, 8), true, joinRounds);

  const p0 = roundsPlayerAppears(result, 0);
  const p5 = roundsPlayerAppears(result, 5);
  assert(!p0.includes(1) && !p0.includes(2), `player 0 must not play rounds 1-2 (played ${p0})`);
  assert(!p5.includes(1), `player 5 must not play round 1 (played ${p5})`);
  assert(p0.length > 0, 'player 0 must play at least once from round 3');
  assert(p5.length > 0, 'player 5 must play at least once from round 2');
  // And they must be listed as sitting out in the rounds they miss.
  assert(result.schedule[0].sitOuts.includes(0), 'player 0 sits out round 1');
  assert(result.schedule[1].sitOuts.includes(0), 'player 0 sits out round 2');
  assert(result.schedule[0].sitOuts.includes(5), 'player 5 sits out round 1');
  resetScheduleRng();
});

test('Late arrivals: every round still fields exactly courts*4 players', () => {
  setScheduleRng(mulberry32(202));
  const joinRounds = new Array(16).fill(1);
  joinRounds[0] = 3; joinRounds[1] = 3; joinRounds[2] = 2;
  const result = generateSchedule(16, 3, 10, makeGenders(8, 8), true, joinRounds);
  checkAllCourtsHaveFourPlayers(result);
  checkNoDuplicates(result, 16);
  for (const round of result.schedule) {
    const playing = round.courts.reduce((t, c) => t + c.teamA.length + c.teamB.length, 0);
    assert(playing === 12, `round ${round.round} fielded ${playing}, expected 12`);
  }
  resetScheduleRng();
});

test('Late arrivals: forced byes excluded from fairness, counted in the display total', () => {
  setScheduleRng(mulberry32(303));
  const joinRounds = new Array(16).fill(1);
  joinRounds[0] = 4;   // misses rounds 1-3
  const result = generateSchedule(16, 3, 10, makeGenders(8, 8), true, joinRounds);

  // Display total includes the 3 forced byes.
  assert(result.sitOutCount[0] >= 3,
    `total byes for player 0 should include 3 forced (got ${result.sitOutCount[0]})`);
  // Voluntary counter excludes them.
  assert(result.voluntaryByeCount[0] === result.sitOutCount[0] - 3,
    `voluntary should be total minus 3 forced (total ${result.sitOutCount[0]}, ` +
    `voluntary ${result.voluntaryByeCount[0]})`);
  // Fairness holds on the voluntary counter, not the total.
  const { spread } = voluntaryByeSpread(result, 16, result.joinRounds);
  assert(spread <= 1, `voluntary bye spread should be <= 1 (got ${spread})`);
  resetScheduleRng();
});

test('Late arrivals: omitting joinRounds is byte-identical to the old behaviour', () => {
  const g = makeGenders(8, 8);
  setScheduleRng(mulberry32(404));
  const withoutArg = generateSchedule(16, 3, 10, g, true);
  setScheduleRng(mulberry32(404));
  const withAllOnes = generateSchedule(16, 3, 10, g, true, new Array(16).fill(1));
  assert(JSON.stringify(withoutArg.schedule) === JSON.stringify(withAllOnes.schedule),
    'all-1 joinRounds must produce the identical schedule to omitting the argument');
  assert(JSON.stringify(withoutArg.sitOutCount) === JSON.stringify(withAllOnes.sitOutCount),
    'sitOutCount must match');
  // With nobody late the two counters are equal element-for-element.
  assert(JSON.stringify(withAllOnes.sitOutCount) === JSON.stringify(withAllOnes.voluntaryByeCount),
    'with nobody late, total and voluntary bye counts must be equal');
  resetScheduleRng();
});

test('Late arrivals: joinRounds input validation', () => {
  const g = makeGenders(8, 8);
  assert(throws(() => generateSchedule(16, 3, 10, g, true, new Array(15).fill(1))),
    'rejects joinRounds length mismatch');
  assert(throws(() => generateSchedule(16, 3, 10, g, true, new Array(16).fill(0))),
    'rejects joinRound below 1');
  assert(throws(() => generateSchedule(16, 3, 10, g, true, new Array(16).fill(11))),
    'rejects joinRound beyond numRounds');
  const bad = new Array(16).fill(1); bad[3] = 2.5;
  assert(throws(() => generateSchedule(16, 3, 10, g, true, bad)),
    'rejects non-integer joinRound');
});

test('Late arrivals: too many absent to field the courts throws', () => {
  const g = makeGenders(8, 8);
  // 3 courts needs 12; marking 5 absent in round 1 leaves 11.
  const joinRounds = new Array(16).fill(1);
  for (let i = 0; i < 5; i++) joinRounds[i] = 2;
  assert(throws(() => generateSchedule(16, 3, 10, g, true, joinRounds)),
    'rejects a round with fewer available players than courts*4');
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
node tests/schedule.test.js 2>&1 | tail -25
```

Expected: the six new tests fail. `joinRounds` is currently ignored, so absence is not respected, `result.voluntaryByeCount` is `undefined`, and none of the validation throws fire.

- [ ] **Step 4: Add the parameter and its validation**

Change the signature at `js/schedule.js:109` from

```javascript
function generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed) {
```

to

```javascript
function generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed, joinRounds) {
```

Then, immediately after the existing `genders` validation loop (the `for` loop that rejects non-`M`/`F` tokens) and before `const n = numPlayers;`, insert:

```javascript
  // Late arrivals: joinRounds[i] is the 1-based round player i first plays.
  // Optional — omitting it means everybody is present from round 1, which is
  // the behaviour every existing caller relies on.
  const joins = joinRounds === undefined || joinRounds === null
    ? new Array(numPlayers).fill(1)
    : joinRounds;
  if (!Array.isArray(joins) || joins.length !== numPlayers) {
    throw new Error(`joinRounds must be an array of length ${numPlayers} (got length ${joins && joins.length})`);
  }
  for (let i = 0; i < joins.length; i++) {
    if (!Number.isInteger(joins[i]) || joins[i] < 1 || joins[i] > numRounds) {
      throw new Error(`joinRounds[${i}] must be an integer between 1 and ${numRounds} (got ${JSON.stringify(joins[i])})`);
    }
  }
  // Every round must still have enough present players to fill the courts.
  for (let r = 1; r <= numRounds; r++) {
    let available = 0;
    for (let i = 0; i < numPlayers; i++) if (joins[i] <= r) available++;
    if (available < numCourts * 4) {
      throw new Error(`Round ${r} has only ${available} available players; ${numCourts} courts need ${numCourts * 4}`);
    }
  }
```

- [ ] **Step 5: Add the voluntary-bye counter alongside the existing one**

After the existing `const sitOutCount = new Array(n).fill(0);` (`js/schedule.js:122`), add:

```javascript
  // sitOutCount is the total a human sees ("N byes"); voluntaryByeCount excludes
  // byes forced by a late arrival, and is what every fairness signal reads. A
  // forced bye is not unfairness, and counting it as such would make the
  // scheduler over-favour late arrivals for the rest of the session.
  const voluntaryByeCount = new Array(n).fill(0);
```

Then replace every fairness read of `sitOutCount` with `voluntaryByeCount`. There are six, all inside Phase 1:

- `:185` — `if (sitOutCount[a] !== sitOutCount[b]) return sitOutCount[a] - sitOutCount[b];`
- `:197` — `const globalMinSitOut = Math.min(...sitOutCount);`
- `:215` and `:218` — the male `unfair` test and the squared `fairness` term
- `:222` and `:223` — the female equivalents
- `:295` — the second `sitOutCount[a] !== sitOutCount[b]` comparison, inside the pick-which-players-sit block

Locate each by content, not by line number, since earlier edits shift them. In every case substitute `voluntaryByeCount` for `sitOutCount`; change nothing else about those expressions.

At `:197`, the minimum must be taken over **available** players only, otherwise an absent player's zero drags `globalMinSitOut` down and makes every present player look unfair:

```javascript
      let globalMinSitOut = Infinity;
      for (let i = 0; i < n; i++) {
        if (joins[i] <= r + 1 && voluntaryByeCount[i] < globalMinSitOut) globalMinSitOut = voluntaryByeCount[i];
      }
      if (globalMinSitOut === Infinity) globalMinSitOut = 0;
```

- [ ] **Step 6: Force absent players onto byes in Phase 1**

Phase 1 begins at `js/schedule.js:141` with `for (let r = 0; r < numRounds; r++) {`. Round number is `r + 1`.

Immediately after the `const indices = Array.from({length: n}, (_, i) => i);` line, add:

```javascript
    // Players who have not arrived yet are forced onto byes for this round.
    // They are excluded from the candidate pool below, so the existing
    // fairness/cooldown/co-bye logic only ever chooses among people present.
    const forcedByes = new Set();
    for (let i = 0; i < n; i++) if (joins[i] > r + 1) forcedByes.add(i);
    const availableIndices = indices.filter(i => !forcedByes.has(i));
```

Then, in the two priority lists further down, filter to available players. Change

```javascript
    const malesByPriority = indices.filter(i => genders[i] === 'M').sort(sitOutPriority);
    const femalesByPriority = indices.filter(i => genders[i] === 'F').sort(sitOutPriority);
```

to

```javascript
    const malesByPriority = availableIndices.filter(i => genders[i] === 'M').sort(sitOutPriority);
    const femalesByPriority = availableIndices.filter(i => genders[i] === 'F').sort(sitOutPriority);
```

`totalM` and `totalF` are derived from those two arrays' lengths, so gender parity — `idealSitMPerRound`, `cumMaleByes`, `genderDev`, and the `playM`-even rule for `preferMixed` — now operates over present players automatically.

The number of voluntary bye slots shrinks by the forced count. Find where `numSitOuts` is used inside the round loop to size the bye selection and use a per-round value instead:

```javascript
    const roundSitOuts = numSitOuts - forcedByes.size;
```

Use `roundSitOuts` in place of `numSitOuts` for the in-round selection (the `evaluateSitM` bounds and the `sitM`/`sitF` arithmetic). Leave the module-level `numSitOuts` alone — `idealGap` and `hardCooldown` are computed from it before the loop and should keep using the schedule-wide value.

Finally, merge the forced byes into the round's sit-out set. Find

```javascript
    sitOuts = new Set([
```

and after that set is fully built (immediately before `const playing = indices.filter(i => !sitOuts.has(i));`), add:

```javascript
    // Forced byes join the round's sit-out list so downstream consumers — the
    // "On bye" line, the CSV export, sitOutCount — see them as byes, which is
    // what they are from a player's point of view.
    forcedByes.forEach(i => sitOuts.add(i));
```

- [ ] **Step 7: Count the two kinds of bye separately**

Replace `js/schedule.js:317`:

```javascript
    sitOuts.forEach(i => sitOutCount[i]++);
```

with

```javascript
    sitOuts.forEach(i => {
      sitOutCount[i]++;
      if (!forcedByes.has(i)) voluntaryByeCount[i]++;
    });
```

- [ ] **Step 8: Return the new fields**

Change `js/schedule.js:534` from

```javascript
  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, playCount, coByeCount };
```

to

```javascript
  return { schedule, partnerCount, opponentCount, courtCount, sitOutCount, voluntaryByeCount, playCount, coByeCount, joinRounds: joins };
```

- [ ] **Step 9: Run the new tests and the full suite**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
node --check js/schedule.js && echo "parses"
node tests/schedule.test.js 2>&1 | tail -20
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
```

Expected: all six new tests pass; `npm test` exits 0; the utils and ladder counts are still exactly `89 passed, 0 failed` and `40 passed, 0 failed`. The schedule count is higher than 3631 — record the new number, later tasks reference it.

If the byte-identical test fails, the most likely cause is that the forced-bye code path runs even when `forcedByes` is empty and perturbs the RNG. It must not: `_rng()` is called the same number of times whether or not anybody is late. Check that you added no `_rng()` call inside the new code.

- [ ] **Step 10: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add js/schedule.js tests/schedule.test.js
git commit -m "Add joinRounds to generateSchedule for late arrivals

Players with a joinRound above the current round are forced onto byes before
the fairness logic picks the remaining bye slots, so the schedule is optimised
around the absence in one pass. Forced byes are tracked in a separate
voluntaryByeCount and excluded from every fairness signal — counting them as
unfairness would make the scheduler over-favour late arrivals for the rest of
the session. sitOutCount keeps its meaning of total byes for the stats display.

The parameter is optional and all-1 is byte-identical to omitting it, which is
asserted directly so the 21 existing call sites stay safe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Score bye fairness on voluntary byes

**Files:**
- Modify: `js/schedule.js:791-808` (`scoreSchedule`), `:1109`+ (`generateBestSchedule`), `:1141`+ (`generateBestScheduleAsync`)
- Test: `tests/schedule.test.js`

**Interfaces:**
- Consumes: `result.voluntaryByeCount` and `result.joinRounds` from Task 1.
- Produces: `generateBestSchedule(numPlayers, numCourts, numRounds, genders, preferMixed, options)` and `generateBestScheduleAsync(numPlayers, numCourts, numRounds, genders, preferMixed, onProgress, onComplete, options)` both honour `options.joinRounds`. `scoreSchedule(result, n, genders)` keeps its signature exactly.

- [ ] **Step 1: Write the failing tests**

Add to `tests/schedule.test.js`, before the summary block:

```javascript
test('Late arrivals: scoreSchedule measures byes on the voluntary counter', () => {
  setScheduleRng(mulberry32(505));
  const joinRounds = new Array(16).fill(1);
  joinRounds[0] = 5;   // misses 4 rounds — would look wildly unfair on totals
  const result = generateSchedule(16, 3, 10, makeGenders(8, 8), true, joinRounds);
  const score = scoreSchedule(result, 16, makeGenders(8, 8));

  const totalSpread = Math.max(...result.sitOutCount) - Math.min(...result.sitOutCount);
  assert(totalSpread >= 2,
    `sanity: totals should look unfair for a 4-round absence (got ${totalSpread})`);
  assert(score.byeSpread <= 1,
    `byeSpread must be measured on voluntary byes, so <= 1 (got ${score.byeSpread})`);
  assert(score.maxMidByeSpread <= 1,
    `maxMidByeSpread must also use voluntary byes (got ${score.maxMidByeSpread})`);
  resetScheduleRng();
});

test('Late arrivals: scoreSchedule unchanged when nobody is late', () => {
  const g = makeGenders(8, 8);
  setScheduleRng(mulberry32(606));
  const a = generateSchedule(16, 3, 10, g, true);
  const sa = scoreSchedule(a, 16, g);
  setScheduleRng(mulberry32(606));
  const b = generateSchedule(16, 3, 10, g, true, new Array(16).fill(1));
  const sb = scoreSchedule(b, 16, g);
  assert(JSON.stringify(sa) === JSON.stringify(sb),
    'scores must be identical with and without an all-1 joinRounds');
  resetScheduleRng();
});

test('Late arrivals: generateBestSchedule honours options.joinRounds', () => {
  setScheduleRng(mulberry32(707));
  const joinRounds = new Array(16).fill(1);
  joinRounds[2] = 3;
  const result = generateBestSchedule(16, 3, 10, makeGenders(8, 8), true,
    { timeBudgetMs: 600, plateauMs: 300, repairMs: 60, joinRounds });
  for (const round of result.schedule) {
    if (round.round >= 3) continue;
    const plays = round.courts.some(c => c.teamA.includes(2) || c.teamB.includes(2));
    assert(!plays, `player 2 must not play round ${round.round}`);
  }
  checkNoDuplicates(result, 16);
  checkAllCourtsHaveFourPlayers(result);
  resetScheduleRng();
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
node tests/schedule.test.js 2>&1 | tail -20
```

Expected: the voluntary-counter test fails because `scoreSchedule` still reads `sitOutCount`; the `generateBestSchedule` test fails because `options.joinRounds` is ignored.

- [ ] **Step 3: Switch `scoreSchedule`'s bye metrics to voluntary byes**

In `js/schedule.js`, change the destructure at `:792` from

```javascript
  const { partnerCount, opponentCount, sitOutCount } = result;
```

to

```javascript
  const { partnerCount, opponentCount, sitOutCount, voluntaryByeCount, joinRounds } = result;
  // Bye fairness is judged on voluntary byes only. A bye forced by a late
  // arrival is not unfairness, and scoring it as such would make every
  // late-arrival schedule look permanently unfair — compareScores would then
  // rank all candidates against an unreachable target and the optimiser would
  // spend its whole budget chasing it, silently degrading partner and opponent
  // diversity. Falls back to sitOutCount for externally built results.
  const byeCounts = voluntaryByeCount || sitOutCount;
  const joins = joinRounds || null;
```

Then change the three lines at `:797-799` from

```javascript
  const maxSitOut = sitOutCount ? Math.max(0, ...sitOutCount) : 0;
  const minSitOut = sitOutCount ? Math.min(...sitOutCount) : 0;
  const byeSpread = maxSitOut - minSitOut;
```

to

```javascript
  const maxSitOut = byeCounts ? Math.max(0, ...byeCounts) : 0;
  const minSitOut = byeCounts ? Math.min(...byeCounts) : 0;
  const byeSpread = maxSitOut - minSitOut;
```

- [ ] **Step 4: Make the mid-schedule spread skip forced byes**

`maxMidByeSpread` walks `round.sitOuts`, which contains forced and voluntary byes together, so it needs the same treatment. Replace the block at `:801-808`:

```javascript
  // Mid-schedule bye fairness: track worst spread at any point during the schedule
  let maxMidByeSpread = 0;
  const runningByeCount = new Array(n).fill(0);
  for (const round of result.schedule) {
    round.sitOuts.forEach(p => runningByeCount[p]++);
    const midSpread = Math.max(...runningByeCount) - Math.min(...runningByeCount);
    if (midSpread > maxMidByeSpread) maxMidByeSpread = midSpread;
  }
```

with

```javascript
  // Mid-schedule bye fairness: worst spread at any point during the schedule.
  // Counts voluntary byes only, and compares only players already present —
  // an absent player's zero would otherwise drag the minimum down and make
  // everyone else look unfair.
  let maxMidByeSpread = 0;
  const runningByeCount = new Array(n).fill(0);
  for (const round of result.schedule) {
    round.sitOuts.forEach(p => {
      if (!joins || joins[p] <= round.round) runningByeCount[p]++;
    });
    let lo = Infinity, hi = 0;
    for (let i = 0; i < n; i++) {
      if (joins && joins[i] > round.round) continue;
      if (runningByeCount[i] < lo) lo = runningByeCount[i];
      if (runningByeCount[i] > hi) hi = runningByeCount[i];
    }
    const midSpread = lo === Infinity ? 0 : hi - lo;
    if (midSpread > maxMidByeSpread) maxMidByeSpread = midSpread;
  }
```

- [ ] **Step 5: Thread `options.joinRounds` through both wrappers**

In `generateBestSchedule` (`js/schedule.js:1109`), after the existing `const repairMs = ...` line, add:

```javascript
  const joinRounds = options && options.joinRounds;
```

and change its `generateSchedule` call at `:1121` to pass it:

```javascript
    const result = generateSchedule(numPlayers, numCourts, numRounds, genders, preferMixed, joinRounds);
```

Do exactly the same in `generateBestScheduleAsync` (`js/schedule.js:1141`), whose `generateSchedule` call is at `:1155`. Its signature already ends in `options`, so **do not add a positional parameter** — positions 6 and 7 are `onProgress` and `onComplete`.

- [ ] **Step 6: Run the tests and the full suite**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
node --check js/schedule.js && echo "parses"
node tests/schedule.test.js 2>&1 | tail -20
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
```

Expected: all three new tests pass, `npm test` exits 0, utils still `89 passed` and ladder still `40 passed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add js/schedule.js tests/schedule.test.js
git commit -m "Score bye fairness on voluntary byes, not total byes

scoreSchedule derived byeSpread and maxMidByeSpread from sitOutCount, which now
includes byes forced by a late arrival. Left alone, every late-arrival schedule
would score as permanently unfair, compareScores would rank all candidates
against an unreachable target, and the multi-start optimiser would spend its
whole budget chasing it — degrading the partner and opponent diversity the tool
exists to provide. Both metrics now use voluntaryByeCount and compare only
players already present.

joinRounds travels via options.joinRounds in both multi-start wrappers, since
generateBestScheduleAsync already uses positions 6 and 7 for its callbacks.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Setup UI and availability validation

**Files:**
- Modify: `js/schedule-ui.js` — `buildPlayerGrid` (~`:34-48`), `savePlayerData` (`:224`), a new `getJoinRounds()`, `collectValidationErrors`, `generate()`
- Modify: `css/styles.css`

**Interfaces:**
- Consumes: `generateBestScheduleAsync(..., options)` honouring `options.joinRounds`, from Task 2.
- Produces: `playerData[i].joinRound` (optional, defaults to `1` at read time); `getJoinRounds()` returning an array of length `currentPlayerCount`; a per-row control with ids `late{i}` (checkbox) and `joinRound{i}` (number input).

- [ ] **Step 1: Confirm the anchors**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
sed -n '34p' js/schedule-ui.js
sed -n '224p' js/schedule-ui.js
grep -n "function getGenders" js/schedule-ui.js
grep -n "generateBestScheduleAsync(" js/schedule-ui.js
```

Expected: line 34 is the `div.innerHTML = ...` template that builds a player row; line 224 is the `playerData.push({ name: ..., gender: ..., genderManual: ... })` call. Line numbers will have shifted from Tasks 1-2 only if those touched this file — they did not — but locate by content regardless and report what you find.

- [ ] **Step 2: Add the late control to each player row**

In `buildPlayerGrid`, the row template currently ends with the gender toggle's closing `</div>`. Append a late control after it, so the template reads:

```javascript
    div.innerHTML = `<span class="player-num">${i + 1}.</span><input type="text" id="p${i}" placeholder="Player ${i + 1}">` +
      `<div class="gender-toggle">` +
      `<input type="radio" name="g${i}" id="g${i}m" value="M" checked>` +
      `<label for="g${i}m" class="g-m">M</label>` +
      `<input type="radio" name="g${i}" id="g${i}f" value="F">` +
      `<label for="g${i}f" class="g-f">F</label>` +
      `</div>` +
      `<div class="late-control">` +
      `<input type="checkbox" id="late${i}" class="late-check">` +
      `<label for="late${i}" class="late-label" title="Arrives late — sits out until their join round">⏱</label>` +
      `<input type="number" id="joinRound${i}" class="join-round-input" min="2" max="30" value="2" ` +
      `aria-label="Player ${i + 1} joins from round">` +
      `</div>`;
```

`min="2"` because a join round of 1 means present from the start, which is what unchecking the box expresses.

- [ ] **Step 3: Restore saved state and wire the handlers**

Still in `buildPlayerGrid`, inside the `if (i < playerData.length)` restore block — right after the existing `if (playerData[i].genderManual) div.dataset.genderManual = '1';` — add:

```javascript
      // Read-time default: payloads saved before this feature have no joinRound.
      const jr = playerData[i].joinRound || 1;
      if (jr > 1) {
        document.getElementById(`late${i}`).checked = true;
        document.getElementById(`joinRound${i}`).value = jr;
      }
```

Then, after the existing gender-toggle `change` listeners are attached, add:

```javascript
    const lateCheck = document.getElementById(`late${i}`);
    const joinInput = document.getElementById(`joinRound${i}`);
    const onLateChange = function() {
      // Marking someone late changes the roster, so an unplayed schedule is
      // retired exactly as a name or count edit would retire it.
      setupChanged();
      refreshValidationBanner();
      saveState();
    };
    lateCheck.addEventListener('change', onLateChange);
    joinInput.addEventListener('input', function() {
      this.classList.remove('input-error');
      onLateChange();
    });
```

- [ ] **Step 4: Persist and read the value**

Change `savePlayerData`'s push at `js/schedule-ui.js:224` from

```javascript
    if (el) playerData.push({ name: el.value, gender: gf && gf.checked ? 'F' : 'M', genderManual: el.parentElement.dataset.genderManual === '1' });
```

to

```javascript
    if (el) {
      const lateEl = document.getElementById(`late${i}`);
      const jrEl = document.getElementById(`joinRound${i}`);
      const joinRound = lateEl && lateEl.checked ? (parseInt(jrEl && jrEl.value) || 1) : 1;
      playerData.push({
        name: el.value,
        gender: gf && gf.checked ? 'F' : 'M',
        genderManual: el.parentElement.dataset.genderManual === '1',
        joinRound,
      });
    }
```

Add a reader next to `getGenders`:

```javascript
// 1-based round each player first plays. 1 = present from the start, which is
// what an unchecked late box means.
function getJoinRounds() {
  const joins = [];
  for (let i = 0; i < currentPlayerCount; i++) {
    const lateEl = document.getElementById(`late${i}`);
    const jrEl = document.getElementById(`joinRound${i}`);
    joins.push(lateEl && lateEl.checked ? (parseInt(jrEl && jrEl.value) || 1) : 1);
  }
  return joins;
}
```

- [ ] **Step 5: Validate availability**

In `collectValidationErrors`, immediately after the existing court-number duplicate check and before the rounds range check, add:

```javascript
  // Late arrivals: every round needs enough present players to fill the courts.
  const joins = getJoinRounds();
  if (!isNaN(numPlayers) && !isNaN(numCourts) && !isNaN(rounds) && rounds >= 1) {
    for (let i = 0; i < currentPlayerCount; i++) {
      if (joins[i] > rounds) {
        flagField(document.getElementById(`joinRound${i}`));
        errors.push(`Player ${i + 1} joins at round ${joins[i]}, but there are only ${rounds} rounds`);
      }
    }
    for (let r = 1; r <= rounds; r++) {
      let available = 0;
      for (let i = 0; i < currentPlayerCount; i++) if (joins[i] <= r) available++;
      if (available < numCourts * 4) {
        errors.push(`Round ${r} has only ${available} of the ${numCourts * 4} players ` +
          `${numCourts} courts need — drop to ${Math.floor(available / 4)} court` +
          `${Math.floor(available / 4) === 1 ? '' : 's'}, or lower a join round`);
        break;   // one message is enough; the first short round is the actionable one
      }
    }
  }
```

`rounds` is already in scope — it is parsed by the existing rounds check. If that check appears *after* the insertion point in the current file, move your block below it so `rounds` is defined; verify by reading the function rather than assuming.

- [ ] **Step 6: Pass joinRounds to the generator**

In `generate()`, change the `generateBestScheduleAsync` call so the trailing `options` argument carries the join rounds. The call currently ends with the `onComplete` function and no options object; add one:

```javascript
  generateBestScheduleAsync(numPlayers, numCourts, rounds, genders, preferMixed,
    function onProgress(info) { /* ...unchanged... */ },
    function onComplete(scheduleResult) { /* ...unchanged... */ },
    { joinRounds: getJoinRounds() }
  );
```

Leave both callback bodies exactly as they are — only the trailing argument is new.

- [ ] **Step 7: Style the control**

Add to `css/styles.css`, immediately after the `.gender-toggle` rules:

```css
  /* Late-arrival control. The round input only appears once the box is ticked —
     a permanent extra field on every row would crowd a 40-row grid. */
  .late-control { display: flex; align-items: center; gap: 0.3rem; }
  .late-check { position: absolute; opacity: 0; pointer-events: none; }
  .late-label {
    cursor: pointer; font-size: 0.8rem; line-height: 1;
    padding: 0.25rem 0.35rem; border-radius: 6px;
    color: #5a5f72; border: 1px solid transparent;
    transition: all 0.2s ease; user-select: none;
  }
  .late-label:hover { color: #a5b4fc; }
  .late-check:checked + .late-label {
    color: #fbbf24; background: rgba(251,191,36,0.12);
    border-color: rgba(251,191,36,0.3);
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
  [data-theme="light"] .late-label { color: #9aa1ad; }
  [data-theme="light"] .join-round-input { background: #fff; border-color: #d5d9e2; color: #1b1e26; }
```

- [ ] **Step 8: Verify syntax, suite, and file scope**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
for f in js/*.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done && echo "all js parse"
python3 -c "s=open('css/styles.css').read(); print('braces', s.count('{'), s.count('}'), 'balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
grep -n "getJoinRounds\|joinRound\${i}\|late\${i}" js/schedule-ui.js | head
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
```

Expected: all JS parses; braces balanced; `getJoinRounds` defined once and called from both `collectValidationErrors` and `generate()`; `npm test` exit 0; `git diff --name-only` lists only `js/schedule-ui.js` and `css/styles.css`.

- [ ] **Step 9: Commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
git add js/schedule-ui.js css/styles.css
git commit -m "Add the late-arrival setup control and availability validation

Each player row gains a clock toggle that reveals a join-round input only when
ticked, so a 40-row grid does not carry a permanent extra field. joinRound
persists on playerData with a read-time default of 1, so payloads saved before
this feature stay valid without a schema bump.

Generate is blocked when any round would have fewer present players than the
courts need, naming the first short round and both remedies. Toggling late
calls setupChanged(), retiring an unplayed schedule exactly as a name edit does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verify in a browser, then version and document

**Files:**
- Create: `/tmp/late-verify.mjs` (throwaway, not committed)
- Modify: `index.html` (version), `package.json` (version), `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-3, served over HTTP.
- Produces: `2.13.0` in both version files.

- [ ] **Step 1: Start the server and headless Chrome**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
python3 -m http.server 8765 --bind 127.0.0.1 > /tmp/serve.log 2>&1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9222 --no-first-run --no-default-browser-check \
  --user-data-dir=/tmp/late-profile --hide-scrollbars about:blank > /tmp/chrome.log 2>&1 &
sleep 3
curl -s http://127.0.0.1:9222/json/version | head -2
```

Expected: a `"Browser": "Chrome/..."` line. If not, `cat /tmp/chrome.log`.

- [ ] **Step 2: Write the harness**

Create `/tmp/late-verify.mjs`:

```javascript
// Drives the real app over CDP. Node >=22 has a global WebSocket, so no deps.
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
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1400, deviceScaleFactor: 2, mobile: false });

const NAMES = ['T','Phil','Chandler','Kevin Savage','Kevin M','Amy','Leanne','Yolie',
               'Matt','Ravi','Rob','Hazel','Cyndi','Iopu','Rene W','Dina'];

async function boot() {
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
}

console.log('\n1) The control shows and hides its round input');
await boot();
check('join-round input hidden before ticking',
  await ev(`getComputedStyle(document.getElementById('joinRound0')).display`) === 'none');
await ev(`(() => { const c = document.getElementById('late0');
  c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true})); })()`);
await new Promise(r => setTimeout(r, 200));
check('join-round input visible after ticking',
  await ev(`getComputedStyle(document.getElementById('joinRound0')).display`) !== 'none');

console.log('\n2) getJoinRounds reflects the UI');
await ev(`(() => { const j = document.getElementById('joinRound0');
  j.value = 3; j.dispatchEvent(new Event('input', {bubbles:true})); })()`);
await new Promise(r => setTimeout(r, 200));
let joins = await ev('getJoinRounds()');
check('player 0 joins at 3, everyone else at 1',
  joins[0] === 3 && joins.slice(1).every(v => v === 1), JSON.stringify(joins));

console.log('\n3) Generating honours the absence');
await ev('generate()');
for (let i = 0; i < 80; i++) {
  if (await ev(`document.getElementById('output').style.display`) === 'block') break;
  await new Promise(r => setTimeout(r, 250));
}
check('schedule rendered', await ev(`document.getElementById('output').style.display`) === 'block');
const absence = await ev(`(() => {
  const out = { r1: null, r2: null, playsLater: false };
  const name = document.getElementById('p0').value;
  for (const round of scheduleData) {
    const plays = round.courts.some(c => c.teamA.includes(0) || c.teamB.includes(0));
    if (round.round === 1) out.r1 = plays;
    if (round.round === 2) out.r2 = plays;
    if (round.round >= 3 && plays) out.playsLater = true;
  }
  out.byeR1 = scheduleData[0].sitOuts.includes(0);
  out.name = name;
  return out;
})()`);
check('player 0 does not play round 1', absence.r1 === false);
check('player 0 does not play round 2', absence.r2 === false);
check('player 0 is listed on bye in round 1', absence.byeR1 === true);
check('player 0 does play from round 3', absence.playsLater === true);

console.log('\n4) Over-capacity is blocked with a useful message');
await boot();
await ev(`(() => {
  const fire = (el, ty) => el.dispatchEvent(new Event(ty, { bubbles: true }));
  for (let i = 0; i < 5; i++) {
    const c = document.getElementById('late' + i);
    c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true}));
    const j = document.getElementById('joinRound' + i);
    j.value = 2; fire(j, 'input');
  }
})()`);
await new Promise(r => setTimeout(r, 200));
await ev('generate()');
await new Promise(r => setTimeout(r, 600));
const blocked = await ev(`(() => {
  const b = document.getElementById('errorBanner');
  return { shown: getComputedStyle(b).display !== 'none', text: b.textContent,
           outputHidden: document.getElementById('output').style.display !== 'block' };
})()`);
check('Generate blocked', blocked.outputHidden === true);
check('banner shown', blocked.shown === true);
check('message names the short round and a remedy',
  /Round 1 has only 11/.test(blocked.text) && /court/.test(blocked.text), JSON.stringify(blocked.text));

console.log('\n5) Nobody late = unchanged behaviour');
await boot();
await ev('generate()');
for (let i = 0; i < 80; i++) {
  if (await ev(`document.getElementById('output').style.display`) === 'block') break;
  await new Promise(r => setTimeout(r, 250));
}
const plain = await ev(`(() => ({
  rounds: scheduleData.length,
  everyRoundFull: scheduleData.every(r => r.courts.reduce((t,c)=>t+c.teamA.length+c.teamB.length,0) === 12),
  joins: getJoinRounds(),
}))()`);
check('10 rounds generated', plain.rounds === 10);
check('every round fields 12 players', plain.everyRoundFull === true);
check('all join rounds are 1', plain.joins.every(v => v === 1));

console.log('\n6) joinRound survives a reload');
await boot();
await ev(`(() => {
  const c = document.getElementById('late4');
  c.checked = true; c.dispatchEvent(new Event('change', {bubbles:true}));
  const j = document.getElementById('joinRound4');
  j.value = 4; j.dispatchEvent(new Event('input', {bubbles:true}));
})()`);
await new Promise(r => setTimeout(r, 300));
await send('Page.navigate', { url: APP });
await new Promise(r => setTimeout(r, 1400));
const restored = await ev(`(() => ({
  checked: document.getElementById('late4').checked,
  value: document.getElementById('joinRound4').value,
  joins: getJoinRounds(),
}))()`);
check('late box still ticked after reload', restored.checked === true);
check('join round still 4 after reload', String(restored.value) === '4', JSON.stringify(restored));
check('getJoinRounds reflects it', restored.joins[4] === 4, JSON.stringify(restored.joins));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync('/tmp/late-setup.png', Buffer.from(shot.data, 'base64'));
console.log('  -> /tmp/late-setup.png');

console.log(`\n${pass} passed, ${fail} failed`);
ws.close();
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the harness**

```bash
cd /tmp && node late-verify.mjs
```

Expected: `17 passed, 0 failed`, exit 0. If the over-capacity message assertion fails, read the actual banner text in the output and check the wording produced by Task 3 Step 5 — fix the code or the assertion's regex to match the real message, but do not weaken the assertion to always pass.

- [ ] **Step 4: Look at the screenshot**

Open `/tmp/late-setup.png` and confirm the late toggle reads clearly in the player grid, the ticked state is visually distinct, and the join-round input does not crowd the gender toggle. Report what you see. A blank image means the page failed to load — check `/tmp/chrome.log`.

- [ ] **Step 5: Tear down**

```bash
pkill -f "http.server 8765"; pkill -f "late-profile"
sleep 1; rm -rf /tmp/late-profile /tmp/chrome.log /tmp/serve.log /tmp/late-verify.mjs
curl -s -m 2 -o /dev/null http://127.0.0.1:8765/ && echo "STILL SERVING" || echo "server stopped"
```

Keep `/tmp/late-setup.png` for the controller.

- [ ] **Step 6: Bump the version**

`index.html` line 13: `APP_VERSION = "2.12.0"` → `"2.13.0"`. `package.json` line 3: `"version": "2.12.0",` → `"2.13.0",`. Minor bump — new user-visible capability. Both must match exactly; `APP_VERSION` is the cache-buster on every JS and CSS URL.

- [ ] **Step 7: Update the README**

Read the file first and match its existing voice and bullet style — bold lead-in, em dash, no trailing period on Features bullets.

Add to the Round Robin Mode list:

```markdown
- **Late arrivals** — mark anyone who's running behind and set the round they'll join; they sit out until then and the whole schedule is optimised around their absence in one pass, with their forced byes excluded from bye-fairness so nobody else is penalised for it
```

Then qualify the bye-fairness row in the Scheduling-guarantees table. It currently reads:

```
| Bye spread | ≤ 1 after every round, not just at the end — no player receives an (N+1)th bye until everyone has had N |
```

Change it to:

```
| Bye spread | ≤ 1 after every round, not just at the end — no player receives an (N+1)th bye until everyone has had N. Measured over rounds in which the player was present, so a late arrival's forced byes don't count against anyone |
```

- [ ] **Step 8: Verify and commit**

```bash
cd /Users/chong/Documents/GitHub/pickleball-ladder-powerplay
grep -rn '2\.13\.0' index.html package.json
grep -rn '2\.12\.0' index.html package.json || echo "no stale version"
npm test > /tmp/t.log 2>&1; echo "exit: $?"; grep -E "passed, [0-9]+ failed" /tmp/t.log; rm -f /tmp/t.log
git diff --name-only
git add index.html package.json README.md
git commit -m "v2.13.0: Late arrivals for Round Robin

Bump APP_VERSION so returning visitors get the new assets, document the
feature, and qualify the bye-fairness guarantee: the spread is measured over
rounds in which a player was present, so forced byes don't count against
anyone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Expected: exactly two `2.13.0` matches, no stale `2.12.0`, `npm test` exit 0, and `git diff --name-only` listing only `index.html`, `package.json`, `README.md`.

- [ ] **Step 9: Do not push**

Report to the controller instead. Pushing deploys to a live public site and needs the owner's approval.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Mark a player as joining from round N during setup | Task 3 Steps 2-4 |
| Generator forces them onto byes until then | Task 1 Step 6 |
| Whole schedule optimised in one pass (no recalculation) | Task 1 — absence is an input to generation, not a patch |
| Forced byes excluded from bye fairness | Task 1 Steps 5, 7; Task 2 Steps 3-4 |
| Two counters with an explicit contract | Task 1 Steps 5, 7, 8; asserted Task 1 Step 2 and Task 2 Step 1 |
| `scoreSchedule` uses voluntary byes | Task 2 Steps 3-4 |
| `maxMidByeSpread` skips forced byes | Task 2 Step 4 |
| Gender parity over available players | Task 1 Step 6 (via the filtered priority lists) |
| Block generation when a round is short | Task 1 Step 4 (generator guard); Task 3 Step 5 (UI message); asserted Task 4 Step 3 |
| `joinRound` bounds-checked to 1..numRounds | Task 1 Step 4; Task 3 Step 5 |
| No `STATE_SCHEMA_VERSION` bump; read-time default | Task 3 Step 3; asserted Task 4 Step 6 |
| Unchanged when nobody is marked late | Task 1 Step 2 (byte-identical test), Task 2 Step 1 (score-identical test), Task 4 Step 5 |
| `options.joinRounds` in both wrappers, not positional | Task 2 Step 5 |
| Court count stays global | Global Constraints; no task touches `playersPerRound` |
| Ladder untouched | Global Constraints; no task opens `js/ladder.js` |
| Version bump and README, incl. guarantee qualification | Task 4 Steps 6-7 |

No gaps.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"add validation". Every code step carries literal JavaScript, CSS, or shell. Task 4 Step 4 asks for a judgement about visual crowding, which cannot be pre-decided, but states what to look at and requires reporting it.

**Type consistency:** `joinRounds` is the array everywhere (parameter, `options.joinRounds`, `result.joinRounds`); `joinRound` singular is the per-player field on `playerData` and the DOM id prefix. `voluntaryByeCount` is spelled identically in Tasks 1, 2 and both self-review rows. Element ids `late{i}` and `joinRound{i}` match between Task 3 Steps 2-5 and Task 4's harness. `getJoinRounds()` is defined in Task 3 Step 4 and called in Steps 5-6 and by Task 4's harness. Version `2.13.0` appears identically in Task 4 Steps 6 and 8.

**Known risks, flagged deliberately:**

1. **Task 1 Step 5 is the riskiest edit in the plan** — six separate `sitOutCount` reads must become `voluntaryByeCount`, located by content because line numbers shift as the file is edited. Missing one leaves a fairness signal reading total byes, which is exactly the bug the whole feature is designed to avoid, and it would not necessarily fail a test. The reviewer should grep for remaining `sitOutCount` reads inside Phase 1 and confirm each is intentional.
2. **The byte-identical test in Task 1 Step 2 is the regression guard for 3,631 existing assertions.** If it fails, the new code perturbed the RNG stream. No `_rng()` call may be added inside the new code paths.
3. `roundSitOuts` replaces `numSitOuts` only for the in-round selection arithmetic. `idealGap` and `hardCooldown` are computed before the loop from the schedule-wide value and must keep using it, or bye spacing changes for everyone even when nobody is late.
