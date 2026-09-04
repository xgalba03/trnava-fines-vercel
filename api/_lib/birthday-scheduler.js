function dateOnly(value) {
  return new Date(`${value}T12:00:00Z`);
}

function birthdayOccurrences(month, day, startYear, endYear) {
  const dates = [];
  for (let year = startYear - 1; year <= endYear + 1; year += 1) {
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) dates.push(date);
  }
  return dates;
}

function chooseLargestGapEvent(events, assignedTimes, seasonStart, seasonEnd) {
  if (!events.length) return null;
  const unused = events.filter((event) => !assignedTimes.includes(new Date(event.starts_at).getTime()));
  const candidates = unused.length ? unused : events;
  const anchors = [seasonStart.getTime(), seasonEnd.getTime(), ...assignedTimes];
  return candidates.reduce((best, event) => {
    const time = new Date(event.starts_at).getTime();
    const score = Math.min(...anchors.map((anchor) => Math.abs(time - anchor)));
    if (!best || score > best.score || (score === best.score && time < best.time)) {
      return { event, score, time };
    }
    return best;
  }, null)?.event || null;
}

async function scheduleBirthdays(supabase, userId, season) {
  const [{ data: players, error: playersError }, { data: events, error: eventsError }, typeResult] = await Promise.all([
    supabase.from('players').select('id, name, birth_month, birth_day').eq('active', true),
    supabase
      .from('team_events')
      .select('id, starts_at')
      .eq('season_id', season.id)
      .eq('status', 'scheduled')
      .eq('attendance_scope', 'full_team')
      .in('event_type', ['practice', 'match'])
      .order('starts_at', { ascending: true }),
    supabase.from('obligation_types').select('id').eq('code', 'birthday-snack').single()
  ]);
  if (playersError) throw playersError;
  if (eventsError) throw eventsError;
  if (typeResult.error) throw typeResult.error;

  const eligiblePlayers = (players || []).filter((player) => player.birth_month && player.birth_day);
  const { data: existing, error: existingError } = await supabase
    .from('player_obligations')
    .select('id, player_id, status, schedule_mode, scheduled_event_id, due_at')
    .eq('season_id', season.id)
    .eq('obligation_type_id', typeResult.data.id);
  if (existingError) throw existingError;
  const existingByPlayer = new Map((existing || []).map((item) => [item.player_id, item]));

  const start = dateOnly(season.start_date);
  const end = dateOnly(season.end_date);
  const assignedTimes = [];
  const plans = [];

  for (const player of eligiblePlayers) {
    const current = existingByPlayer.get(player.id);
    if (current?.schedule_mode === 'manual' || ['fulfilled', 'cancelled', 'waived'].includes(current?.status)) {
      if (current.due_at) assignedTimes.push(new Date(current.due_at).getTime());
      continue;
    }

    const occurrences = birthdayOccurrences(
      player.birth_month,
      player.birth_day,
      start.getUTCFullYear(),
      end.getUTCFullYear()
    );
    const inside = occurrences.find((date) => date >= start && date <= end);
    const nearest = occurrences.reduce((best, date) => {
      const distance = date < start ? start - date : date > end ? date - end : 0;
      return !best || distance < best.distance ? { date, distance } : best;
    }, null).date;
    let selectedEvent = inside
      ? (events || []).find((event) => new Date(event.starts_at) >= inside) || null
      : null;
    if (!selectedEvent) selectedEvent = chooseLargestGapEvent(events || [], assignedTimes, start, end);
    if (selectedEvent) assignedTimes.push(new Date(selectedEvent.starts_at).getTime());

    plans.push({
      current,
      player,
      triggerDate: (inside || nearest).toISOString().slice(0, 10),
      selectedEvent,
      note: inside
        ? 'Scheduled on the first eligible full-team event on or after the birthday.'
        : 'Birthday is outside the season; scheduled into the largest available gap.'
    });
  }

  for (const plan of plans) {
    const values = {
      player_id: plan.player.id,
      season_id: season.id,
      obligation_type_id: typeResult.data.id,
      trigger_date: plan.triggerDate,
      scheduled_event_id: plan.selectedEvent?.id || null,
      due_at: plan.selectedEvent?.starts_at || null,
      status: 'planned',
      schedule_mode: 'automatic',
      scheduling_note: plan.selectedEvent ? plan.note : 'No eligible full-team event is available.',
      updated_by: userId
    };
    let obligation;
    if (plan.current) {
      const result = await supabase
        .from('player_obligations')
        .update(values)
        .eq('id', plan.current.id)
        .select('id')
        .single();
      if (result.error) throw result.error;
      obligation = result.data;
    } else {
      const result = await supabase
        .from('player_obligations')
        .insert({ ...values, created_by: userId })
        .select('id')
        .single();
      if (result.error) throw result.error;
      obligation = result.data;
    }

    const { error: logError } = await supabase.from('obligation_events').insert({
      obligation_id: obligation.id,
      event_type: plan.current ? 'rescheduled' : 'created',
      from_event_id: plan.current?.scheduled_event_id || null,
      to_event_id: plan.selectedEvent?.id || null,
      old_due_at: plan.current?.due_at || null,
      new_due_at: plan.selectedEvent?.starts_at || null,
      note: plan.note,
      created_by: userId
    });
    if (logError) throw logError;
  }

  return plans.length;
}

