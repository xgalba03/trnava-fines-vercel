-- Adds the system-managed fine type used by the daily monthly-settlement job.
-- Existing fine history and payment records are unchanged.

begin;

insert into public.fine_types (
  code, name, description, calculation_mode, default_amount, unit_name,
  match_day_only, double_on_match_day, match_day_multiplier, category,
  active, system_managed
) values (
  'late-payment',
  'Late monthly payment',
  'Automatic daily penalty for an overdue monthly settlement.',
  'fixed',
  1.00,
  null,
  false,
  false,
  1,
  'Payment',
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  calculation_mode = excluded.calculation_mode,
  default_amount = excluded.default_amount,
  unit_name = excluded.unit_name,
  match_day_only = excluded.match_day_only,
  double_on_match_day = excluded.double_on_match_day,
  match_day_multiplier = excluded.match_day_multiplier,
  category = excluded.category,
  active = excluded.active,
  system_managed = excluded.system_managed;

commit;
