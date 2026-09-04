-- Fixes retry handling for databases that already ran migration 004.
-- Re-running an objection request returns the existing objection and never
-- creates a second filing fee.

begin;

create or replace function public.submit_objection(
  requested_fine_id bigint,
  objection_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_fine public.fines%rowtype;
  filing_type public.fine_types%rowtype;
  existing_objection_id bigint;
  new_objection_id bigint;
  new_fee_fine_id bigint;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required.';
  end if;
  if objection_reason is null or length(btrim(objection_reason)) = 0 then
    raise exception 'An objection reason is required.';
  end if;

  select id into existing_objection_id
  from public.objections
  where fine_id = requested_fine_id;
  if found then
    return existing_objection_id;
  end if;

  select * into original_fine
  from public.fines
  where id = requested_fine_id and voided_at is null;
  if not found then
    raise exception 'The original fine was not found or is already voided.';
  end if;

  select * into filing_type
  from public.fine_types
  where code = 'objection-filing-fee' and active = true;
  if not found then
    raise exception 'The objection filing-fee type is not active.';
  end if;

  insert into public.objections (
    fine_id, player_id, reason, created_by
  ) values (
    original_fine.id, original_fine.player_id, btrim(objection_reason), auth.uid()
  ) returning id into new_objection_id;

  update public.fines
  set objection_id = new_objection_id,
      updated_by = auth.uid()
  where id = original_fine.id;

  insert into public.fines (
    user_id, player_id, season_id, monthly_period_id, fine_type_id, name,
    description, amount, occurred_at, type, source, objection_id
  ) values (
    auth.uid(), original_fine.player_id, original_fine.season_id,
    original_fine.monthly_period_id, filing_type.id, filing_type.name,
    filing_type.description, 1, now(), 'objection_fee', 'manual',
    new_objection_id
  ) returning id into new_fee_fine_id;

  update public.objections
  set fee_fine_id = new_fee_fine_id
  where id = new_objection_id;

  return new_objection_id;
end;
$$;

revoke all on function public.submit_objection(bigint, text) from public;
grant execute on function public.submit_objection(bigint, text) to authenticated;

commit;
