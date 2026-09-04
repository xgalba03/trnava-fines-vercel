const { createServiceClient } = require('../_lib/supabase');
const { dateRangeAfter, localDateString } = require('../_lib/dates');

function related(value) {
  return Array.isArray(value) ? value[0] : value;
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
      return response.status(401).json({ error: 'Invalid cron authorization.' });
    }

    const supabase = createServiceClient();
    const today = localDateString();
    const { data: obligations, error } = await supabase
      .from('player_obligations')
      .select([
        'id', 'player_id', 'season_id', 'due_at', 'status', 'created_by',
        'obligation_type:obligation_types(code, name, daily_penalty_amount)',
        'exceptions:obligation_exceptions(custom_due_at, penalties_paused_until, penalties_waived, active, created_at)'
      ].join(', '))
      .in('status', ['planned', 'due'])
      .not('due_at', 'is', null);
    if (error) throw error;

    const { data: fineType, error: fineTypeError } = await supabase
      .from('fine_types')
      .select('id, name, description, default_amount, category, calculation_mode, unit_name, match_day_only, double_on_match_day, match_day_multiplier')
      .eq('code', 'birthday-obligation-late')
      .eq('active', true)
      .single();
    if (fineTypeError) throw fineTypeError;

    const rows = [];
    const dueIds = [];
    for (const obligation of obligations || []) {
      const type = related(obligation.obligation_type);
      const amount = Number(type?.daily_penalty_amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const activeExceptions = (obligation.exceptions || [])
        .filter((item) => item.active)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      if (activeExceptions.some((item) => item.penalties_waived)) continue;
      const latestCustomDue = activeExceptions.filter((item) => item.custom_due_at).at(-1)?.custom_due_at;
      const dueAt = latestCustomDue || obligation.due_at;
      const dueDate = localDateString(new Date(dueAt));
      const pausedUntil = activeExceptions
        .map((item) => item.penalties_paused_until)
        .filter(Boolean)
        .sort()
        .at(-1);
      const chargeDates = dateRangeAfter(dueDate, today)
        .filter((date) => !pausedUntil || date > pausedUntil);
      if (chargeDates.length) dueIds.push(obligation.id);
      for (const chargeDate of chargeDates) {
        rows.push({
          user_id: obligation.created_by,
          player_id: obligation.player_id,
          season_id: obligation.season_id,
          fine_type_id: fineType.id,
          name: fineType.name,
          description: fineType.description,
          amount,
          default_amount_snapshot: amount,
          category_snapshot: fineType.category,
          calculation_mode_snapshot: 'fixed',
          unit_name_snapshot: null,
          quantity: 1,
          is_match_day: false,
          match_day_only_snapshot: false,
          double_on_match_day_snapshot: false,
          match_day_multiplier_snapshot: 1,
          multiplier_applied: 1,
          base_amount: amount,
          calculated_amount: amount,
          amount_overridden: false,
          note: `Daily penalty for unfulfilled ${type.name}.`,
          occurred_at: `${chargeDate}T12:00:00Z`,
          type: 'obligation_penalty',
          source: 'automatic',
          obligation_id: obligation.id,
          idempotency_key: `obligation:${obligation.id}:${chargeDate}`
        });
      }
    }

    if (rows.length) {
      const { error: insertError } = await supabase
        .from('fines')
        .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (insertError) throw insertError;
    }
    if (dueIds.length) {
      const { error: dueError } = await supabase
        .from('player_obligations')
        .update({ status: 'due' })
        .in('id', [...new Set(dueIds)]);
      if (dueError) throw dueError;
    }

    return response.status(200).json({ date: today, generated: rows.length });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Daily obligation processing failed.' });
  }
};
