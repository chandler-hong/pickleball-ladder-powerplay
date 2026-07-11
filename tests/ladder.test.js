// Unit tests for js/ladder.js pure logic.
// Run: node tests/ladder.test.js
//
// randomGenderBalancedAssignment / ladderProcessMovement reference the global
// shuffle() (provided by js/utils.js in the browser). Wire it up before require.

global.shuffle = require('../js/utils.js').shuffle;

const {
  isValidPickleballResult,
  scoreError,
  formatTimerMMSS,
  bestPairing,
  randomGenderBalancedAssignment,
  ladderProcessMovement,
  computeLadderStats,
  ladderConfig,
} = require('../js/ladder.js');

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

function zeros(n) {
  return Array.from({ length: n }, () => new Array(n).fill(0));
}

test('isValidPickleballResult: play to 11, loser 0-10', () => {
  assert(isValidPickleballResult(11, 0) === 'A', '11-0 -> A');
  assert(isValidPickleballResult(11, 9) === 'A', '11-9 -> A');
  assert(isValidPickleballResult(5, 11) === 'B', '5-11 -> B');
  assert(isValidPickleballResult(11, 11) === null, '11-11 -> null');
  assert(isValidPickleballResult(10, 9) === null, 'no 11 -> null (in progress)');
  assert(isValidPickleballResult(12, 10) === null, '12-10 -> null (over 11)');
  assert(isValidPickleballResult(NaN, 5) === null, 'NaN -> null');
});

test('scoreError: message for invalid, null for valid/in-progress', () => {
  assert(scoreError(NaN, 5) === null, 'incomplete -> null');
  assert(scoreError(-1, 5) === 'Scores cannot be negative', 'negative');
  assert(scoreError(5, 5) === 'Scores cannot be tied', 'tie');
  assert(scoreError(12, 3) === 'Max score is 11', 'over 11');
  assert(scoreError(11, 9) === null, 'valid win -> null');
  assert(scoreError(7, 4) === null, 'in progress -> null');
});

test('formatTimerMMSS: rounds up, pads, floors at zero', () => {
  assert(formatTimerMMSS(600) === '10:00', '600 -> 10:00');
  assert(formatTimerMMSS(599.4) === '10:00', 'rounds up to 10:00');
  assert(formatTimerMMSS(65) === '1:05', 'pads seconds');
  assert(formatTimerMMSS(9) === '0:09', '9 -> 0:09');
  assert(formatTimerMMSS(-5) === '0:00', 'negative clamps to 0:00');
});

test('bestPairing: minimizes repeats, then prefers mixed', () => {
  const genders = ['M', 'F', 'M', 'F']; // players 0,1,2,3
  const mixed = t => genders[t[0]] !== genders[t[1]];

  const p = bestPairing([0, 1, 2, 3], genders, true, zeros(4));
  assert(mixed(p.teamA) && mixed(p.teamB), 'both teams mixed when no history + preferMixed');

  const hist = zeros(4);
  hist[0][1] = 5; hist[1][0] = 5; // 0 & 1 have partnered a lot
  const p2 = bestPairing([0, 1, 2, 3], genders, false, hist);
  const together = (t, a, b) => (t[0] === a && t[1] === b) || (t[0] === b && t[1] === a);
  const has01 = together(p2.teamA, 0, 1) || together(p2.teamB, 0, 1);
  assert(!has01, 'avoids the heavily-repeated 0 & 1 partnership');
});

test('randomGenderBalancedAssignment: 4/court, all slots once, 2M/2F', () => {
  const numCourts = 3;
  const genders = [];
  for (let i = 0; i < numCourts * 4; i++) genders.push(i % 2 === 0 ? 'M' : 'F'); // 6M 6F
  const courts = randomGenderBalancedAssignment(genders, numCourts);
  assert(courts.length === numCourts, 'produces numCourts courts');
  assert(courts.every(c => c.length === 4), 'each court has 4 players');
  const flat = courts.flat().sort((a, b) => a - b);
  assert(flat.length === numCourts * 4 && flat.every((v, i) => v === i), 'each slot used exactly once');
  assert(courts.every(c => c.filter(i => genders[i] === 'M').length === 2), 'each court is 2M/2F');
});

