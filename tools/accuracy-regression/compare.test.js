// node --test tools/accuracy-regression/*.test.js
const assert = require('node:assert/strict');
const test = require('node:test');

const { compare, summaryMd } = require('./compare');

const SPECS = [
  { key: 'found', name: 'found', better: 'higher', tol: 0 },
  { key: 'jhMaxAbs', name: 'JH max |error| (cm)', better: 'lower', tol: 0.05 },
];

test('equal to the baseline passes', () => {
  const r = compare(SPECS, { found: 8, jhMaxAbs: 1.2 }, { found: 8, jhMaxAbs: 1.2 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.rows.map((x) => x.status),
    ['same', 'same'],
  );
});

test('worse by more than the tolerance fails, in either direction of "better"', () => {
  const r = compare(SPECS, { found: 8, jhMaxAbs: 1.2 }, { found: 7, jhMaxAbs: 1.26 });
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.rows.map((x) => x.status),
    ['worse', 'worse'],
  );
});

test('worse within the tolerance passes (a different ffmpeg or Chromium build may move a value a hair)', () => {
  const r = compare(SPECS, { found: 8, jhMaxAbs: 1.2 }, { found: 8, jhMaxAbs: 1.24 });
  assert.equal(r.ok, true);
  assert.equal(r.rows[1].status, 'same');
});

test('better passes and says so, so the baseline can be raised', () => {
  const r = compare(SPECS, { found: 7, jhMaxAbs: 1.2 }, { found: 8, jhMaxAbs: 0.9 });
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.rows.map((x) => x.status),
    ['better', 'better'],
  );
});

test('a figure the baseline has but the run lost fails; one the baseline lacks is only new', () => {
  const lost = compare(SPECS, { found: 8, jhMaxAbs: 1.2 }, { found: 8, jhMaxAbs: null });
  assert.equal(lost.ok, false);
  assert.equal(lost.rows[1].status, 'missing');
  const fresh = compare(SPECS, { found: 8 }, { found: 8, jhMaxAbs: 1.2 });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.rows[1].status, 'new');
});

test('the summary names the worse figures', () => {
  const md = summaryMd('detect', compare(SPECS, { found: 8, jhMaxAbs: 1.2 }, { found: 7, jhMaxAbs: 1.2 }));
  assert.match(md, /found/);
  assert.match(md, /❌/);
});
