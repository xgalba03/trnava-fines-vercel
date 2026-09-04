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

`team-events.json` contains one season and its changeable calendar. A full-team
event must have an empty `playerNames` array. A partial practice must list the
participating players:

```json
{
  "version": 1,
  "season": {
    "name": "2026/27",
    "startDate": "2026-08-01",
    "endDate": "2027-05-31",
    "active": true
  },
  "events": [
    {
      "code": "training-2026-09-04-a",
      "name": "Friday training",
      "type": "training",
      "startsAt": "2026-09-04T18:00:00+02:00",
      "endsAt": "2026-09-04T20:00:00+02:00",
      "attendanceScope": "full_team",
      "playerNames": [],
      "status": "scheduled",
      "location": "Trnava",
      "notes": ""
    }
  ]
}
```

Only scheduled full-team events are eligible for automatically assigned
birthday obligations. Database records remain editable by the administrator;
the files provide repeatable starting data rather than an immutable calendar.
