const assert = require('node:assert/strict');
const test = require('node:test');
const { dateRangeAfter, localDateString } = require('../api/_lib/dates');

test('daily penalty dates begin on the day after the due date', () => {
  assert.deepEqual(dateRangeAfter('2026-09-01', '2026-09-04'), [
    '2026-09-02', '2026-09-03', '2026-09-04'
  ]);
  assert.deepEqual(dateRangeAfter('2026-09-04', '2026-09-04'), []);
});

test('Bratislava local date is used around UTC midnight', () => {
  assert.equal(localDateString(new Date('2026-09-03T22:30:00Z')), '2026-09-04');
});
