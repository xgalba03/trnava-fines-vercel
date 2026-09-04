const assert = require('node:assert/strict');
const test = require('node:test');
const { birthdayOccurrences, chooseLargestGapEvent } = require('../api/_lib/birthday-scheduler');

test('birthday occurrences reject impossible leap-day years and include valid ones', () => {
  const dates = birthdayOccurrences(2, 29, 2025, 2025).map((date) => date.toISOString().slice(0, 10));
  assert.deepEqual(dates, ['2024-02-29']);
});

test('outside-season birthdays choose an unused event in the largest open gap', () => {
  const events = [
    { id: 1, starts_at: '2026-09-10T18:00:00Z' },
    { id: 2, starts_at: '2026-10-10T18:00:00Z' },
    { id: 3, starts_at: '2026-11-10T18:00:00Z' }
  ];
  const picked = chooseLargestGapEvent(
    events,
    [new Date(events[1].starts_at).getTime()],
    new Date('2026-09-01T12:00:00Z'),
    new Date('2026-11-30T12:00:00Z')
  );
  assert.equal(picked.id, 3);
});
