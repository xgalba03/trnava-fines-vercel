alter table public.fines
add column user_id uuid references auth.users(id);

-- Existing anonymous test rows cannot be assigned to a user.
delete from public.fines
where user_id is null;

alter table public.fines
alter column user_id set not null;

alter table public.fines enable row level security;

create policy "Users can read their own fines"
on public.fines for select to authenticated
using (user_id = auth.uid());

create policy "Users can add their own fines"
on public.fines for insert to authenticated
with check (user_id = auth.uid());

-- Public visitors use the server endpoint for reads. No direct anonymous table read is allowed.