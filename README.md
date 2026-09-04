# Trnava Fines MVP

This is a deliberately small Vercel + Supabase application. Anyone can view the
safe public fine fields; only the configured administrator can change data after
logging in with email and password.

## Deploy

1. Create a Supabase project.
2. For a new database, replace `__ADMIN_EMAIL__` in [`schema.sql`](schema.sql)
   with the administrator's exact email address and run it first. Then run the
   `002` migration from the next step.
3. For both new and existing MVP databases, replace `__ADMIN_EMAIL__` in
   [`database/002-players-and-fine-events.sql`](database/002-players-and-fine-events.sql),
   then run that migration. It preserves existing fine rows, creates the core
   statistics-ready tables, and seeds the version-controlled player names.
4. Run [`database/003-fine-calculation-rules.sql`](database/003-fine-calculation-rules.sql)
   to add fixed/per-unit calculations, match-day rules, event snapshots and the
   fine catalogue.
5. Run [`database/004-obligations-events-and-objections.sql`](database/004-obligations-events-and-objections.sql)
   to add birthdays, full/partial-team events, editable obligations, objection
   fees and account credits. Run the migrations in numeric order and only once.
6. If migration `004` was applied before the retry fix, run
   [`database/005-idempotent-objections.sql`](database/005-idempotent-objections.sql).
7. Run [`database/006-recurring-important-team-events.sql`](database/006-recurring-important-team-events.sql)
   to add weekly practice metadata, cancellation reasons, and explicit practice,
   match, team-dinner and other event types.
8. Run [`database/007-player-payment-ledger.sql`](database/007-player-payment-ledger.sql)
   to add monthly player payments, calculated balances, and reversible payment
   records. This migration does not change or mark individual fines.
9. Use [`migration.sql`](migration.sql) only for the original MVP table that had
   no `user_id` column. Read its warning first: it deletes rows that cannot be
   assigned to an owner.
10. Import this repository into Vercel.
11. In **Vercel -> Project Settings -> Environment Variables**, add the variables
   listed in [`.env.example`](.env.example) for Production (and Preview if used):
   - `SUPABASE_URL`: the Supabase Project URL.
   - `SUPABASE_ANON_KEY`: the publishable/anon key used for public reads and
     authenticated writes, with RLS still enforced.
   - `SUPABASE_SERVICE_ROLE_KEY`: the server-only elevated key used for admin
     Auth operations such as setting a password.
   - `ADMIN_EMAIL`: the same email embedded in the database policies.
   - `SITE_URL`: the production HTTPS Vercel URL, without a trailing path.
   - `CRON_SECRET`: a long random server-only secret used by Vercel when it runs
     the daily obligation penalty job.
12. Redeploy after changing environment variables.

In **Supabase -> Authentication -> URL Configuration**, set the Site URL and an
allowed redirect URL to the deployed site. This ensures the one-time password
setup link returns to production instead of `localhost`.

## Set the admin password

The existing passwordless administrator needs to set a password once:

1. Open the deployed app and select **Login**.
2. Enter the configured admin email and select **Send one-time setup link**.
3. Follow the link and save a unique password containing at least 12 characters.
4. Future logins use that email and password and do not send an email.

The setup link cannot create a new account (`shouldCreateUser` is disabled).
After the administrator has a password, disable new-user registration in
**Supabase -> Authentication -> Providers -> Email**. Keep the email provider
enabled because password login uses it.

Passwords are hashed and stored by Supabase Auth. They are never stored in this
repository or in Vercel environment variables. The service role key must never
be put in browser code.

## Local environment

Copy [`.env.example`](.env.example) to `.env`, fill in the values, and run the
project with the Vercel CLI. `.env` and `.env.*` are ignored by Git, except for
the safe placeholder file `.env.example`.

Environment variables are for deployment and secrets, not for players or fine
types. Keeping list data in environment variables would be difficult to edit,
validate, and version.

## Starter data

