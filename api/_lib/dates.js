const TIME_ZONE = 'Europe/Bratislava';

function localDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateRangeAfter(startDate, throughDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${throughDate}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

module.exports = { dateRangeAfter, localDateString };