async function scheduleNewArrivals(supabase, userId, season) {
  const [{ data: players, error: playersError }, { data: events, error: eventsError }, typeResult] = await Promise.all([
    supabase
      .from('players')
      .select('id, name, joined_on')
      .eq('active', true)
      .gte('joined_on', season.start_date)
      .lte('joined_on', season.end_date),
    supabase
      .from('team_events')
      .select('id, starts_at')
      .eq('season_id', season.id)
      .eq('status', 'scheduled')
      .eq('attendance_scope', 'full_team')
      .in('event_type', ['practice', 'match'])
      .order('starts_at', { ascending: true }),
    supabase.from('obligation_types').select('id').eq('code', 'new-arrival-beer').single()
  ]);
  if (playersError) throw playersError;
  if (eventsError) throw eventsError;
  if (typeResult.error) throw typeResult.error;

  const { data: existing, error: existingError } = await supabase
    .from('player_obligations')
    .select('id, player_id, status, schedule_mode, scheduled_event_id, due_at')
    .eq('season_id', season.id)
    .eq('obligation_type_id', typeResult.data.id);
  if (existingError) throw existingError;
  const existingByPlayer = new Map((existing || []).map((item) => [item.player_id, item]));
  let changed = 0;

  for (const player of players || []) {
    const current = existingByPlayer.get(player.id);
    if (current?.schedule_mode === 'manual' || ['fulfilled', 'cancelled', 'waived'].includes(current?.status)) continue;
    const joinedAt = dateOnly(player.joined_on);
    const selectedEvent = (events || []).find((event) => new Date(event.starts_at) >= joinedAt) || null;
    const values = {
      player_id: player.id,
      season_id: season.id,
      obligation_type_id: typeResult.data.id,
      trigger_date: player.joined_on,
      scheduled_event_id: selectedEvent?.id || null,
      due_at: selectedEvent?.starts_at || null,
      status: 'planned',
      schedule_mode: 'automatic',
      scheduling_note: selectedEvent
        ? 'Scheduled on the first full-team event on or after joining.'
        : 'No eligible full-team event is available after the joining date.',
      updated_by: userId
    };
    const result = current
      ? await supabase.from('player_obligations').update(values).eq('id', current.id).select('id').single()
      : await supabase.from('player_obligations').insert({ ...values, created_by: userId }).select('id').single();
    if (result.error) throw result.error;
    const { error: logError } = await supabase.from('obligation_events').insert({
      obligation_id: result.data.id,
      event_type: current ? 'rescheduled' : 'created',
      from_event_id: current?.scheduled_event_id || null,
      to_event_id: selectedEvent?.id || null,
      old_due_at: current?.due_at || null,
      new_due_at: selectedEvent?.starts_at || null,
      note: values.scheduling_note,
      created_by: userId
    });
    if (logError) throw logError;
    changed += 1;
  }
  return changed;
}

module.exports = {
  birthdayOccurrences,
  chooseLargestGapEvent,
  scheduleBirthdays,
  scheduleNewArrivals
};
