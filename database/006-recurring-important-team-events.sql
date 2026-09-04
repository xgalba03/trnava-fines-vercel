-- Adds recurring-practice metadata and richer important-team-event types to a
-- database that already ran migration 004.

begin;

alter table public.team_events
  add column if not exists recurrence_code text,
  add column if not exists scheduled_date date,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz;

alter table public.team_events
  drop constraint if exists team_events_event_type_check;

update public.team_events
set event_type = 'practice'
where event_type = 'training';

alter table public.team_events
  add constraint team_events_event_type_check
  check (event_type in ('practice', 'match', 'team_dinner', 'other'));

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.team_events'::regclass
      and conname = 'team_events_recurrence_code_check'
  ) then
    alter table public.team_events
      add constraint team_events_recurrence_code_check
      check (
        recurrence_code is null
        or recurrence_code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      );
  end if;
end
$migration$;

create index if not exists team_events_recurrence_date_idx
on public.team_events (season_id, recurrence_code, scheduled_date);

create or replace function public.validate_obligation_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assigned_event public.team_events%rowtype;
begin
  if new.scheduled_event_id is null then
    return new;
  end if;
  select * into assigned_event
  from public.team_events
  where id = new.scheduled_event_id;
  if not found
    or assigned_event.status <> 'scheduled'
    or assigned_event.attendance_scope <> 'full_team'
    or assigned_event.event_type not in ('practice', 'match') then
    raise exception 'Obligations can only use a scheduled full-team practice or match.';
  end if;
  if new.season_id <> assigned_event.season_id then
    raise exception 'The obligation and assigned event must use the same season.';
  end if;
  new.due_at = assigned_event.starts_at;
  return new;
end;
$$;

create or replace function public.move_obligations_with_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  replacement_event_id bigint;
  replacement_starts_at timestamptz;
begin
  if new.status = 'scheduled'
    and new.attendance_scope = 'full_team'
    and new.event_type in ('practice', 'match') then
    insert into public.obligation_events (
      obligation_id, event_type, from_event_id, to_event_id,
      old_due_at, new_due_at, note
    )
    select
      id, 'rescheduled', old.id, new.id, due_at, new.starts_at,
      'Team event date/time changed.'
    from public.player_obligations
    where scheduled_event_id = new.id
      and status in ('planned', 'due')
      and due_at is distinct from new.starts_at;

    update public.player_obligations
    set due_at = new.starts_at,
        updated_at = now(),
        scheduling_note = 'Moved automatically with team event.'
    where scheduled_event_id = new.id
      and status in ('planned', 'due');
    return new;
  end if;

  select id, starts_at
  into replacement_event_id, replacement_starts_at
  from public.team_events
  where season_id = new.season_id
    and id <> new.id
    and status = 'scheduled'
    and attendance_scope = 'full_team'
    and event_type in ('practice', 'match')
    and starts_at >= old.starts_at
  order by starts_at
  limit 1;

  insert into public.obligation_events (
    obligation_id, event_type, from_event_id, to_event_id,
    old_due_at, new_due_at, note
  )
  select
    id, 'rescheduled', new.id, replacement_event_id, due_at,
    replacement_starts_at,
    case
      when replacement_event_id is null
        then 'Original event became ineligible; no replacement was available.'
      else 'Original event became ineligible; moved to the next full-team practice or match.'
    end
  from public.player_obligations
  where scheduled_event_id = new.id
    and status in ('planned', 'due');

  update public.player_obligations
  set scheduled_event_id = replacement_event_id,
      due_at = replacement_starts_at,
      status = 'planned',
      updated_at = now(),
      scheduling_note = case
        when replacement_event_id is null
          then 'Original event became ineligible; administrator must choose a replacement.'
        else 'Moved automatically because the original event became ineligible.'
      end
  where scheduled_event_id = new.id
    and status in ('planned', 'due');
  return new;
end;
$$;

drop trigger if exists team_events_move_obligations on public.team_events;
create trigger team_events_move_obligations
after update of starts_at, status, attendance_scope, event_type on public.team_events
for each row
when (
  old.starts_at is distinct from new.starts_at
  or old.status is distinct from new.status
  or old.attendance_scope is distinct from new.attendance_scope
  or old.event_type is distinct from new.event_type
)
execute function public.move_obligations_with_event();

grant select (
  recurrence_code, scheduled_date, cancellation_reason, cancelled_at
)
on public.team_events to anon, authenticated;

commit;
