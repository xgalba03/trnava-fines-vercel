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
4. Use [`migration.sql`](migration.sql) only for the original MVP table that had
   no `user_id` column. Read its warning first: it deletes rows that cannot be
   assigned to an owner.
5. Import this repository into Vercel.
6. In **Vercel -> Project Settings -> Environment Variables**, add the variables
   listed in [`.env.example`](.env.example) for Production (and Preview if used):
   - `SUPABASE_URL`: the Supabase Project URL.
   - `SUPABASE_ANON_KEY`: the publishable/anon key used for public reads and
     authenticated writes, with RLS still enforced.
   - `SUPABASE_SERVICE_ROLE_KEY`: the server-only elevated key used for admin
     Auth operations such as setting a password.
   - `ADMIN_EMAIL`: the same email embedded in the database policies.
   - `SITE_URL`: the production HTTPS Vercel URL, without a trailing path.
7. Redeploy after changing environment variables.

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

The files intentionally begin with empty player and fine-type lists because the
real values have not been supplied yet. Check edits before committing them:

```powershell
npm run validate:seed
```

After migration `002` is applied, the next small implementation step is to read
players from Supabase in the app and update the Add Fine API to save a
`player_id`. Supabase remains the runtime source of truth so the future admin UI
can update data without a code deployment. Fine history stays exclusively in
the database and is not stored in the seed files.
