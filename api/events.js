const { createSupabaseClient, requireAdmin } = require('./_lib/supabase');

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Pole ${field} je povinné.`);
  return id;
}

async function listEvents(supabase) {
  const { data, error } = await supabase
    .from('team_events')
    .select([
      'id', 'season_id', 'code', 'name', 'event_type', 'starts_at', 'ends_at',
      'recurrence_code', 'scheduled_date', 'attendance_scope', 'status',
      'location', 'notes', 'cancellation_reason', 'cancelled_at',
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
      return response.status(405).json({ error: 'Táto metóda nie je povolená.' });
    }

    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const { supabase, user } = auth;
    const body = request.body || {};
    const action = String(body.action || 'save');

    if (action === 'cancel') {
      const eventId = positiveId(body.event_id, 'udalosť');
      const cancellationReason = cleanText(body.cancellation_reason) || 'Zrušené správcom.';
      const { error } = await supabase
        .from('team_events')
        .update({
          status: 'cancelled',
          cancellation_reason: cancellationReason,
          cancelled_at: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', eventId);
      if (error) throw error;
      return response.status(200).json(await eventPayload(supabase));
    }

    if (action !== 'save') return response.status(400).json({ error: 'Neznáma akcia udalosti.' });
    const eventId = body.event_id ? positiveId(body.event_id, 'udalosť') : null;
    const seasonId = positiveId(body.season_id, 'sezóna');
    const code = cleanText(body.code);
    const name = cleanText(body.name);
    const eventType = String(body.event_type || 'practice');
    const attendanceScope = String(body.attendance_scope || 'full_team');
    const eventStatus = String(body.status || 'scheduled');
    const startsAt = new Date(body.starts_at);
    const endsAt = body.ends_at ? new Date(body.ends_at) : null;
    if (!code || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
      return response.status(400).json({ error: 'Použite stály kód udalosti s malými písmenami a spojovníkmi.' });
    }
    if (!name) return response.status(400).json({ error: 'Názov udalosti je povinný.' });
    if (!['practice', 'match', 'team_dinner', 'other'].includes(eventType)) {
      return response.status(400).json({ error: 'Neplatný typ udalosti.' });
    }
    if (!['full_team', 'partial_team'].includes(attendanceScope)) {
      return response.status(400).json({ error: 'Neplatný rozsah účasti.' });
    }
    if (!['scheduled', 'cancelled', 'completed'].includes(eventStatus)) {
      return response.status(400).json({ error: 'Neplatný stav udalosti.' });
    }
    if (Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) {
      return response.status(400).json({ error: 'Zadajte platný začiatok a voliteľný neskorší koniec udalosti.' });
    }

    const playerIds = [...new Set((body.player_ids || []).map(Number))];
    if (playerIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return response.status(400).json({ error: 'Neplatný zoznam hráčov udalosti.' });
    }
    if (attendanceScope === 'partial_team' && !playerIds.length) {
      return response.status(400).json({ error: 'Pre udalosť časti tímu vyberte aspoň jedného hráča.' });
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
      cancellation_reason: eventStatus === 'cancelled'
        ? (cleanText(body.cancellation_reason) || 'Zrušené správcom.')
        : null,
      cancelled_at: eventStatus === 'cancelled' ? new Date().toISOString() : null,
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
    return response.status(500).json({ error: error.message || 'Tímové udalosti sa nepodarilo spravovať.' });
  }
};
