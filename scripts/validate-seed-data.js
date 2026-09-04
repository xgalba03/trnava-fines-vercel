const fs = require('node:fs');
const path = require('node:path');

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
    if (!Number.isFinite(fineType.defaultAmount) || fineType.defaultAmount <= 0) {
      throw new Error(`${prefix}.defaultAmount must be a positive number.`);
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
}

validatePlayers(readJson('seed/players.json'));
validateFineTypes(readJson('seed/fine-types.json'));
validateSettings(readJson('seed/settings.json'));

console.log('Seed data is valid.');