Version-controlled starter lists live in [`seed/`](seed/README.md):

- `players.json` for player names, jersey numbers, and active status.
- `fine-types.json` for the fine catalogue and default euro amounts.
- `settings.json` for the late-payment defaults from the design specification.
- `birthdays.json` for birthday month/day values without unnecessary birth years.
- `team-events.json` for the editable season calendar and full/partial attendance.
- `team-events.example.json` as a copyable weekly-practice, match, and dinner template.
- `obligation-types.json` for non-cash duties such as beer or birthday snacks.

Check edits before committing them:

```powershell
npm run validate:seed
```

The Add Fine form reads players and fine types from Supabase. Its calculated
amount can be overridden by the administrator; the original calculation and an
override flag remain in the fine event for later statistics. Supabase remains
the runtime source of truth, and fine history stays exclusively in the database.
For per-unit fines, quantity is the measured number of units (for example,
minutes late) and produces one fine event. For fixed fines, quantity is the
number of occurrences and one submission creates that many separate fine events
with a shared batch identifier.

After editing seed JSON and deploying it, log in and select **Sync seed files**.
The sync updates matching catalogue/calendar records by their stable codes; it
does not delete database-only records or historical fines. Later admin UI changes
remain possible without changing JSON. A future sync deliberately reapplies the
values in the files for matching records.

## Events, birthdays and obligations

Weekly definitions in `team-events.json` expand into individual practice events,
so one date can be cancelled or moved without changing the rest of the series.
Generated events retain a recurrence code and their originally scheduled date
for later statistics. One-off important events can be practices, matches, team
dinners, or another custom event.

Only an event marked `full_team` can carry an automatically scheduled birthday
obligation. Partial-team practices store their explicit player list but are not
eligible. For birthdays within the season, the scheduler chooses the first
eligible event on or after the birthday. An outside-season birthday is placed in
the largest available calendar gap. Moving an eligible event moves its linked
obligations; cancelling it or changing it to partial-team moves them to the next
eligible event when one exists.

The administrator can add, edit and cancel events, and add, fulfil, move, waive,
cancel or reopen obligations. Automatic schedules never overwrite a manual
reschedule or a completed/cancelled/waived obligation.

An optional `joinedOn` date in `players.json` creates the one-time new-arrival
beer obligation at the first later full-team event in that season. Existing
players without `joinedOn` are not treated as new arrivals.

The daily Vercel job creates one €1 fine for every calendar day after an overdue
birthday snack remains unfulfilled. Its idempotency key makes retries safe. Mark
the obligation fulfilled, waived or cancelled to stop future daily fines.

## Objections

Use **Object** next to an ordinary fine. Submission creates the agreed €1 filing
fee. Accepting the objection voids the original fine and records a €2 negative
financial adjustment (account credit); it is never represented as a cash payout.
Rejecting it leaves the original fine and filing fee in place. Historical fine
snapshots remain unchanged even if a catalogue type is edited later.

## Monthly payments

The monthly balance is calculated per player as active fines plus signed account
adjustments, minus payments recorded for that month. Payments apply to the
player's monthly account rather than to individual fines, so one cash or bank
transfer can settle the whole amount. An overpayment appears as account credit.
Unpaid balances and credits are carried into the following month automatically.

For each settlement month, the administrator can enter the actual date on which
the club payment arrived. The player deadline is calculated using
`daysAfterClubPaymentBeforeDeadline` from `seed/settings.json` (currently five
calendar days). The public balance list then shows each player as payment due,
settled, overdue, account credit, or no balance. This status is calculated from
the ledger and deadline; it is not a manually maintained checkbox.

Log in and use **Admin -> Record a payment**, or select **Record** next to a
player's monthly balance. Payment method and the private administrator note are
not returned to public visitors. If a payment was entered incorrectly, reverse
it from the payment list; the original record remains in Supabase for the audit
trail and no longer reduces the player's balance.
