const { createServiceClient, requireAdmin } = require('./_lib/supabase');
const { scheduleBirthdays, scheduleNewArrivals } = require('./_lib/birthday-scheduler');
const playersSeed = require('../seed/players.json');
const fineTypesSeed = require('../seed/fine-types.json');
const birthdaysSeed = require('../seed/birthdays.json');
const obligationTypesSeed = require('../seed/obligation-types.json');
const eventsSeed = require('../seed/team-events.json');

function playerKey(name) {
  return String(name || '').trim().toLocaleLowerCase('sk');
}

async function syncPlayers(supabase, userId) {
  const { data: existing, error } = await supabase.from('players').select('id, name');
  if (error) throw error;
  const byName = new Map((existing || []).map((player) => [playerKey(player.name), player]));
  for (const player of playersSeed.players) {
    const values = {
      name: player.name.trim(),
      jersey_number: player.jerseyNumber,
      active: player.active,
      updated_by: userId
    };
    if (Object.hasOwn(player, 'joinedOn')) values.joined_on = player.joinedOn;
    if (Object.hasOwn(player, 'leftOn')) values.left_on = player.leftOn;
    const current = byName.get(playerKey(player.name));
    const result = current
      ? await supabase.from('players').update(values).eq('id', current.id)
      : await supabase.from('players').insert({ ...values, created_by: userId });
    if (result.error) throw result.error;
  }
  const { data: refreshed, error: refreshError } = await supabase.from('players').select('id, name');
  if (refreshError) throw refreshError;
  return new Map((refreshed || []).map((player) => [playerKey(player.name), player]));
}

async function syncFineTypes(supabase, userId) {
  const rows = fineTypesSeed.fineTypes.map((type) => ({
    code: type.code,
    name: type.name,
    description: type.description,
    calculation_mode: type.calculationMode,
    default_amount: type.defaultAmount,
    unit_name: type.unitName,
    match_day_only: type.matchDayOnly,
    double_on_match_day: type.doubleOnMatchDay,
    match_day_multiplier: type.matchDayMultiplier,
    category: type.category,
    active: type.active,
    system_managed: false,
    updated_by: userId
  }));
  const { error } = await supabase.from('fine_types').upsert(rows, { onConflict: 'code' });
  if (error) throw error;
  return rows.length;
}

async function syncObligationTypes(supabase) {
  const rows = obligationTypesSeed.obligationTypes.map((type) => ({
    code: type.code,
    name: type.name,
    description: type.description,
    item_name: type.itemName,
    recurrence: type.recurrence,
    daily_penalty_amount: type.dailyPenaltyAmount,
    active: type.active
  }));
  const { error } = await supabase.from('obligation_types').upsert(rows, { onConflict: 'code' });
  if (error) throw error;
  return rows.length;
}

async function syncBirthdays(supabase, playersByName, userId) {
  for (const birthday of birthdaysSeed.birthdays) {
    const player = playersByName.get(playerKey(birthday.playerName));
    if (!player) throw new Error(`Birthday references unknown player: ${birthday.playerName}.`);
    const { error } = await supabase.from('players').update({
      birth_month: birthday.month,
      birth_day: birthday.day,
      updated_by: userId
    }).eq('id', player.id);
    if (error) throw error;
  }
  return birthdaysSeed.birthdays.filter((birthday) => birthday.month && birthday.day).length;
}

async function syncCalendar(supabase, playersByName, userId) {
  if (!eventsSeed.season) return { season: null, events: 0 };
  const seasonValues = {
    name: eventsSeed.season.name,
    start_date: eventsSeed.season.startDate,
    end_date: eventsSeed.season.endDate,
    active: eventsSeed.season.active !== false
  };
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .upsert(seasonValues, { onConflict: 'name' })
    .select('id, name, start_date, end_date')
    .single();
  if (seasonError) throw seasonError;

  for (const event of eventsSeed.events) {
    const values = {
      season_id: season.id,
      code: event.code,
      name: event.name,
      event_type: event.type,
      starts_at: new Date(event.startsAt).toISOString(),
      ends_at: event.endsAt ? new Date(event.endsAt).toISOString() : null,
      attendance_scope: event.attendanceScope,
      status: event.status,
      location: String(event.location || '').trim() || null,
      notes: String(event.notes || '').trim() || null,
      created_by: userId,
      updated_by: userId
    };
    const { data: saved, error } = await supabase
      .from('team_events')
      .upsert(values, { onConflict: 'code' })
      .select('id')
      .single();
    if (error) throw error;
    const { error: deleteError } = await supabase.from('team_event_players').delete().eq('event_id', saved.id);
    if (deleteError) throw deleteError;
    if (event.attendanceScope === 'partial_team') {
      const participantRows = event.playerNames.map((name) => {
        const player = playersByName.get(playerKey(name));
        if (!player) throw new Error(`Event ${event.code} references unknown player: ${name}.`);
        return { event_id: saved.id, player_id: player.id };
      });
      const { error: participantError } = await supabase.from('team_event_players').insert(participantRows);
      if (participantError) throw participantError;
    }
  }
  return { season, events: eventsSeed.events.length };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });

    // The service client is used only after admin verification. This makes the
    // version-controlled import atomic from the app's point of view even when
    // table grants intentionally expose only a subset of columns to the browser.
    const supabase = createServiceClient();
    const playersByName = await syncPlayers(supabase, auth.user.id);
    const fineTypes = await syncFineTypes(supabase, auth.user.id);
    const obligationTypes = await syncObligationTypes(supabase);
    const birthdays = await syncBirthdays(supabase, playersByName, auth.user.id);
    const calendar = await syncCalendar(supabase, playersByName, auth.user.id);
    const birthdayObligations = calendar.season
      ? await scheduleBirthdays(supabase, auth.user.id, calendar.season)
      : 0;
    const newArrivalObligations = calendar.season
      ? await scheduleNewArrivals(supabase, auth.user.id, calendar.season)
      : 0;

    return response.status(200).json({
      message: 'Seed files were synced to Supabase.',
      counts: {
        players: playersSeed.players.length,
        fineTypes,
        obligationTypes,
        birthdays,
        events: calendar.events,
        birthdayObligations,
        newArrivalObligations
      }
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to sync seed files.' });
  }
};
