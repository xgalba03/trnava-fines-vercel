# Trnava Fines MVP

This is a deliberately small Vercel + Supabase proof of concept. Anyone can view the fines; only the configured admin can add them using an email address and password.

## Deploy

1. Create a Supabase project.
2. In Supabase SQL Editor, run [`schema.sql`](schema.sql). If you already ran the original MVP schema, run [`migration.sql`](migration.sql) instead. It removes old anonymous test rows because they have no owner.
   If you still see a row-level security error after the migration, run [`repair-rls.sql`](repair-rls.sql) once.
3. Import this repository into Vercel.
4. In Vercel, open **Project Settings -> Environment Variables**.
5. Add these variables exactly, selecting **Production** (and Preview if needed):
   - `SUPABASE_URL`: Supabase **Project URL**, from **Project Settings -> API**
   - `SUPABASE_ANON_KEY`: Supabase **anon public** key, from **Project Settings -> API**
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase **service_role** key, used only by the server to read the public list
   - `ADMIN_EMAIL`: your exact Supabase Auth email address
   - `SITE_URL`: your deployed Vercel URL, such as `https://trnava-fines.vercel.app` (do not use localhost)
6. Save the variables, then choose **Deployments -> Redeploy**. Environment variables do not apply to an already-built deployment.

In Supabase, open **Authentication -> URL Configuration** and add your exact deployed URL to the allowed redirect URLs, for example `https://trnava-fines.vercel.app`. In Vercel, set `SITE_URL` to that same URL, save the variables, and redeploy. The one-time password setup link will then open the deployed site on the correct domain.

## Set the admin password

The existing passwordless administrator needs to set a password once:

1. Open the deployed app and select **Login**.
2. Enter the configured admin email and select **Send one-time setup link**.
3. Follow the emailed link. The app validates the returned Supabase session and displays the administrator controls.
4. Under **Set or change the password**, save a unique password containing at least 12 characters.
5. Future logins use the email and password and do not send an email.

The setup link cannot create a new account (`shouldCreateUser` is disabled). After the existing administrator has a password, disable new-user registration in **Supabase -> Authentication -> Providers -> Email**. Keep email enabled because password authentication uses the email provider.

For local development, copy [`.env.example`](.env.example) to `.env`, replace both placeholder values, and run the project with Vercel CLI. Never commit `.env` or expose the service role key in browser code.

The service role key is used only for the server-side public `GET` query; it is never sent to the browser. RLS still protects direct database access, and the API checks the authenticated email before allowing inserts. Passwords are handled and hashed by Supabase Auth and are never stored in this repository or in Vercel environment variables. Never put a service role key in browser code.
