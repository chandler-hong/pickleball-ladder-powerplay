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

// --- Run --------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
