// End-to-end stress test (formerly stress-test.js).
// Validates production-realistic scenarios with a reduced time budget so
// this can run as part of `npm test` or CI without taking >10 min.
// Run: node tests/stress.test.js

const {
  generateBestSchedule,
  scoreSchedule,
} = require('../js/schedule.js');

const TIME_BUDGET_MS = 3000;

const SCENARIOS = [
  { name: '16p 7M/9F 4c 10r', players: 16, males: 7, courts: 4, rounds: 10, mixed: true },
  { name: '18p 7M/11F 4c 9r', players: 18, males: 7, courts: 4, rounds: 9, mixed: true },
  { name: '20p 10M/10F 4c 10r', players: 20, males: 10, courts: 4, rounds: 10, mixed: true },
  { name: '16p 8M/8F 4c 10r (no byes)', players: 16, males: 8, courts: 4, rounds: 10, mixed: true },
  { name: '24p 12M/12F 4c 10r (8 byes/round)', players: 24, males: 12, courts: 4, rounds: 10, mixed: true },
  { name: '32p 16M/16F 7c 10r', players: 32, males: 16, courts: 7, rounds: 10, mixed: true },
  { name: '18p 0M/18F 4c 9r (all female)', players: 18, males: 0, courts: 4, rounds: 9, mixed: false },
];

function makeGenders(males, total) {
  return 'M'.repeat(males).split('').concat('F'.repeat(total - males).split(''));
}

function analyze(result, n, genders) {
  let maxPartner = 0, maxOpp = 0, maxCourt = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (result.partnerCount[i][j] > maxPartner) maxPartner = result.partnerCount[i][j];
      if (result.opponentCount[i][j] > maxOpp) maxOpp = result.opponentCount[i][j];
      if (result.courtCount[i][j] > maxCourt) maxCourt = result.courtCount[i][j];
    }
  }
  const maxBye = Math.max(0, ...result.sitOutCount);
  const minBye = Math.min(...result.sitOutCount);
  const byeSpread = maxBye - minBye;
  let mmVsFf = 0, threeOne = 0, dups = 0;
  for (const round of result.schedule) {
    const seen = new Set();
    for (const court of round.courts) {
      const all = [...court.teamA, ...court.teamB];
      for (const p of all) { if (seen.has(p)) dups++; seen.add(p); }
      const mc = all.filter(p => genders[p] === 'M').length;
      if (mc === 1 || mc === 3) threeOne++;
      else if (mc === 2 && genders[court.teamA[0]] === genders[court.teamA[1]]) mmVsFf++;
    }
    for (const p of round.sitOuts) { if (seen.has(p)) dups++; }
  }
  return { maxPartner, maxOpp, maxCourt, byeSpread, mmVsFf, threeOne, dups };
}

console.log('='.repeat(70));
console.log(`  Stress test — ${TIME_BUDGET_MS}ms budget per scenario`);
console.log('='.repeat(70));

let totalFails = 0;
for (const s of SCENARIOS) {
  const genders = makeGenders(s.males, s.players);
  const result = generateBestSchedule(s.players, s.courts, s.rounds, genders, s.mixed, { timeBudgetMs: TIME_BUDGET_MS });
  const a = analyze(result, s.players, genders);

  const fails = [];
  if (a.dups > 0) fails.push(`DUPS=${a.dups}`);
  // In balanced gender scenarios, expect no MM-vs-FF.
  const minorityGender = Math.min(s.males, s.players - s.males);
  if (minorityGender >= 4 && a.mmVsFf > 0) fails.push(`MM-vs-FF=${a.mmVsFf}`);
  // Back-to-back byes check
  let btb = 0;
  for (let i = 0; i < s.players; i++) {
    for (let r = 1; r < result.schedule.length; r++) {
      if (result.schedule[r].sitOuts.includes(i) && result.schedule[r-1].sitOuts.includes(i)) btb++;
    }
  }
  if (btb > 0) fails.push(`back-to-back=${btb}`);

  const status = fails.length === 0 ? '✓' : '✗';
  console.log(`${status} ${s.name.padEnd(40)} partner=${a.maxPartner} opp=${a.maxOpp} court=${a.maxCourt} byeSpread=${a.byeSpread} gender(mm-vs-ff=${a.mmVsFf}, 3/1=${a.threeOne}) ${fails.join(', ')}`);
  totalFails += fails.length;
}

console.log('='.repeat(70));
if (totalFails === 0) {
  console.log('  ALL SCENARIOS PASSED ✓');
  process.exit(0);
} else {
  console.log(`  ${totalFails} failures`);
  process.exit(1);
}
