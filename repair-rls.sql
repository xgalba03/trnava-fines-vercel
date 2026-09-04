-- MVP ONLY: do not run this after database/002-players-and-fine-events.sql.
-- Safe policy/privilege repair for an existing fines table. This does not
-- modify or delete fine rows. Replace __ADMIN_EMAIL__ with the same email used
-- for ADMIN_EMAIL in Vercel before running it in Supabase SQL Editor.

begin;

alter table public.fines enable row level security;

drop policy if exists "Users can read their own fines" on public.fines;
drop policy if exists "Users can add their own fines" on public.fines;
drop policy if exists "Anyone can read fines" on public.fines;
drop policy if exists "Admin can add fines" on public.fines;
drop policy if exists "Admin can update fines" on public.fines;
drop policy if exists "Admin can delete fines" on public.fines;

revoke all privileges on table public.fines from anon, authenticated;
grant select (id, description, amount, created_at)
on public.fines to anon, authenticated;
grant insert (user_id, description, amount)
on public.fines to authenticated;
grant update (description, amount)
on public.fines to authenticated;
grant delete on public.fines to authenticated;

create policy "Anyone can read fines"
on public.fines for select to anon, authenticated
using (true);

create policy "Admin can add fines"
on public.fines for insert to authenticated
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = lower('__ADMIN_EMAIL__')
  and user_id = auth.uid()
);

create policy "Admin can update fines"
on public.fines for update to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = lower('__ADMIN_EMAIL__'))
with check (
  lower(coalesce(auth.jwt() ->> 'email', '')) = lower('__ADMIN_EMAIL__')
  and user_id = auth.uid()
);

create policy "Admin can delete fines"
on public.fines for delete to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = lower('__ADMIN_EMAIL__'));

commit;
