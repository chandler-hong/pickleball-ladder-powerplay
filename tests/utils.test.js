// Unit tests for js/utils.js pure helpers.
// Run: node tests/utils.test.js

const { csvCell, guessGender, shuffle, pickRandomNames, pickleballResult, pickleballScoreError } = require('../js/utils.js');

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

test('csvCell escapes formulas, quotes, and delimiters', () => {
  assert(csvCell('Alice') === 'Alice', 'plain value unchanged');
  assert(csvCell('=SUM(A1)') === "'=SUM(A1)", 'leading = neutralized');
  assert(csvCell('+1') === "'+1", 'leading + neutralized');
  assert(csvCell('-1') === "'-1", 'leading - neutralized');
  assert(csvCell('@x') === "'@x", 'leading @ neutralized');
  assert(csvCell('Smith, John') === '"Smith, John"', 'comma triggers quoting');
  assert(csvCell('Bob "Cannon"') === '"Bob ""Cannon"""', 'embedded quotes doubled');
  assert(csvCell('a\nb') === '"a\nb"', 'newline triggers quoting');
  assert(csvCell(11) === '11', 'numbers stringified');
  assert(csvCell(null) === '', 'null -> empty string');
  assert(csvCell(undefined) === '', 'undefined -> empty string');
  assert(csvCell('=1,2') === '"\'=1,2"', 'formula + comma: prefixed then quoted');
});

test('guessGender detects clear names, defers on unisex/unknown', () => {
  assert(guessGender('Emily') === 'F', 'Emily -> F');
  assert(guessGender('Michael') === 'M', 'Michael -> M');
  assert(guessGender('  emily  ') === 'F', 'trims + lowercases');
  assert(guessGender('Emily Watson') === 'F', 'uses first token only');
  assert(guessGender('Jordan') === null, 'unisex Jordan -> null (in both sets)');
  assert(guessGender('Morgan') === null, 'unisex Morgan -> null');
  assert(guessGender('Xzptlk') === null, 'unknown -> null');
  assert(guessGender('') === null, 'empty -> null');
});

test('shuffle preserves the multiset and does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = shuffle(input);
  assert(out.length === input.length, 'length preserved');
  assert(input.join(',') === '1,2,3,4,5,6,7,8,9,10', 'input array not mutated');
  assert(out.slice().sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8,9,10', 'same elements returned');
});

test('pickRandomNames: count, uniqueness, valid genders, min 2 of each', () => {
  for (const count of [4, 12, 20, 40]) {
    const picks = pickRandomNames(count);
    assert(picks.length === count, `count ${count}: length matches`);
    assert(picks.every(p => p.gender === 'M' || p.gender === 'F'), `count ${count}: valid genders`);
    const names = picks.map(p => p.name);
    assert(new Set(names).size === names.length, `count ${count}: names unique`);
    assert(picks.every(p => typeof p.name === 'string' && p.name.length > 0 && p.name[0] === p.name[0].toUpperCase()), `count ${count}: names capitalized`);
    const f = picks.filter(p => p.gender === 'F').length;
    assert(f >= 2 && f <= count - 2, `count ${count}: at least 2 of each gender (got ${f}F)`);
  }
});

test('pickleballResult — win by 1 (first to 11)', () => {
  assert(pickleballResult(11, 0, 1) === 'A', '11-0 -> A');
  assert(pickleballResult(11, 9, 1) === 'A', '11-9 -> A');
  assert(pickleballResult(11, 10, 1) === 'A', '11-10 -> A (win by 1 allowed)');
  assert(pickleballResult(9, 11, 1) === 'B', '9-11 -> B');
  assert(pickleballResult(10, 8, 1) === null, '10-8 unfinished -> null');
  assert(pickleballResult(12, 10, 1) === null, '12-10 invalid past 11 -> null');
  assert(pickleballResult(11, 11, 1) === null, 'tie -> null');
  assert(pickleballResult(NaN, 5, 1) === null, 'NaN -> null');
});

test('pickleballResult — win by 2 (to 11, no cap)', () => {
  assert(pickleballResult(11, 9, 2) === 'A', '11-9 -> A');
  assert(pickleballResult(11, 0, 2) === 'A', '11-0 -> A');
  assert(pickleballResult(11, 10, 2) === null, '11-10 in progress -> null');
  assert(pickleballResult(12, 10, 2) === 'A', '12-10 -> A');
  assert(pickleballResult(13, 11, 2) === 'A', '13-11 -> A');
  assert(pickleballResult(15, 13, 2) === 'A', '15-13 -> A');
  assert(pickleballResult(12, 11, 2) === null, '12-11 in progress -> null');
  assert(pickleballResult(13, 9, 2) === null, '13-9 impossible -> null');
  assert(pickleballResult(10, 8, 2) === null, '10-8 unfinished -> null');
});

test('pickleballScoreError — flags impossible, allows unfinished', () => {
  assert(pickleballScoreError(11, 5, 1) === null, 'wb1 11-5 valid, no error');
  assert(pickleballScoreError(7, 4, 1) === null, 'wb1 7-4 unfinished, no error');
  assert(pickleballScoreError(12, 5, 1) !== null, 'wb1 12-5 error (past 11)');
  assert(pickleballScoreError(5, 5, 1) !== null, 'tie error');
  assert(pickleballScoreError(-1, 5, 1) !== null, 'negative error');
  assert(pickleballScoreError(11, 10, 2) === null, 'wb2 11-10 in progress, no error');
  assert(pickleballScoreError(12, 11, 2) === null, 'wb2 12-11 in progress, no error');
  assert(pickleballScoreError(15, 13, 2) === null, 'wb2 15-13 valid, no error');
  assert(pickleballScoreError(13, 9, 2) !== null, 'wb2 13-9 error (>2 lead past 11)');
  assert(pickleballScoreError(20, 5, 2) !== null, 'wb2 20-5 error');
  assert(pickleballScoreError(NaN, NaN, 2) === null, 'blank -> no error');
});

console.log('\n' + '='.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
