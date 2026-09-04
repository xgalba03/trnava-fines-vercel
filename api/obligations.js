const { createSupabaseClient, requireAdmin } = require('./_lib/supabase');

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${field} is required.`);
  return id;
}

async function listObligations(supabase) {
  const { data, error } = await supabase
    .from('player_obligations')
    .select([
      'id', 'player_id', 'season_id', 'obligation_type_id', 'trigger_date',
      'scheduled_event_id', 'due_at', 'status', 'schedule_mode', 'scheduling_note',
      'fulfilled_at', 'fulfilled_note', 'created_at', 'updated_at',
      'player:players(id, name)',
      'obligation_type:obligation_types(id, code, name, item_name, daily_penalty_amount)',
      'event:team_events(id, code, name, starts_at, attendance_scope, status)'
    ].join(', '))
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

async function obligationPayload(supabase) {
  const [obligations, typesResult] = await Promise.all([
    listObligations(supabase),
    supabase
      .from('obligation_types')
      .select('id, code, name, item_name, recurrence, daily_penalty_amount, active')
      .eq('active', true)
      .order('name', { ascending: true })
  ]);
  if (typesResult.error) throw typesResult.error;
  return { obligations, obligationTypes: typesResult.data || [] };
}

async function eligibleEvent(supabase, eventId) {
  if (!eventId) return null;
  const { data, error } = await supabase
    .from('team_events')
    .select('id, season_id, starts_at, status, attendance_scope, event_type')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'scheduled' || data.attendance_scope !== 'full_team'
    || !['practice', 'match'].includes(data.event_type)) {
    throw new Error('Obligations can only be assigned to a scheduled full-team practice or match.');
  }
  return data;
}

async function logChange(supabase, values) {
  const { error } = await supabase.from('obligation_events').insert(values);
  if (error) throw error;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const supabase = createSupabaseClient();
      return response.status(200).json(await obligationPayload(supabase));
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const { supabase, user } = auth;
    const body = request.body || {};
    const action = String(body.action || 'create');

    if (action === 'create' || action === 'update') {
      const playerId = positiveId(body.player_id, 'Player');
      const typeId = positiveId(body.obligation_type_id, 'Obligation type');
      const eventId = body.scheduled_event_id ? positiveId(body.scheduled_event_id, 'Event') : null;
      const event = await eligibleEvent(supabase, eventId);
      const seasonId = body.season_id ? positiveId(body.season_id, 'Season') : event?.season_id;
      if (!seasonId) return response.status(400).json({ error: 'A season or scheduled event is required.' });
      const triggerDate = body.trigger_date || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(triggerDate)) {
        return response.status(400).json({ error: 'Enter a valid trigger date.' });
      }
      const values = {
        player_id: playerId,
        season_id: seasonId,
        obligation_type_id: typeId,
        trigger_date: triggerDate,
        scheduled_event_id: event?.id || null,
        due_at: event?.starts_at || (body.due_at ? new Date(body.due_at).toISOString() : null),
        status: 'planned',
        schedule_mode: 'manual',
        scheduling_note: String(body.note || '').trim() || 'Created manually by administrator.',
        updated_by: user.id
      };
      let previous = null;
      let result;
      if (action === 'update') {
        const obligationId = positiveId(body.obligation_id, 'Obligation');
        const previousResult = await supabase
          .from('player_obligations')
          .select('id, scheduled_event_id, due_at')
          .eq('id', obligationId)
          .maybeSingle();
        if (previousResult.error) throw previousResult.error;
        if (!previousResult.data) return response.status(404).json({ error: 'Obligation not found.' });
        previous = previousResult.data;
        result = await supabase
          .from('player_obligations')
          .update(values)
          .eq('id', obligationId)
          .select('id, scheduled_event_id, due_at')
          .single();
      } else {
        result = await supabase
          .from('player_obligations')
          .insert({ ...values, created_by: user.id })
          .select('id, scheduled_event_id, due_at')
          .single();
      }
      const { data, error } = result;
      if (error) throw error;
      await logChange(supabase, {
        obligation_id: data.id,
        event_type: action === 'create' ? 'created' : 'rescheduled',
        from_event_id: previous?.scheduled_event_id || null,
        to_event_id: data.scheduled_event_id,
        old_due_at: previous?.due_at || null,
        new_due_at: data.due_at,
        note: String(body.note || '').trim() || `${action === 'create' ? 'Created' : 'Edited'} manually by administrator.`,
        created_by: user.id
      });
      return response.status(action === 'create' ? 201 : 200).json(await obligationPayload(supabase));
    }

    const obligationId = positiveId(body.obligation_id, 'Obligation');
    const { data: current, error: currentError } = await supabase
      .from('player_obligations')
      .select('id, status, scheduled_event_id, due_at')
      .eq('id', obligationId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return response.status(404).json({ error: 'Obligation not found.' });
    const note = String(body.note || '').trim() || null;
    let values;
    let eventType;

    if (action === 'fulfill') {
      values = { status: 'fulfilled', fulfilled_at: new Date().toISOString(), fulfilled_note: note, updated_by: user.id };
      eventType = 'fulfilled';
    } else if (action === 'cancel') {
      if (!note) return response.status(400).json({ error: 'A cancellation reason is required.' });
      values = { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: user.id, cancellation_reason: note, updated_by: user.id };
      eventType = 'cancelled';
    } else if (action === 'waive') {
      if (!note) return response.status(400).json({ error: 'A waiver reason is required.' });
      values = { status: 'waived', waived_at: new Date().toISOString(), waived_by: user.id, waiver_reason: note, updated_by: user.id };
      eventType = 'waived';
    } else if (action === 'reopen') {
      values = {
        status: 'planned', fulfilled_at: null, fulfilled_note: null, cancelled_at: null,
        cancelled_by: null, cancellation_reason: null, waived_at: null, waived_by: null,
        waiver_reason: null, updated_by: user.id
      };
      eventType = 'reopened';
    } else if (action === 'reschedule') {
      const eventId = positiveId(body.scheduled_event_id, 'Event');
      const event = await eligibleEvent(supabase, eventId);
      values = {
        scheduled_event_id: event.id,
        due_at: event.starts_at,
        season_id: event.season_id,
        status: 'planned',
        schedule_mode: 'manual',
        scheduling_note: note || 'Rescheduled manually by administrator.',
        updated_by: user.id
      };
      eventType = 'rescheduled';
    } else {
      return response.status(400).json({ error: 'Unknown obligation action.' });
    }

    const { error } = await supabase.from('player_obligations').update(values).eq('id', obligationId);
    if (error) throw error;
    await logChange(supabase, {
      obligation_id: obligationId,
      event_type: eventType,
      from_event_id: current.scheduled_event_id,
      to_event_id: values.scheduled_event_id ?? current.scheduled_event_id,
      old_due_at: current.due_at,
      new_due_at: values.due_at ?? current.due_at,
      note,
      created_by: user.id
    });
    return response.status(200).json(await obligationPayload(supabase));
  } catch (error) {
    console.error(error);
    const status = /required|valid|only be assigned/i.test(error.message || '') ? 400 : 500;
    return response.status(status).json({ error: error.message || 'Unable to manage obligations.' });
  }
};
