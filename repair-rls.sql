alter table public.fines enable row level security;

drop policy if exists "Users can read their own fines" on public.fines;
drop policy if exists "Users can add their own fines" on public.fines;

create policy "Users can read their own fines"
on public.fines for select to authenticated
using (user_id = auth.uid());

create policy "Users can add their own fines"
on public.fines for insert to authenticated
with check (user_id = auth.uid());