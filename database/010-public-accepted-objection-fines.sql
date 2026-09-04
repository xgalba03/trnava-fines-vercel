-- Show accepted-objection fines in public history without making other voided
-- fines public. Balance queries must continue filtering on voided_at is null.

begin;

drop policy if exists "Anyone can read fines" on public.fines;
drop policy if exists "Anyone can read active or accepted-objection fines" on public.fines;

create policy "Anyone can read active or accepted-objection fines"
on public.fines for select to anon, authenticated
using (
  voided_at is null
  or exists (
    select 1
    from public.objections
    where objections.id = fines.objection_id
      and objections.fine_id = fines.id
      and objections.status = 'accepted'
  )
);

commit;
