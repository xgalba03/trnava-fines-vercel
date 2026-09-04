# Starter data

These files are version-controlled starter data for values that are convenient
to maintain in VS Code. They contain no secrets.

The admin **Sync seed files** action copies or updates these values in Supabase. Supabase will
remain the application's runtime source of truth, so changes made later through
the admin UI can work without a redeploy. Issued fines are transaction history
and must never be maintained in these files.

Add players to `players.json` in this shape:

```json
{
  "name": "Player name",
  "jerseyNumber": 12,
  "active": true,
  "joinedOn": "2026-09-04",
  "leftOn": null
}
```

`jerseyNumber` may be `null` when it is not known. `joinedOn` and `leftOn` are
optional ISO dates. A player whose `joinedOn` falls inside the synced season is
automatically assigned the one-time new-arrival beer obligation at the first
later full-team event. Omit `joinedOn` for existing players who should not get it.

Add catalogue entries to `fine-types.json` in this shape:

```json
{
  "code": "late-to-training",
  "name": "Late to training",
  "description": "Arrived after training started",
  "calculationMode": "per_unit",
  "defaultAmount": 2,
  "unitName": "minute",
  "matchDayOnly": false,
  "doubleOnMatchDay": true,
  "matchDayMultiplier": 2,
  "category": "Training",
  "active": true
}
```

Use a stable lowercase `code` with words separated by hyphens. For a `fixed`
fine, `defaultAmount` is the complete fine and `unitName` must be `null`. For a
`per_unit` fine, `defaultAmount` is the price of one unit, such as one minute.
`matchDayOnly` controls availability, while `doubleOnMatchDay` controls whether
the configured multiplier is applied. Amounts are in euros.

Before committing changes, run:

```powershell
npm run validate:seed
```

Store birthdays in `birthdays.json` without birth years:

```json
{
  "playerName": "Player name",
  "month": 5,
  "day": 17
}
```

Names map case-insensitively to `players.json` and then to the corresponding
Supabase player row. Keep both `month` and `day` as `null` until you know a
player's date; fill both together. The sync stores these as `birth_month` and
`birth_day` on `players`. Birth years are intentionally not collected.

`team-events.json` contains one season, reusable weekly practice series, and
one-off important events. A complete copyable example is in
`team-events.example.json`.

```json
{
  "version": 1,
  "season": {
    "name": "2026/27",
    "startDate": "2026-08-01",
    "endDate": "2027-05-31",
    "active": true
  },
  "weeklyPractices": [
    {
      "code": "monday-full-team-practice",
      "name": "Monday full-team practice",
      "weekday": "monday",
      "startsOn": "2026-08-03",
      "endsOn": "2027-05-31",
      "startTime": "18:00",
      "durationMinutes": 120,
      "timeZone": "Europe/Bratislava",
      "attendanceScope": "full_team",
      "playerNames": [],
      "location": "Main hall",
      "notes": "",
      "active": true,
      "cancellations": [
        { "date": "2026-12-28", "reason": "Christmas holiday" }
      ]
    }
  ],
  "events": [
    {
      "code": "team-dinner-2026-12-19",
      "name": "Christmas team dinner",
      "type": "team_dinner",
      "startsAt": "2026-12-19T19:00:00+01:00",
      "endsAt": null,
      "attendanceScope": "full_team",
      "playerNames": [],
      "status": "scheduled",
      "cancellationReason": null,
      "location": "Restaurant",
      "notes": ""
    }
  ]
}
```

Each weekly series expands into separate dated practice records. Use lowercase
weekday names and local 24-hour time; `Europe/Bratislava` handles daylight-saving
changes. Put holiday closures in `cancellations`. A full-team event must have an
empty `playerNames` array, while a partial-team practice must list its players.

One-off `events` support `practice`, `match`, `team_dinner`, and `other`. Only
scheduled `full_team` events are eligible for birthday obligations. You can edit,
cancel, or restore an individual generated practice in the admin UI. Later seed
syncs preserve admin cancellations and completed generated practices.
