// Smoke tests for the round-robin schedule generator.
// Run: node tests/schedule.test.js
//
// Deterministic runs via seedable RNG. These tests exist to catch
// regressions in core invariants: duplicate players, gender rules,
// bye fairness, partner repeats, and input validation.

const {
  generateSchedule,
  generateBestSchedule,
  scoreSchedule,
  compareScores,
  repairSchedule2opt,
  adaptiveTimeBudgetMs,
  setScheduleRng,
  resetScheduleRng,
  mulberry32,
} = require('../js/schedule.js');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL: ${msg}`);
  }
}

function test(name, fn) {
  console.log(`\n▶ ${name}`);
  try {
    fn();
  } catch (e) {
    failed++;
    failures.push(`${name}: threw ${e.message}`);
    console.log(`  FAIL: threw ${e.message}`);
  }
}

function makeGenders(males, females) {
  return 'M'.repeat(males).split('').concat('F'.repeat(females).split(''));
}

// --- Invariant checkers ---------------------------------------------

function checkNoDuplicates(result, numPlayers) {
  for (const round of result.schedule) {
    const seen = new Set();
    for (const court of round.courts) {
      for (const p of [...court.teamA, ...court.teamB]) {
        assert(!seen.has(p), `Duplicate player ${p} in round ${round.round}`);
        seen.add(p);
      }
    }
    for (const p of round.sitOuts) {
      assert(!seen.has(p), `Sit-out player ${p} also plays in round ${round.round}`);
      seen.add(p);
    }
    assert(seen.size === numPlayers, `Round ${round.round}: expected ${numPlayers} unique players, saw ${seen.size}`);
  }
}

function checkAllCourtsHaveFourPlayers(result) {
  for (const round of result.schedule) {
    for (const court of round.courts) {
      assert(court.teamA.length === 2, `Round ${round.round} court has teamA length ${court.teamA.length}`);
      assert(court.teamB.length === 2, `Round ${round.round} court has teamB length ${court.teamB.length}`);
    }
  }
}

function countGenderViolations(result, genders) {
  let mmVsFf = 0, threeOneSplit = 0;
  for (const round of result.schedule) {
    for (const court of round.courts) {
      const all = [...court.teamA, ...court.teamB];
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 1 || mc === 3) threeOneSplit++;
      else if (mc === 2 && genders[court.teamA[0]] === genders[court.teamA[1]]) mmVsFf++;
    }
  }
  return { mmVsFf, threeOneSplit };
}

function maxPartnerRepeats(result, n) {
  let max = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (result.partnerCount[i][j] > max) max = result.partnerCount[i][j];
  return max;
}

function byeSpread(result) {
  if (!result.sitOutCount || result.sitOutCount.length === 0) return 0;
  const max = Math.max(...result.sitOutCount);
  const min = Math.min(...result.sitOutCount);
  return max - min;
}

// Worst bye spread measured after EVERY round, not just at the end. byeSpread()
// above only checks the final totals, which a schedule can satisfy while still
// benching one player twice before another has sat at all. Keeping this <= 1 is
// what guarantees "everyone gets their Nth bye before anyone gets their N+1th".
function worstRunningByeSpread(result, n) {
  const running = new Array(n).fill(0);
  let worst = 0;
  for (const round of result.schedule) {
    round.sitOuts.forEach(p => running[p]++);
    const spread = Math.max(...running) - Math.min(...running);
    if (spread > worst) worst = spread;
  }
  return worst;
}

// The round each milestone is reached: when everyone has at least `k` byes, and
// when the first player reaches `k + 1`. Returns Infinity when never reached.
function byeMilestones(result, n, k) {
  const running = new Array(n).fill(0);
  let allAtK = Infinity, firstAtKPlus1 = Infinity;
  for (const round of result.schedule) {
    round.sitOuts.forEach(p => running[p]++);
    if (allAtK === Infinity && Math.min(...running) >= k) allAtK = round.round;
    if (firstAtKPlus1 === Infinity && Math.max(...running) >= k + 1) firstAtKPlus1 = round.round;
  }
  return { allAtK, firstAtKPlus1 };
}

// --- Tests ----------------------------------------------------------

test('Input validation', () => {
  assert(throws(() => generateSchedule(0, 1, 1, [], true)), 'rejects numPlayers=0');
  assert(throws(() => generateSchedule(16, 0, 1, makeGenders(8, 8), true)), 'rejects numCourts=0');
  assert(throws(() => generateSchedule(16, 4, 0, makeGenders(8, 8), true)), 'rejects numRounds=0');
  assert(throws(() => generateSchedule(10, 4, 5, makeGenders(5, 5), true)), 'rejects players < courts*4');
  assert(throws(() => generateSchedule(16, 4, 5, null, true)), 'rejects null genders');
  assert(throws(() => generateSchedule(16, 4, 5, makeGenders(8, 7), true)), 'rejects genders.length mismatch');
  assert(throws(() => generateSchedule(16, 4, 5, ['M', 'F', 'X', 'M', 'M', 'M', 'M', 'M', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'], true)), 'rejects non-M/F tokens');
});

function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

test('Balanced 16p 8M/8F 4c 10r — basic invariants', () => {
  setScheduleRng(mulberry32(42));
  const result = generateSchedule(16, 4, 10, makeGenders(8, 8), true);
  checkNoDuplicates(result, 16);
  checkAllCourtsHaveFourPlayers(result);
  const { mmVsFf, threeOneSplit } = countGenderViolations(result, makeGenders(8, 8));
  assert(mmVsFf === 0, `No MM-vs-FF in balanced pool (got ${mmVsFf})`);
  assert(threeOneSplit === 0, `No 3M/1F in balanced pool (got ${threeOneSplit})`);
  resetScheduleRng();
});

test('Balanced 20p 10M/10F 4c 10r — max partner ≤ 1', () => {
  setScheduleRng(mulberry32(123));
  const result = generateBestSchedule(20, 4, 10, makeGenders(10, 10), true, { timeBudgetMs: 3000, skipRepair: false });
  assert(maxPartnerRepeats(result, 20) === 1, `maxPartner should be 1 (got ${maxPartnerRepeats(result, 20)})`);
  assert(byeSpread(result) <= 1, `byeSpread should be ≤1 (got ${byeSpread(result)})`);
  checkNoDuplicates(result, 20);
  resetScheduleRng();
});

test('All-female 16p 0M/16F 4c 8r (no byes)', () => {
  setScheduleRng(mulberry32(7));
  const genders = makeGenders(0, 16);
  const result = generateSchedule(16, 4, 8, genders, false);
  checkNoDuplicates(result, 16);
  checkAllCourtsHaveFourPlayers(result);
  const { mmVsFf, threeOneSplit } = countGenderViolations(result, genders);
  assert(mmVsFf === 0, 'No MM-vs-FF in all-female pool (trivially)');
  assert(threeOneSplit === 0, 'No 3/1 split in all-female pool (trivially)');
  resetScheduleRng();
});

test('Extreme skew 1M/15F 4c 8r — no crash, no duplicates', () => {
  setScheduleRng(mulberry32(99));
  const genders = makeGenders(1, 15);
  const result = generateSchedule(16, 4, 8, genders, true);
  checkNoDuplicates(result, 16);
  checkAllCourtsHaveFourPlayers(result);
  resetScheduleRng();
});

test('Zero sit-outs 16p 4c — all play every round', () => {
  setScheduleRng(mulberry32(5));
  const result = generateSchedule(16, 4, 5, makeGenders(8, 8), true);
  for (const round of result.schedule) {
    assert(round.sitOuts.length === 0, `Round ${round.round} has ${round.sitOuts.length} sit-outs (expected 0)`);
  }
  assert(result.sitOutCount.every(c => c === 0), 'sitOutCount should be all zeros');
  resetScheduleRng();
});

test('Odd-parity gender pool 7M/9F 4c 10r — no duplicates', () => {
  setScheduleRng(mulberry32(3));
  const genders = makeGenders(7, 9);
  const result = generateSchedule(16, 4, 10, genders, true);
  checkNoDuplicates(result, 16);
  checkAllCourtsHaveFourPlayers(result);
  const { mmVsFf } = countGenderViolations(result, genders);
  assert(mmVsFf === 0, `Should not produce MM-vs-FF (got ${mmVsFf})`);
  resetScheduleRng();
});

test('Back-to-back byes avoided in long schedule (20p 4c 10r, 4 byes/round)', () => {
  setScheduleRng(mulberry32(11));
  const result = generateSchedule(20, 4, 10, makeGenders(10, 10), true);
  let backToBack = 0;
  for (let i = 0; i < 20; i++) {
    for (let r = 1; r < result.schedule.length; r++) {
      if (result.schedule[r].sitOuts.includes(i) && result.schedule[r-1].sitOuts.includes(i)) backToBack++;
    }
  }
  assert(backToBack === 0, `No back-to-back byes (got ${backToBack})`);
  resetScheduleRng();
});

test('Nobody gets a 2nd bye until everyone has had a 1st (16p 8M/8F 3c 10r)', () => {
  // 4 byes/round over 16 players, so rounds 1-4 should hand out all 16 first
  // byes before any repeat. Guards the reported concern directly.
  for (const seed of [7, 42, 99, 2024, 31337]) {
    setScheduleRng(mulberry32(seed));
    const result = generateSchedule(16, 3, 10, makeGenders(8, 8), true);
    const { allAtK, firstAtKPlus1 } = byeMilestones(result, 16, 1);
    assert(allAtK === 4, `seed ${seed}: all 16 should have a bye by round 4 (got ${allAtK})`);
    assert(firstAtKPlus1 >= allAtK,
      `seed ${seed}: a 2nd bye appeared in round ${firstAtKPlus1}, before everyone had one (round ${allAtK})`);
    assert(worstRunningByeSpread(result, 16) <= 1,
      `seed ${seed}: running bye spread should stay <= 1 (got ${worstRunningByeSpread(result, 16)})`);
  }
  resetScheduleRng();
});

test('Running bye spread stays <= 1 across many shapes and gender splits', () => {
  // The final byeSpread check elsewhere cannot catch a schedule that benches
  // someone twice before another player has sat at all — this walks the running
  // totals round by round. Skewed splits are included because gender parity is
  // the constraint most likely to fight bye fairness.
  const configs = [
    { p: 16, c: 3, r: 10, m: 8,  f: 8  },
    { p: 16, c: 3, r: 30, m: 8,  f: 8  },
    { p: 16, c: 2, r: 12, m: 8,  f: 8  },
    { p: 20, c: 4, r: 10, m: 10, f: 10 },
    { p: 20, c: 3, r: 15, m: 15, f: 5  },
    { p: 17, c: 4, r: 12, m: 1,  f: 16 },  // lone male: mixed-parity vs fairness
    { p: 18, c: 4, r: 20, m: 9,  f: 9  },
    { p: 24, c: 5, r: 10, m: 12, f: 12 },
    { p: 13, c: 3, r: 11, m: 6,  f: 7  },
    { p: 9,  c: 2, r: 9,  m: 4,  f: 5  },
  ];
  for (const cfg of configs) {
    for (const mixed of [true, false]) {
      for (const seed of [3, 77, 4242]) {
        setScheduleRng(mulberry32(seed));
        const result = generateSchedule(cfg.p, cfg.c, cfg.r, makeGenders(cfg.m, cfg.f), mixed);
        const worst = worstRunningByeSpread(result, cfg.p);
        assert(worst <= 1,
          `${cfg.p}p ${cfg.c}c ${cfg.r}r ${cfg.m}M/${cfg.f}F mixed=${mixed} seed ${seed}: ` +
          `running bye spread ${worst} > 1`);
      }
    }
  }
  resetScheduleRng();
});

test('Determinism: same seed produces same schedule', () => {
  const g = makeGenders(8, 8);
  setScheduleRng(mulberry32(1234));
  const r1 = generateSchedule(16, 4, 5, g, true);
  setScheduleRng(mulberry32(1234));
  const r2 = generateSchedule(16, 4, 5, g, true);
  const s1 = JSON.stringify(r1.schedule);
  const s2 = JSON.stringify(r2.schedule);
  assert(s1 === s2, 'Same seed should produce identical schedules');
  resetScheduleRng();
});

test('Score: compareScores is transitive', () => {
  const a = { genderBadCourts: 0, maxPartner: 1, byeSpread: 0, maxMidByeSpread: 1, maxCoBye: 2, maxCourt: 3, maxOpp: 2, partnerToOpp: 0, neverMet: 10, totalCourtExcess: 0, totalOppExcess: 0, totalPartnerExcess: 0 };
  const b = { ...a, maxPartner: 2 };  // worse
  const c = { ...a, maxPartner: 0 };  // better
  assert(compareScores(c, a) < 0, 'c < a');
  assert(compareScores(a, b) < 0, 'a < b');
  assert(compareScores(c, b) < 0, 'c < b (transitive)');
});

test('adaptiveTimeBudgetMs is bounded', () => {
  const small = adaptiveTimeBudgetMs(8, 2, 5);
  const large = adaptiveTimeBudgetMs(40, 10, 30);
  assert(small >= 2000, `Small budget ≥ 2000 (got ${small})`);
  assert(large <= 15000, `Large budget ≤ 15000 (got ${large})`);
});

test('repairSchedule2opt does not introduce bad invariants', () => {
  setScheduleRng(mulberry32(7777));
  const genders = makeGenders(10, 10);
  const initial = generateSchedule(20, 4, 10, genders, true);
  const repaired = repairSchedule2opt(initial, 20, genders, { deadlineMs: 300 });
  checkNoDuplicates(repaired, 20);
  checkAllCourtsHaveFourPlayers(repaired);
  const { mmVsFf, threeOneSplit } = countGenderViolations(repaired, genders);
  assert(mmVsFf === 0, 'Repair preserves gender validity (no MM-vs-FF)');
  assert(threeOneSplit === 0, 'Repair preserves gender validity (no 3/1)');
  const initialScore = scoreSchedule(initial, 20, genders);
  const repairedScore = scoreSchedule(repaired, 20, genders);
  assert(compareScores(repairedScore, initialScore) <= 0, 'Repair never makes score strictly worse');
  resetScheduleRng();
});

test('Uneven gender pools — no MM-vs-FF and no 3M/1F courts', () => {
  // Regression: with a lopsided pool (e.g. 6M/4F on 2 courts) the partner-repeat
  // release heuristic could leave an odd number of same-gender teams (e.g. 3 MM +
  // 1 FF), forcing a banned MM-vs-FF court. All-MM / all-FF courts are allowed;
  // MM-vs-FF and 3/1 are not.
  const cases = [
    { p: 10, c: 2, r: 10, m: 6, f: 4 },
    { p: 16, c: 4, r: 10, m: 10, f: 6 },
    { p: 12, c: 2, r: 10, m: 8, f: 4 },
  ];
  for (const cfg of cases) {
    const genders = makeGenders(cfg.m, cfg.f);
    for (const seed of [1, 7, 42, 100, 2024]) {
      setScheduleRng(mulberry32(seed));
      const result = generateSchedule(cfg.p, cfg.c, cfg.r, genders, true);
      checkNoDuplicates(result, cfg.p);
      const { mmVsFf, threeOneSplit } = countGenderViolations(result, genders);
      assert(mmVsFf === 0, `${cfg.m}M/${cfg.f}F ${cfg.c}c seed ${seed}: MM-vs-FF should be 0 (got ${mmVsFf})`);
      assert(threeOneSplit === 0, `${cfg.m}M/${cfg.f}F ${cfg.c}c seed ${seed}: 3/1 should be 0 (got ${threeOneSplit})`);
    }
  }
  resetScheduleRng();
});

test('Prefer-mixed uneven pools — no fully-segregated rounds', () => {
  // With preferMixed on, mixed courts take priority: a round must never pair an
  // all-men court with an all-women court (that means mixing was possible and
  // skipped). Lone all-men OR all-women courts are fine (a gender in excess).
  const cases = [
    { p: 10, c: 2, r: 10, m: 6, f: 4 },
    { p: 12, c: 2, r: 10, m: 8, f: 4 },
    { p: 16, c: 4, r: 10, m: 10, f: 6 },
    { p: 16, c: 4, r: 10, m: 6, f: 10 },
  ];
  for (const cfg of cases) {
    const genders = makeGenders(cfg.m, cfg.f);
    for (const seed of [1, 7, 42, 100]) {
      setScheduleRng(mulberry32(seed));
      const result = generateSchedule(cfg.p, cfg.c, cfg.r, genders, true);
      let segRounds = 0;
      for (const round of result.schedule) {
        let hasAllM = false, hasAllF = false;
        for (const court of round.courts) {
          const mc = [...court.teamA, ...court.teamB].filter(p => genders[p] === 'M').length;
          if (mc === 4) hasAllM = true;
          else if (mc === 0) hasAllF = true;
        }
        if (hasAllM && hasAllF) segRounds++;
      }
      assert(segRounds === 0, `${cfg.m}M/${cfg.f}F ${cfg.c}c seed ${seed}: fully-segregated rounds should be 0 (got ${segRounds})`);
    }
  }
  resetScheduleRng();
});

test('No back-to-back partnerships (same pair never partners in consecutive rounds)', () => {
  // Hard rule: a pair may partner more than once (mixing is prioritized over
  // zero-repeats on lopsided pools) but NEVER in two consecutive rounds.
  const partnerKeys = round => {
    const s = new Set();
    for (const c of round.courts) {
      s.add(Math.min(c.teamA[0], c.teamA[1]) + ',' + Math.max(c.teamA[0], c.teamA[1]));
      s.add(Math.min(c.teamB[0], c.teamB[1]) + ',' + Math.max(c.teamB[0], c.teamB[1]));
    }
    return s;
  };
  const cases = [
    { p: 10, c: 2, r: 10, m: 6, f: 4 },
    { p: 12, c: 2, r: 10, m: 8, f: 4 },
    { p: 16, c: 4, r: 10, m: 8, f: 8 },
  ];
  for (const cfg of cases) {
    const genders = makeGenders(cfg.m, cfg.f);
    for (const seed of [1, 7, 42, 100, 2024]) {
      setScheduleRng(mulberry32(seed));
      const result = generateSchedule(cfg.p, cfg.c, cfg.r, genders, true);
      let consec = 0;
      for (let ri = 1; ri < result.schedule.length; ri++) {
        const prev = partnerKeys(result.schedule[ri - 1]);
        for (const k of partnerKeys(result.schedule[ri])) if (prev.has(k)) consec++;
      }
      assert(consec === 0, `${cfg.m}M/${cfg.f}F seed ${seed}: back-to-back partnerships should be 0 (got ${consec})`);
    }
  }
  resetScheduleRng();
});

test('Bye partners are varied — no pair sits out together more than once (small-bye pools)', () => {
  // The same two people should not be paired on byes every time. Where the bye
  // pool is small enough for it to be possible, no pair co-sits more than once,
  // while byes stay fair (spread <= 1) and there are no back-to-back byes.
  const maxCoBye = (result, n) => {
    const m = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const round of result.schedule) {
      const o = round.sitOuts;
      for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) { m[o[i]][o[j]]++; m[o[j]][o[i]]++; }
    }
    let mx = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (m[i][j] > mx) mx = m[i][j];
    return mx;
  };
  const backToBackByes = result => {
    let n = 0;
    for (let r = 1; r < result.schedule.length; r++) {
      const prev = new Set(result.schedule[r - 1].sitOuts);
      for (const p of result.schedule[r].sitOuts) if (prev.has(p)) n++;
    }
    return n;
  };
  // Uses the app path (generateBestSchedule) since the multi-start selects the
  // most bye-diverse of many candidate constructions. Asserted on the small
  // lopsided pool that used to produce the degenerate periodic pattern.
  const cfg = { p: 10, c: 2, r: 10, m: 6, f: 4 };
  const genders = makeGenders(cfg.m, cfg.f);
  for (const seed of [1, 7, 42, 100, 2024]) {
    setScheduleRng(mulberry32(seed));
    const result = generateBestSchedule(cfg.p, cfg.c, cfg.r, genders, true, { timeBudgetMs: 800 });
    assert(maxCoBye(result, cfg.p) <= 1, `${cfg.m}M/${cfg.f}F seed ${seed}: no pair should sit out together >1 time (got ${maxCoBye(result, cfg.p)})`);
    assert(byeSpread(result) <= 1, `${cfg.m}M/${cfg.f}F seed ${seed}: byeSpread should stay <= 1 (got ${byeSpread(result)})`);
    assert(backToBackByes(result) === 0, `${cfg.m}M/${cfg.f}F seed ${seed}: no back-to-back byes (got ${backToBackByes(result)})`);
  }
  resetScheduleRng();
});

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

test('Late arrivals: voluntaryByeCount and joinRounds survive generateBestSchedule with repair enabled', () => {
  // generateBestSchedule runs generateSchedule in a loop and then, unless
  // options.skipRepair is set, hands the winner to repairSchedule2opt — the
  // production default and what the UI actually calls. Both the multi-start
  // loop and the repair path have to forward/rebuild joinRounds and
  // voluntaryByeCount correctly, or a late arrival silently stops mattering
  // the moment repair (or scoring built on top of it) touches the result.
  setScheduleRng(mulberry32(505));
  const joinRounds = new Array(16).fill(1);
  joinRounds[0] = 3;   // misses rounds 1-2
  const result = generateBestSchedule(16, 3, 10, makeGenders(8, 8), true,
    { joinRounds, timeBudgetMs: 200, repairMs: 100 }); // skipRepair left unset: repair runs
  assert(result.voluntaryByeCount !== undefined, 'voluntaryByeCount must survive repair');
  assert(result.joinRounds !== undefined, 'joinRounds must survive repair');
  assert(JSON.stringify(result.joinRounds) === JSON.stringify(joinRounds),
    `joinRounds must reflect the caller-supplied array, not the nobody-late default ` +
    `(got ${JSON.stringify(result.joinRounds)})`);
  assert(result.sitOutCount[0] - result.voluntaryByeCount[0] === 2,
    `player 0's 2 forced byes (rounds 1-2) must be excluded from voluntaryByeCount ` +
    `(sitOutCount ${result.sitOutCount[0]}, voluntaryByeCount ${result.voluntaryByeCount[0]})`);
  const p0 = roundsPlayerAppears(result, 0);
  assert(!p0.includes(1) && !p0.includes(2), `player 0 must not play rounds 1-2 (played ${p0})`);
  resetScheduleRng();
});

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
  assert(score.byeSpread < totalSpread,
    `byeSpread must be strictly lower than the totals-based spread, proving it is ` +
    `measured on voluntary byes rather than totals (byeSpread ${score.byeSpread}, totalSpread ${totalSpread})`);
  // maxMidByeSpread is deliberately NOT asserted <= 1 here. Player 0's
  // voluntary-bye counter starts at 0 on their arrival round while everyone
  // else's has already accumulated several rounds' worth, so a transient
  // spread above 1 while they catch up is expected and correct — it is not
  // a bug. Forcing it to <= 1 would require benching the person who just
  // arrived, which is exactly the perverse behaviour this feature exists to
  // avoid. Do not "fix" this by making late arrivals sit out more.
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
  assert(sa.maxMidByeSpread <= 1,
    `with nobody late, maxMidByeSpread must still hold to <= 1 (got ${sa.maxMidByeSpread})`);
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

test('Late arrivals: maxMidByeSpread does not collapse to 0 on a single-round schedule', () => {
  // Nobody is late in this test, but it lives here because it guards the
  // arrival-round narrowing above. joinRounds defaults to all-1s, so on a
  // one-round schedule every player's "arrival round" equals the only round
  // being scored. A comparison that excluded every arriving player from that
  // round would exclude everyone at once, leave lo === Infinity, and
  // silently report a spread of 0 no matter how uneven the sit-outs actually
  // are. Nobody here has arrived late, so nobody should ever be excluded,
  // and maxMidByeSpread must agree with the plain byeSpread computed from
  // the final counts.
  setScheduleRng(mulberry32(808));
  const g = makeGenders(6, 7);
  const result = generateSchedule(13, 3, 1, g, true);
  const score = scoreSchedule(result, 13, g);
  assert(score.maxMidByeSpread === score.byeSpread,
    `single-round maxMidByeSpread (${score.maxMidByeSpread}) must equal byeSpread (${score.byeSpread})`);
  resetScheduleRng();
});

// --- Run --------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
