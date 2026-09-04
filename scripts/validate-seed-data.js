const fs = require('node:fs');
const path = require('node:path');
const { WEEKDAYS, expandWeeklyPractices } = require('../api/_lib/weekly-events');

const projectRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

function requireVersionOne(document, fileName) {
  if (document.version !== 1) {
    throw new Error(`${fileName}: version must be 1.`);
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be true or false.`);
  }
}

function assertUnique(values, field) {
  const seen = new Set();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (seen.has(normalized)) throw new Error(`${field} contains duplicate value: ${value}.`);
    seen.add(normalized);
  }
}

function validatePlayers(document) {
  requireVersionOne(document, 'seed/players.json');
  if (!Array.isArray(document.players)) {
    throw new Error('seed/players.json: players must be an array.');
  }

  document.players.forEach((player, index) => {
    const prefix = `seed/players.json: players[${index}]`;
    requireNonEmptyString(player.name, `${prefix}.name`);
    if (player.jerseyNumber !== null && !Number.isInteger(player.jerseyNumber)) {
      throw new Error(`${prefix}.jerseyNumber must be an integer or null.`);
    }
    requireBoolean(player.active, `${prefix}.active`);
    for (const field of ['joinedOn', 'leftOn']) {
      if (player[field] !== undefined && player[field] !== null
        && !/^\d{4}-\d{2}-\d{2}$/.test(player[field])) {
        throw new Error(`${prefix}.${field} must be YYYY-MM-DD, null or omitted.`);
      }
    }
    if (player.joinedOn && player.leftOn && player.leftOn < player.joinedOn) {
      throw new Error(`${prefix}.leftOn cannot be before joinedOn.`);
    }
  });

  assertUnique(document.players.map((player) => player.name), 'Player names');
  assertUnique(document.players.map((player) => player.jerseyNumber), 'Player jersey numbers');
}

function validateFineTypes(document) {
  requireVersionOne(document, 'seed/fine-types.json');
  if (!Array.isArray(document.fineTypes)) {
    throw new Error('seed/fine-types.json: fineTypes must be an array.');
  }

  document.fineTypes.forEach((fineType, index) => {
    const prefix = `seed/fine-types.json: fineTypes[${index}]`;
    requireNonEmptyString(fineType.code, `${prefix}.code`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fineType.code)) {
      throw new Error(`${prefix}.code must use lowercase words separated by hyphens.`);
    }
    requireNonEmptyString(fineType.name, `${prefix}.name`);
    if (typeof fineType.description !== 'string') {
      throw new Error(`${prefix}.description must be a string.`);
    }
    if (!['fixed', 'per_unit'].includes(fineType.calculationMode)) {
      throw new Error(`${prefix}.calculationMode must be fixed or per_unit.`);
    }
    if (!Number.isFinite(fineType.defaultAmount) || fineType.defaultAmount <= 0) {
      throw new Error(`${prefix}.defaultAmount must be a positive number.`);
    }
    if (fineType.calculationMode === 'per_unit') {
      requireNonEmptyString(fineType.unitName, `${prefix}.unitName`);
    } else if (fineType.unitName !== null) {
      throw new Error(`${prefix}.unitName must be null for a fixed fine.`);
    }
    requireBoolean(fineType.matchDayOnly, `${prefix}.matchDayOnly`);
    requireBoolean(fineType.doubleOnMatchDay, `${prefix}.doubleOnMatchDay`);
    if (!Number.isFinite(fineType.matchDayMultiplier) || fineType.matchDayMultiplier < 1) {
      throw new Error(`${prefix}.matchDayMultiplier must be at least 1.`);
    }
    requireNonEmptyString(fineType.category, `${prefix}.category`);
    requireBoolean(fineType.active, `${prefix}.active`);
  });

  assertUnique(document.fineTypes.map((fineType) => fineType.code), 'Fine type codes');
}

function validateSettings(document) {
  requireVersionOne(document, 'seed/settings.json');
  const settings = document.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('seed/settings.json: settings must be an object.');
  }
  if (!Number.isInteger(settings.daysAfterClubPaymentBeforeDeadline)
    || settings.daysAfterClubPaymentBeforeDeadline < 0) {
    throw new Error('settings.daysAfterClubPaymentBeforeDeadline must be a non-negative integer.');
  }
  if (!Number.isFinite(settings.dailyLatePaymentFine) || settings.dailyLatePaymentFine <= 0) {
    throw new Error('settings.dailyLatePaymentFine must be a positive number.');
  }
  requireBoolean(settings.latePenaltiesEnabled, 'settings.latePenaltiesEnabled');
  if (!Number.isFinite(settings.defaultMatchDayMultiplier)
    || settings.defaultMatchDayMultiplier < 1) {
    throw new Error('settings.defaultMatchDayMultiplier must be at least 1.');
  }
}

function validateBirthdays(document) {
  requireVersionOne(document, 'seed/birthdays.json');
  if (!Array.isArray(document.birthdays)) {
    throw new Error('seed/birthdays.json: birthdays must be an array.');
  }

  document.birthdays.forEach((birthday, index) => {
    const prefix = `seed/birthdays.json: birthdays[${index}]`;
    requireNonEmptyString(birthday.playerName, `${prefix}.playerName`);
    if (birthday.month === null && birthday.day === null) return;
    if (birthday.month === null || birthday.day === null) {
      throw new Error(`${prefix}.month and .day must both be filled or both be null.`);
    }
    if (!Number.isInteger(birthday.month) || birthday.month < 1 || birthday.month > 12) {
      throw new Error(`${prefix}.month must be an integer from 1 to 12.`);
    }
    if (!Number.isInteger(birthday.day) || birthday.day < 1 || birthday.day > 31) {
      throw new Error(`${prefix}.day must be an integer from 1 to 31.`);
    }
    const date = new Date(Date.UTC(2000, birthday.month - 1, birthday.day));
    if (date.getUTCMonth() !== birthday.month - 1 || date.getUTCDate() !== birthday.day) {
      throw new Error(`${prefix} is not a valid calendar date.`);
    }
  });

  assertUnique(document.birthdays.map((birthday) => birthday.playerName), 'Birthday player names');
}

function validateTeamEvents(document) {
  requireVersionOne(document, 'seed/team-events.json');
  if (!Array.isArray(document.events)) {
    throw new Error('seed/team-events.json: events must be an array.');
  }
  if (!Array.isArray(document.weeklyPractices)) {
    throw new Error('seed/team-events.json: weeklyPractices must be an array.');
  }
  if (document.season === null) {
    if (document.events.length || document.weeklyPractices.length) {
      throw new Error('seed/team-events.json: season is required when events or practices are present.');
    }
    return;
  }

  requireNonEmptyString(document.season?.name, 'seed/team-events.json: season.name');
  const startDate = new Date(`${document.season.startDate}T00:00:00Z`);
  const endDate = new Date(`${document.season.endDate}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    throw new Error('seed/team-events.json: season dates must be valid and ordered.');
  }

  document.events.forEach((event, index) => {
    const prefix = `seed/team-events.json: events[${index}]`;
    requireNonEmptyString(event.code, `${prefix}.code`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.code)) {
      throw new Error(`${prefix}.code must use lowercase words separated by hyphens.`);
    }
    requireNonEmptyString(event.name, `${prefix}.name`);
    if (!['practice', 'training', 'match', 'team_dinner', 'other'].includes(event.type)) {
      throw new Error(`${prefix}.type must be practice, match, team_dinner or other.`);
    }
    if (!['full_team', 'partial_team'].includes(event.attendanceScope)) {
      throw new Error(`${prefix}.attendanceScope must be full_team or partial_team.`);
    }
    if (!['scheduled', 'cancelled', 'completed'].includes(event.status)) {
      throw new Error(`${prefix}.status must be scheduled, cancelled or completed.`);
    }
    const startsAt = new Date(event.startsAt);
    const endsAt = event.endsAt ? new Date(event.endsAt) : null;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      throw new Error(`${prefix} has an invalid date/time.`);
    }
    if (endsAt && endsAt <= startsAt) {
      throw new Error(`${prefix}.endsAt must be after startsAt.`);
    }
    const eventDate = String(event.startsAt).slice(0, 10);
    if (eventDate < document.season.startDate || eventDate > document.season.endDate) {
      throw new Error(`${prefix}.startsAt must fall inside the season.`);
    }
    if (event.status === 'cancelled') {
      requireNonEmptyString(event.cancellationReason, `${prefix}.cancellationReason`);
    }
    if (!Array.isArray(event.playerNames)) {
      throw new Error(`${prefix}.playerNames must be an array.`);
    }
    if (event.attendanceScope === 'full_team' && event.playerNames.length) {
      throw new Error(`${prefix}.playerNames must be empty for a full-team event.`);
    }
    if (event.attendanceScope === 'partial_team' && !event.playerNames.length) {
      throw new Error(`${prefix}.playerNames must identify the partial group.`);
    }
    event.playerNames.forEach((name, playerIndex) => {
      requireNonEmptyString(name, `${prefix}.playerNames[${playerIndex}]`);
    });
    assertUnique(event.playerNames, `${prefix}.playerNames`);
  });

  document.weeklyPractices.forEach((series, index) => {
    const prefix = `seed/team-events.json: weeklyPractices[${index}]`;
    requireNonEmptyString(series.code, `${prefix}.code`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(series.code)) {
      throw new Error(`${prefix}.code must use lowercase words separated by hyphens.`);
    }
    requireNonEmptyString(series.name, `${prefix}.name`);
    if (!Object.hasOwn(WEEKDAYS, series.weekday)) {
      throw new Error(`${prefix}.weekday must be a lowercase weekday name.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(series.startsOn)
      || !/^\d{4}-\d{2}-\d{2}$/.test(series.endsOn)
      || series.endsOn < series.startsOn) {
      throw new Error(`${prefix}.startsOn and .endsOn must be ordered ISO dates.`);
    }
    if (series.startsOn < document.season.startDate || series.endsOn > document.season.endDate) {
      throw new Error(`${prefix} date range must fall inside the season.`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(series.startTime)) {
      throw new Error(`${prefix}.startTime must use 24-hour HH:MM format.`);
    }
    if (!Number.isInteger(series.durationMinutes) || series.durationMinutes < 1 || series.durationMinutes > 1440) {
      throw new Error(`${prefix}.durationMinutes must be an integer from 1 to 1440.`);
    }
    requireNonEmptyString(series.timeZone, `${prefix}.timeZone`);
    try {
      new Intl.DateTimeFormat('en', { timeZone: series.timeZone }).format();
    } catch {
      throw new Error(`${prefix}.timeZone is not recognized.`);
    }
    requireBoolean(series.active, `${prefix}.active`);
    if (!['full_team', 'partial_team'].includes(series.attendanceScope)) {
      throw new Error(`${prefix}.attendanceScope must be full_team or partial_team.`);
    }
    if (!Array.isArray(series.playerNames)) {
      throw new Error(`${prefix}.playerNames must be an array.`);
    }
    if (series.attendanceScope === 'full_team' && series.playerNames.length) {
      throw new Error(`${prefix}.playerNames must be empty for a full-team practice.`);
    }
    if (series.attendanceScope === 'partial_team' && !series.playerNames.length) {
      throw new Error(`${prefix}.playerNames must identify the partial group.`);
    }
    series.playerNames.forEach((name, playerIndex) => {
      requireNonEmptyString(name, `${prefix}.playerNames[${playerIndex}]`);
    });
    assertUnique(series.playerNames, `${prefix}.playerNames`);
    if (!Array.isArray(series.cancellations)) {
      throw new Error(`${prefix}.cancellations must be an array.`);
    }
    series.cancellations.forEach((cancellation, cancellationIndex) => {
      const cancellationPrefix = `${prefix}.cancellations[${cancellationIndex}]`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cancellation.date)
        || cancellation.date < series.startsOn || cancellation.date > series.endsOn) {
        throw new Error(`${cancellationPrefix}.date must fall inside the series range.`);
      }
      requireNonEmptyString(cancellation.reason, `${cancellationPrefix}.reason`);
      if (new Date(`${cancellation.date}T12:00:00Z`).getUTCDay() !== WEEKDAYS[series.weekday]) {
        throw new Error(`${cancellationPrefix}.date is not a ${series.weekday}.`);
      }
    });
    assertUnique(series.cancellations.map((item) => item.date), `${prefix}.cancellations dates`);
  });

  assertUnique(document.weeklyPractices.map((series) => series.code), 'Weekly practice codes');
  const generatedEvents = expandWeeklyPractices(document.weeklyPractices);
  assertUnique(
    [...document.events.map((event) => event.code), ...generatedEvents.map((event) => event.code)],
    'All generated and one-off team event codes'
  );
}

function validateObligationTypes(document) {
  requireVersionOne(document, 'seed/obligation-types.json');
  if (!Array.isArray(document.obligationTypes)) {
    throw new Error('seed/obligation-types.json: obligationTypes must be an array.');
  }

  document.obligationTypes.forEach((type, index) => {
    const prefix = `seed/obligation-types.json: obligationTypes[${index}]`;
    requireNonEmptyString(type.code, `${prefix}.code`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(type.code)) {
      throw new Error(`${prefix}.code must use lowercase words separated by hyphens.`);
    }
    requireNonEmptyString(type.name, `${prefix}.name`);
    requireNonEmptyString(type.description, `${prefix}.description`);
    requireNonEmptyString(type.itemName, `${prefix}.itemName`);
    if (!['once', 'annual'].includes(type.recurrence)) {
      throw new Error(`${prefix}.recurrence must be once or annual.`);
    }
    if (!Number.isFinite(type.dailyPenaltyAmount) || type.dailyPenaltyAmount < 0) {
      throw new Error(`${prefix}.dailyPenaltyAmount must be a non-negative number.`);
    }
    requireBoolean(type.active, `${prefix}.active`);
  });

  assertUnique(document.obligationTypes.map((type) => type.code), 'Obligation type codes');
}

function validateBirthdayPlayerMappings(birthdaysDocument, playersDocument) {
  const playerNames = new Set(playersDocument.players.map((player) => player.name.trim().toLowerCase()));
  for (const birthday of birthdaysDocument.birthdays) {
    if (!playerNames.has(birthday.playerName.trim().toLowerCase())) {
      throw new Error(`seed/birthdays.json: unknown playerName: ${birthday.playerName}.`);
    }
  }
}

function validateTeamEventPlayerMappings(eventsDocument, playersDocument, fileName) {
  const playerNames = new Set(playersDocument.players.map((player) => player.name.trim().toLowerCase()));
  const participantLists = [
    ...eventsDocument.events.map((event) => ({ code: event.code, names: event.playerNames })),
    ...eventsDocument.weeklyPractices.map((series) => ({ code: series.code, names: series.playerNames }))
  ];
  for (const item of participantLists) {
    for (const name of item.names) {
      if (!playerNames.has(name.trim().toLowerCase())) {
        throw new Error(`${fileName}: ${item.code} references unknown playerName: ${name}.`);
      }
    }
  }
}

const playersDocument = readJson('seed/players.json');
const birthdaysDocument = readJson('seed/birthdays.json');

validatePlayers(playersDocument);
validateFineTypes(readJson('seed/fine-types.json'));
validateSettings(readJson('seed/settings.json'));
validateBirthdays(birthdaysDocument);
validateBirthdayPlayerMappings(birthdaysDocument, playersDocument);
const teamEventsDocument = readJson('seed/team-events.json');
validateTeamEvents(teamEventsDocument);
validateTeamEventPlayerMappings(teamEventsDocument, playersDocument, 'seed/team-events.json');
const exampleEventsDocument = readJson('seed/team-events.example.json');
validateTeamEvents(exampleEventsDocument);
validateTeamEventPlayerMappings(exampleEventsDocument, playersDocument, 'seed/team-events.example.json');
validateObligationTypes(readJson('seed/obligation-types.json'));

console.log('Seed data is valid.');
