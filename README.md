# Trnava Fines MVP

This is a deliberately small Vercel + Supabase proof of concept. The page lists fines and adds a new fine through `/api/fines`.

## Deploy

1. Create a Supabase project.
2. In Supabase SQL Editor, run [`schema.sql`](schema.sql).
3. Import this repository into Vercel.
4. Add these Vercel environment variables for Production (and Preview if needed):
   - `SUPABASE_URL`: the Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service role key
5. Redeploy and open the site.

The service role key is used only by the serverless function and must not be placed in `index.html`.