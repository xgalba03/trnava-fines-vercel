# Trnava Fines MVP

This is a deliberately small Vercel + Supabase proof of concept. The page lists fines and adds a new fine through `/api/fines`.

## Deploy

1. Create a Supabase project.
2. In Supabase SQL Editor, run [`schema.sql`](schema.sql).
3. Import this repository into Vercel.
4. In Vercel, open **Project Settings -> Environment Variables**.
5. Add these variables exactly, selecting **Production** (and Preview if needed):
   - `SUPABASE_URL`: Supabase **Project URL**, from **Project Settings -> API**
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase **service_role** key, from **Project Settings -> API**
6. Save the variables, then choose **Deployments -> Redeploy**. Environment variables do not apply to an already-built deployment.

For local development, copy [`.env.example`](.env.example) to `.env`, replace both placeholder values, and run the project with Vercel CLI. Never commit `.env` or expose the service role key in browser code.

The service role key is used only by the serverless function and must not be placed in `index.html`.