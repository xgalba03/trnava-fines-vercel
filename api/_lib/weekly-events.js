const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

function dateOnly(value) {
  return new Date(`${value}T12:00:00Z`);
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function zonedDateTimeToIso(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value])
    );
    const observed = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute)
    );
    const correction = desired - observed;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess).toISOString();
}

function expandWeeklyPractices(seriesList) {
  const events = [];
  for (const series of seriesList || []) {
    if (series.active === false) continue;
    const targetWeekday = WEEKDAYS[series.weekday];
    const cursor = dateOnly(series.startsOn);
    const end = dateOnly(series.endsOn);
    while (cursor.getUTCDay() !== targetWeekday) cursor.setUTCDate(cursor.getUTCDate() + 1);
    const cancellations = new Map(
      (series.cancellations || []).map((item) => [item.date, item.reason])
    );
    while (cursor <= end) {
      const scheduledDate = isoDate(cursor);
      const startsAt = zonedDateTimeToIso(scheduledDate, series.startTime, series.timeZone);
      const endsAt = new Date(
        new Date(startsAt).getTime() + series.durationMinutes * 60000
      ).toISOString();
      const cancellationReason = cancellations.get(scheduledDate) || null;
      events.push({
        code: `${series.code}-${scheduledDate}`,
        name: series.name,
        type: 'practice',
        startsAt,
        endsAt,
        attendanceScope: series.attendanceScope,
        playerNames: series.playerNames,
        status: cancellationReason ? 'cancelled' : 'scheduled',
        cancellationReason,
        recurrenceCode: series.code,
        scheduledDate,
        location: series.location || '',
        notes: series.notes || ''
      });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  return events;
}

module.exports = { WEEKDAYS, expandWeeklyPractices, zonedDateTimeToIso };