test('ladderProcessMovement: winners up, losers down, ends stay, conservation', () => {
  ladderConfig.numCourts = 3;
  ladderConfig.courtNumbers = [10, 20, 30]; // index 0 bottom -> index 2 top
  const genders = ['M', 'F', 'M', 'F', 'M', 'F', 'M', 'F', 'M', 'F', 'M', 'F'];
  const partnerHistory = zeros(12);
  const courtTeams = {
    10: { teamA: [0, 1], teamB: [2, 3] },
    20: { teamA: [4, 5], teamB: [6, 7] },
    30: { teamA: [8, 9], teamB: [10, 11] },
  };
  const scores = {
    10: { scoreA: 11, scoreB: 5 },
    20: { scoreA: 11, scoreB: 5 },
    30: { scoreA: 11, scoreB: 5 }, // teamA wins everywhere
  };
  const { newCourtPlayers, movements } =
    ladderProcessMovement(scores, courtTeams, genders, true, partnerHistory);

  const all = [10, 20, 30].reduce((acc, c) => acc.concat(newCourtPlayers[c]), []);
  assert([10, 20, 30].every(c => newCourtPlayers[c].length === 4), 'each court still has 4');
  assert(new Set(all).size === 12 && all.length === 12, 'all 12 players conserved, no dupes');

  assert(movements[0].dir === 'up' && movements[0].to === 20, 'bottom winner 0 moves up to 20');
  assert(movements[2].dir === 'stay' && movements[2].to === 10, 'bottom loser 2 stays at 10');
  assert(movements[4].dir === 'up' && movements[4].to === 30, 'mid winner 4 moves up to 30');
  assert(movements[6].dir === 'down' && movements[6].to === 10, 'mid loser 6 moves down to 10');
  assert(movements[8].dir === 'stay' && movements[8].to === 30, 'top winner 8 stays at 30');
  assert(movements[10].dir === 'down' && movements[10].to === 20, 'top loser 10 moves down to 20');
});

test('computeLadderStats: Highest Court uses ladder POSITION, not court number', () => {
  // Non-monotonic numbering: bottom->top = [5, 1, 9].
  // A player who visits the BOTTOM (court 5) and the MIDDLE (court 1) has a
  // best rank of the MIDDLE (court number 1). The old number-max logic would
  // wrongly report 5 (bottom) as their "highest".
  const ladderCourts = [5, 1, 9];
  const names = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];
  const rounds = [
    {
      round: 1, names,
      courts: {
        5: { teamA: [0, 1], teamB: [2, 3], scoreA: 11, scoreB: 0, winner: 'A' }, // 2,3 pickled
        1: { teamA: [4, 5], teamB: [6, 7], scoreA: 11, scoreB: 5, winner: 'A' },
        9: { teamA: [8, 9], teamB: [10, 11], scoreA: 11, scoreB: 7, winner: 'A' },
      },
    },
    {
      round: 2, names,
      courts: {
        5: { teamA: [2, 3], teamB: [6, 7], scoreA: 11, scoreB: 9, winner: 'A' },
        1: { teamA: [0, 1], teamB: [10, 11], scoreA: 11, scoreB: 4, winner: 'A' }, // 0,1 at MIDDLE
        9: { teamA: [8, 9], teamB: [4, 5], scoreA: 11, scoreB: 8, winner: 'A' },
      },
    },
  ];
  const players = computeLadderStats(rounds, names, ladderCourts, null);
  const byName = Object.fromEntries(players.map(p => [p.name, p]));

  assert(byName['P0'].highestCourt === 1, 'P0 (bottom then middle) highest = court 1 (position), not 5');
  assert(byName['P2'].highestCourt === 5, 'P2 stayed at bottom -> highest = court 5');
  assert(byName['P4'].highestCourt === 9, 'P4 reached top -> highest = court 9');
  assert(byName['P8'].highestCourt === 9, 'P8 stayed at top -> highest = court 9');

  assert(byName['P2'].pickles === 1 && byName['P3'].pickles === 1, 'pickled players (lost 11-0) counted');
  assert(byName['P10'].pickles === 0, 'non-zero loss is not a pickle');

  assert(byName['P0'].wins === 2 && byName['P0'].losses === 0, 'P0 record 2-0');
  assert(byName['P0'].streak === 'W2', 'P0 streak W2');
});

console.log('\n' + '='.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
