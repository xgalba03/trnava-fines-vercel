# Trnava Fines MVP

This is a deliberately small Vercel + Supabase proof of concept. Anyone can view the fines; only the configured admin can add them using a passwordless email link.

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

In Supabase, open **Authentication -> URL Configuration** and add your exact deployed URL to the allowed redirect URLs, for example `https://trnava-fines.vercel.app`. In Vercel, set `SITE_URL` to that same URL, save the variables, and redeploy. The magic link will then open the deployed site in Safari on your iPhone.

For local development, copy [`.env.example`](.env.example) to `.env`, replace both placeholder values, and run the project with Vercel CLI. Never commit `.env` or expose the service role key in browser code.

The service role key is used only for the server-side public `GET` query; it is never sent to the browser. RLS still protects direct database access, and the API checks the authenticated email before allowing inserts. Never put a service role key in browser code.