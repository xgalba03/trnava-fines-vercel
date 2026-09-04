const assert = require('node:assert/strict');
const test = require('node:test');
const { expandWeeklyPractices, zonedDateTimeToIso } = require('../api/_lib/weekly-events');

test('weekly practices expand into individual dated events and retain cancellations', () => {
  const events = expandWeeklyPractices([{
    code: 'monday-practice',
    name: 'Monday practice',
    weekday: 'monday',
    startsOn: '2026-09-01',
    endsOn: '2026-09-21',
    startTime: '18:00',
    durationMinutes: 120,
    timeZone: 'Europe/Bratislava',
    attendanceScope: 'full_team',
    playerNames: [],
    cancellations: [{ date: '2026-09-14', reason: 'Hall closed' }]
  }]);

  assert.deepEqual(events.map((event) => event.scheduledDate), [
    '2026-09-07', '2026-09-14', '2026-09-21'
  ]);
  assert.equal(events[1].status, 'cancelled');
  assert.equal(events[1].cancellationReason, 'Hall closed');
  assert.equal(events[0].code, 'monday-practice-2026-09-07');
});

test('Bratislava weekly times retain local hour across daylight-saving changes', () => {
  assert.equal(zonedDateTimeToIso('2026-10-19', '18:00', 'Europe/Bratislava'), '2026-10-19T16:00:00.000Z');
  assert.equal(zonedDateTimeToIso('2026-10-26', '18:00', 'Europe/Bratislava'), '2026-10-26T17:00:00.000Z');
});
