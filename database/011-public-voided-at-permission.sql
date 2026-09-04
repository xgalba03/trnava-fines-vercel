-- Compatibility fix for databases that already ran migration 010 before its
-- public voided_at grant was added. This does not expose void_reason or voided_by.

begin;

grant select (voided_at)
on public.fines to anon, authenticated;

commit;
