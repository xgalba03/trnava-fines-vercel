# Starter data

These files are version-controlled starter data for values that are convenient
to maintain in VS Code. They contain no secrets.

The planned importer will copy or update these values in Supabase. Supabase will
remain the application's runtime source of truth, so changes made later through
the admin UI can work without a redeploy. Issued fines are transaction history
and must never be maintained in these files.

Add players to `players.json` in this shape:

```json
{
  "name": "Player name",
  "jerseyNumber": 12,
  "active": true
}
```

`jerseyNumber` may be `null` when it is not known.

Add catalogue entries to `fine-types.json` in this shape:

```json
{
  "code": "late-to-training",
  "name": "Late to training",
  "description": "Arrived after training started",
  "defaultAmount": 2,
  "category": "Training",
  "active": true
}
```

Use a stable lowercase `code` with words separated by hyphens. The amount is in
euros. Before committing changes, run:

```powershell
npm run validate:seed
```
