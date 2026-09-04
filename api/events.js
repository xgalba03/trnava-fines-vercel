const { createSupabaseClient, requireAdmin } = require('./_lib/supabase');

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${field} is required.`);
  return id;
}

async function listEvents(supabase) {
  const { data, error } = await supabase
    .from('team_events')
    .select([
      'id', 'season_id', 'code', 'name', 'event_type', 'starts_at', 'ends_at',
      'attendance_scope', 'status', 'location', 'notes',
      'participants:team_event_players(player_id, player:players(id, name))'
    ].join(', '))
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function eventPayload(supabase) {
  const [events, seasonsResult] = await Promise.all([
    listEvents(supabase),
    supabase.from('seasons').select('id, name, start_date, end_date, active').order('start_date', { ascending: false })
  ]);
  if (seasonsResult.error) throw seasonsResult.error;
  return { events, seasons: seasonsResult.data || [] };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const supabase = createSupabaseClient();
      return response.status(200).json(await eventPayload(supabase));
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const { supabase, user } = auth;
    const body = request.body || {};
    const action = String(body.action || 'save');

    if (action === 'cancel') {
      const eventId = positiveId(body.event_id, 'Event');
      const { error } = await supabase
        .from('team_events')
        .update({ status: 'cancelled', updated_by: user.id })
        .eq('id', eventId);
      if (error) throw error;
      return response.status(200).json(await eventPayload(supabase));
    }

    if (action !== 'save') return response.status(400).json({ error: 'Unknown event action.' });
    const eventId = body.event_id ? positiveId(body.event_id, 'Event') : null;
    const seasonId = positiveId(body.season_id, 'Season');
    const code = cleanText(body.code);
    const name = cleanText(body.name);
    const eventType = String(body.event_type || 'training');
    const attendanceScope = String(body.attendance_scope || 'full_team');
    const eventStatus = String(body.status || 'scheduled');
    const startsAt = new Date(body.starts_at);
    const endsAt = body.ends_at ? new Date(body.ends_at) : null;
    if (!code || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
      return response.status(400).json({ error: 'Use a stable lowercase event code with hyphens.' });
    }
    if (!name) return response.status(400).json({ error: 'Event name is required.' });
    if (!['training', 'match', 'other'].includes(eventType)) {
      return response.status(400).json({ error: 'Invalid event type.' });
    }
    if (!['full_team', 'partial_team'].includes(attendanceScope)) {
      return response.status(400).json({ error: 'Invalid attendance scope.' });
    }
    if (!['scheduled', 'cancelled', 'completed'].includes(eventStatus)) {
      return response.status(400).json({ error: 'Invalid event status.' });
    }
    if (Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) {
      return response.status(400).json({ error: 'Enter a valid event start and optional later end.' });
    }

    const playerIds = [...new Set((body.player_ids || []).map(Number))];
    if (playerIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return response.status(400).json({ error: 'Invalid event player list.' });
    }
    if (attendanceScope === 'partial_team' && !playerIds.length) {
      return response.status(400).json({ error: 'Choose at least one player for a partial-team event.' });
    }

    const values = {
      season_id: seasonId,
      code,
      name,
      event_type: eventType,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() || null,
      attendance_scope: attendanceScope,
      status: eventStatus,
      location: cleanText(body.location),
      notes: cleanText(body.notes),
      updated_by: user.id
    };
    const result = eventId
      ? await supabase.from('team_events').update(values).eq('id', eventId).select('id').single()
      : await supabase.from('team_events').insert({ ...values, created_by: user.id }).select('id').single();
    if (result.error) throw result.error;

    const savedId = result.data.id;
    const { error: deleteError } = await supabase.from('team_event_players').delete().eq('event_id', savedId);
    if (deleteError) throw deleteError;
    if (attendanceScope === 'partial_team') {
      const { error: playersError } = await supabase
        .from('team_event_players')
        .insert(playerIds.map((playerId) => ({ event_id: savedId, player_id: playerId })));
      if (playersError) throw playersError;
    }

    return response.status(eventId ? 200 : 201).json(await eventPayload(supabase));
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to manage team events.' });
  }
};
