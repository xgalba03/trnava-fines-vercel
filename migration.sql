-- One-time migration for the original MVP table that did not have user_id.
-- This deletes old rows without an owner. Review that behaviour before running.
-- Replace __ADMIN_EMAIL__ with the same email used for ADMIN_EMAIL in Vercel.

begin;

alter table public.fines
add column user_id uuid references auth.users(id);

delete from public.fines
where user_id is null;

alter table public.fines
alter column user_id set not null;

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
