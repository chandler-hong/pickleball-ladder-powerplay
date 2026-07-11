// Unit tests for js/utils.js pure helpers.
// Run: node tests/utils.test.js

const { csvCell, guessGender, shuffle, pickRandomNames } = require('../js/utils.js');

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

console.log('\n' + '='.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
