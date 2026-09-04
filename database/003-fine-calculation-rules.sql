-- Adds fixed/per-unit calculations and match-day rules.
-- Run after database/002-players-and-fine-events.sql.

begin;

alter table public.fine_types
  add column if not exists calculation_mode text not null default 'fixed',
  add column if not exists unit_name text,
  add column if not exists match_day_only boolean not null default false,
  add column if not exists double_on_match_day boolean not null default false,
  add column if not exists match_day_multiplier numeric(5, 2) not null default 2;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fine_types'::regclass
      and conname = 'fine_types_calculation_mode_check'
  ) then
    alter table public.fine_types add constraint fine_types_calculation_mode_check
      check (calculation_mode in ('fixed', 'per_unit'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fine_types'::regclass
      and conname = 'fine_types_unit_check'
  ) then
    alter table public.fine_types add constraint fine_types_unit_check
      check (
        (calculation_mode = 'fixed' and unit_name is null)
        or
        (calculation_mode = 'per_unit' and length(btrim(unit_name)) > 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fine_types'::regclass
      and conname = 'fine_types_match_day_multiplier_check'
  ) then
    alter table public.fine_types add constraint fine_types_match_day_multiplier_check
      check (match_day_multiplier >= 1);
  end if;
end
$migration$;

insert into public.fine_types (
  code, name, description, calculation_mode, default_amount, unit_name,
  match_day_only, double_on_match_day, match_day_multiplier, category, active
)
values
  (
    'late-to-training', 'Meškanie', 'Neospravedlnené meškanie',
    'per_unit', 1, 'minute', false, true, 2, 'Training', true
  ),
  (
    'missed-serve-attack', 'Útok/Servis mimo/popod sieť',
    'Podanie alebo útok popod sieť (bez dotyku) alebo mimo antény',
    'fixed', 5, null, false, false, 2, 'Training', true
  ),
  (
    'dress-code', 'Chýbajúci dress code',
    'Zlý kus oblečenia (špecifikovaný)',
    'per_unit', 5, 'piece', false, true, 2, 'Equipment', true
  ),
  (
    'forgotten-item', 'Zabudnutý predmet v hale',
    'Zabudnutý predmet v hale',
    'per_unit', 2, 'piece', false, true, 2, 'Equipment', true
  ),
  (
    'forgotten-action', 'Nesplnená služba/povinnosť',
    'Nesplnená služba alebo povinnosť (Ihrisko, sieť, lekárnička atď.)',
    'fixed', 2, null, false, true, 2, 'Training', true
  ),
  (
    'loud-fart', 'Hlasný prd', 'Hlasný prd v hale alebo na porade',
    'fixed', 1, null, false, true, 2, 'Training', true
  ),
  (
    'bad-freeball', 'Nepresný freeball',
    'Nepresný freeball počas tréningu alebo zápasu',
    'fixed', 1, null, false, true, 2, 'Training', true
  ),
  (
    'bad-action', 'Malá pičovina',
    'Pičovina (opakovaná chyba z nepozornosti, hlúpa poznámka atď. posudzovaná na mieste, prípadne rada starších)',
    'fixed', 1, null, false, true, 2, 'Training', true
  ),
  (
    'very-bad-action', 'Veľká pičovina',
    'Veľká Pičovina (posudzuje rada starších)',
    'fixed', 5, null, false, true, 2, 'Training', true
  ),
  (
    'phone-during-team-talk', 'Telefón na porade',
    'Hráč použil telefón počas porady/videa, alebo keď v šatni pred zápasom rozpráva tréner',
    'fixed', 5, null, false, true, 2, 'Team', true
  ),
  (
    'kicked-from-practice', 'Vyhodenie z tréningu',
    'Hráč bol vyhodený z tréningu trénerom (fakt veľká pičovina)',
    'fixed', 50, null, false, true, 2, 'Team', true
  ),
  (
    'yellow-card', 'Žltá karta', 'Žltá karta na zápase',
    'fixed', 5, null, true, false, 2, 'Match', true
  ),
  (
    'red-card', 'Červená karta', 'Červená karta na zápase',
    'fixed', 15, null, true, false, 2, 'Match', true
  ),
  (
    'photo-in-news', 'Fotka v novinách/článku',
    'Hráč bol zobrazený na fotke v novinách alebo článku',
    'fixed', 2, null, false, false, 2, 'Media', true
  ),
  (
    'mvp', 'MVP zápasu',
    'Hráč dostal ocenenie MVP zápasu (najlepší hráč zápasu)',
    'fixed', 5, null, true, false, 2, 'Match', true
  ),
  (
    'player-of-the-month', 'Hráč mesiaca',
    'Hráč dostal ocenenie Hráč mesiaca',
    'fixed', 20, null, false, false, 2, 'Award', true
  ),
  (
    'custom-fine', 'Other',
    'Custom offence entered by the administrator.',
    'fixed', 1, null, false, true, 2, 'Other', true
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
  updated_at = now();

alter table public.fines
  add column if not exists calculation_mode_snapshot text,
  add column if not exists unit_name_snapshot text,
  add column if not exists quantity numeric(10, 2),
  add column if not exists is_match_day boolean,
  add column if not exists match_day_only_snapshot boolean,
  add column if not exists double_on_match_day_snapshot boolean,
  add column if not exists match_day_multiplier_snapshot numeric(5, 2),
  add column if not exists multiplier_applied numeric(5, 2),
  add column if not exists base_amount numeric(10, 2),
  add column if not exists calculated_amount numeric(10, 2),
  add column if not exists amount_overridden boolean;

-- Existing MVP fines did not have calculation inputs. Treat each as a fixed,
-- non-match event whose saved amount was also its calculated amount.
update public.fines set
  calculation_mode_snapshot = coalesce(calculation_mode_snapshot, 'fixed'),
  quantity = coalesce(quantity, 1),
  is_match_day = coalesce(is_match_day, false),
  match_day_only_snapshot = coalesce(match_day_only_snapshot, false),
  double_on_match_day_snapshot = coalesce(double_on_match_day_snapshot, false),
  match_day_multiplier_snapshot = coalesce(match_day_multiplier_snapshot, 1),
  multiplier_applied = coalesce(multiplier_applied, 1),
  base_amount = coalesce(base_amount, amount),
  calculated_amount = coalesce(calculated_amount, amount),
  amount_overridden = coalesce(amount_overridden, false);

alter table public.fines
  alter column calculation_mode_snapshot set default 'fixed',
  alter column calculation_mode_snapshot set not null,
  alter column quantity set default 1,
  alter column quantity set not null,
  alter column is_match_day set default false,
  alter column is_match_day set not null,
  alter column match_day_only_snapshot set default false,
  alter column match_day_only_snapshot set not null,
  alter column double_on_match_day_snapshot set default false,
  alter column double_on_match_day_snapshot set not null,
  alter column match_day_multiplier_snapshot set default 1,
  alter column match_day_multiplier_snapshot set not null,
  alter column multiplier_applied set default 1,
  alter column multiplier_applied set not null,
  alter column base_amount set not null,
  alter column calculated_amount set not null,
  alter column amount_overridden set default false,
  alter column amount_overridden set not null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fines'::regclass
      and conname = 'fines_calculation_mode_snapshot_check'
  ) then
    alter table public.fines add constraint fines_calculation_mode_snapshot_check
      check (calculation_mode_snapshot in ('fixed', 'per_unit'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fines'::regclass
      and conname = 'fines_quantity_check'
  ) then
    alter table public.fines add constraint fines_quantity_check
      check (quantity > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fines'::regclass
      and conname = 'fines_calculation_amounts_check'
  ) then
    alter table public.fines add constraint fines_calculation_amounts_check
      check (
        match_day_multiplier_snapshot >= 1
        and multiplier_applied >= 1
        and base_amount > 0
        and calculated_amount > 0
      );
  end if;
end
$migration$;

create or replace function public.prepare_fine_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  catalogue_name text;
  catalogue_description text;
  catalogue_default_amount numeric(10, 2);
  catalogue_category text;
  catalogue_calculation_mode text;
  catalogue_unit_name text;
  catalogue_match_day_only boolean;
  catalogue_double_on_match_day boolean;
  catalogue_match_day_multiplier numeric(5, 2);
begin
  if new.fine_type_id is not null then
    select
      name, description, default_amount, category, calculation_mode, unit_name,
      match_day_only, double_on_match_day, match_day_multiplier
    into
      catalogue_name, catalogue_description, catalogue_default_amount,
      catalogue_category, catalogue_calculation_mode, catalogue_unit_name,
      catalogue_match_day_only, catalogue_double_on_match_day,
      catalogue_match_day_multiplier
    from public.fine_types
    where id = new.fine_type_id and active = true;

    if not found then
      raise exception 'The selected fine type is not active.';
    end if;
  end if;

  new.name = coalesce(nullif(btrim(new.name), ''), catalogue_name);
  new.description = coalesce(
    nullif(btrim(new.description), ''),
    catalogue_description,
    ''
  );
  new.default_amount_snapshot = coalesce(
    catalogue_default_amount,
    new.default_amount_snapshot,
    new.amount
  );
  new.category_snapshot = coalesce(
    catalogue_category,
    nullif(btrim(new.category_snapshot), '')
  );
  new.calculation_mode_snapshot = coalesce(
    catalogue_calculation_mode,
    new.calculation_mode_snapshot,
    'fixed'
  );
  new.unit_name_snapshot = coalesce(
    catalogue_unit_name,
    nullif(btrim(new.unit_name_snapshot), '')
  );
  new.match_day_only_snapshot = coalesce(catalogue_match_day_only, false);
  new.double_on_match_day_snapshot = coalesce(catalogue_double_on_match_day, false);
  new.match_day_multiplier_snapshot = coalesce(catalogue_match_day_multiplier, 1);
  new.is_match_day = coalesce(new.is_match_day, false);

  if new.match_day_only_snapshot and not new.is_match_day then
    raise exception 'The selected fine can only be issued for a match day.';
  end if;

  if new.calculation_mode_snapshot = 'fixed' then
    new.quantity = 1;
    new.unit_name_snapshot = null;
  else
    new.quantity = coalesce(new.quantity, 1);
    if new.unit_name_snapshot is null then
      raise exception 'A per-unit fine must have a unit name.';
    end if;
  end if;

  new.base_amount = round(new.default_amount_snapshot * new.quantity, 2);
  new.multiplier_applied = case
    when new.is_match_day and new.double_on_match_day_snapshot
      then new.match_day_multiplier_snapshot
    else 1
  end;
  new.calculated_amount = round(new.base_amount * new.multiplier_applied, 2);
  new.amount = coalesce(new.amount, new.calculated_amount);
  new.amount_overridden = abs(new.amount - new.calculated_amount) >= 0.005;

  if new.name is null then
    raise exception 'A fine must have a name.';
  end if;

  return new;
end;
$$;

grant select (
  calculation_mode, unit_name, match_day_only, double_on_match_day,
  match_day_multiplier
)
on public.fine_types to anon, authenticated;

grant select (
  calculation_mode_snapshot, unit_name_snapshot, quantity, is_match_day,
  match_day_only_snapshot, double_on_match_day_snapshot,
  match_day_multiplier_snapshot, multiplier_applied, base_amount,
  calculated_amount, amount_overridden
)
on public.fines to anon, authenticated;

grant insert (
  calculation_mode_snapshot, unit_name_snapshot, quantity, is_match_day,
  match_day_only_snapshot, double_on_match_day_snapshot,
  match_day_multiplier_snapshot, multiplier_applied, base_amount,
  calculated_amount, amount_overridden
)
on public.fines to authenticated;

grant update (
  calculation_mode_snapshot, unit_name_snapshot, quantity, is_match_day,
  match_day_only_snapshot, double_on_match_day_snapshot,
  match_day_multiplier_snapshot, multiplier_applied, base_amount,
  calculated_amount, amount_overridden
)
on public.fines to authenticated;

grant insert (
  calculation_mode, unit_name, match_day_only, double_on_match_day,
  match_day_multiplier
)
on public.fine_types to authenticated;

grant update (
  calculation_mode, unit_name, match_day_only, double_on_match_day,
  match_day_multiplier
)
on public.fine_types to authenticated;

commit;
