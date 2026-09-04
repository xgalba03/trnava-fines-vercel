const { createClient } = require('@supabase/supabase-js');

function getClient(key, token) {
  const url = process.env.SUPABASE_URL;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variable.');
  }
  const options = token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {};
  return createClient(url, key, options);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function readBoolean(value) {
  return value === true || value === 'true' || value === 'on';
}

module.exports = async function handler(request, response) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (request.method === 'GET') {
      const supabase = getClient(process.env.SUPABASE_ANON_KEY);
      const { data: fines, error } = await supabase
        .from('fines')
        .select([
          'id',
          'player_id',
          'fine_type_id',
          'name',
          'description',
          'amount',
          'occurred_at',
          'type',
          'quantity',
          'unit_name_snapshot',
          'is_match_day',
          'multiplier_applied',
          'calculated_amount',
          'amount_overridden',
          'obligation_id',
          'objection_id',
          'note',
          'created_at',
          'player:players(name)',
          'fine_type:fine_types(code, name)'
        ].join(', '))
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return response.status(200).json({ fines });
    }

    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
    if (!token) return response.status(401).json({ error: 'Admin login required to add a fine.' });
    const supabase = getClient(process.env.SUPABASE_ANON_KEY, token);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return response.status(401).json({ error: 'Your session has expired.' });
    if (!process.env.ADMIN_EMAIL || user.email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
      return response.status(403).json({ error: 'Only the configured admin can add fines.' });
    }

    const {
      player_id: playerIdValue,
      fine_type_id: fineTypeIdValue,
      quantity: quantityValue,
      is_match_day: isMatchDayValue,
      amount: amountValue,
      note: noteValue,
      occurred_at: occurredAtValue
    } = request.body || {};
    const playerId = Number(playerIdValue);
    const fineTypeId = Number(fineTypeIdValue);
    const isMatchDay = readBoolean(isMatchDayValue);
    const cleanNote = String(noteValue || '').trim();
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return response.status(400).json({ error: 'Select an active player.' });
    }
    if (!Number.isSafeInteger(fineTypeId) || fineTypeId <= 0) {
      return response.status(400).json({ error: 'Select an active fine type.' });
    }
    if (cleanNote.length > 500) {
      return response.status(400).json({ error: 'The note cannot exceed 500 characters.' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, active')
      .eq('id', playerId)
      .maybeSingle();
    if (playerError) throw playerError;
    if (!player?.active) {
      return response.status(400).json({ error: 'Select an active player.' });
    }

    const { data: fineType, error: fineTypeError } = await supabase
      .from('fine_types')
      .select([
        'id',
        'code',
        'name',
        'description',
        'default_amount',
        'category',
        'calculation_mode',
        'unit_name',
        'match_day_only',
        'double_on_match_day',
        'match_day_multiplier',
        'active'
      ].join(', '))
      .eq('id', fineTypeId)
      .maybeSingle();
    if (fineTypeError) throw fineTypeError;
    if (!fineType?.active) {
      return response.status(400).json({ error: 'Select an active fine type.' });
    }
    if (fineType.code === 'custom-fine' && !cleanNote) {
      return response.status(400).json({ error: 'Describe the custom fine in the note.' });
    }
    if (fineType.match_day_only && !isMatchDay) {
      return response.status(400).json({ error: 'This fine can only be issued for a match day.' });
    }

    const quantity = fineType.calculation_mode === 'per_unit' ? Number(quantityValue) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
      return response.status(400).json({
        error: `Enter a positive number of ${fineType.unit_name || 'units'}.`
      });
    }

    const defaultAmount = Number(fineType.default_amount);
    const matchDayMultiplier = Number(fineType.match_day_multiplier);
    if (!Number.isFinite(defaultAmount) || defaultAmount <= 0
      || !Number.isFinite(matchDayMultiplier) || matchDayMultiplier < 1) {
      throw new Error('The selected fine type has an invalid calculation configuration.');
    }

    const baseAmount = roundMoney(defaultAmount * quantity);
    const multiplierApplied = isMatchDay && fineType.double_on_match_day
      ? matchDayMultiplier
      : 1;
    const calculatedAmount = roundMoney(baseAmount * multiplierApplied);
    const amount = amountValue === undefined || amountValue === ''
      ? calculatedAmount
      : Number(amountValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      return response.status(400).json({ error: 'Enter a positive final amount.' });
    }

    const occurredAt = occurredAtValue ? new Date(occurredAtValue) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return response.status(400).json({ error: 'Enter a valid date and time.' });
    }

    const { error: insertError } = await supabase
      .from('fines')
      .insert({
        user_id: user.id,
        player_id: playerId,
        fine_type_id: fineTypeId,
        name: fineType.name,
        description: fineType.description,
        amount: roundMoney(amount),
        default_amount_snapshot: defaultAmount,
        category_snapshot: fineType.category,
        calculation_mode_snapshot: fineType.calculation_mode,
        unit_name_snapshot: fineType.unit_name,
        quantity,
        is_match_day: isMatchDay,
        match_day_only_snapshot: fineType.match_day_only,
        double_on_match_day_snapshot: fineType.double_on_match_day,
        match_day_multiplier_snapshot: matchDayMultiplier,
        multiplier_applied: multiplierApplied,
        base_amount: baseAmount,
        calculated_amount: calculatedAmount,
        amount_overridden: Math.abs(amount - calculatedAmount) >= 0.005,
        note: cleanNote || null,
        occurred_at: occurredAt.toISOString(),
        type: 'normal',
        source: 'manual'
      });
    if (insertError) {
      if (insertError.code === '42501') {
        throw new Error('Database permissions are not configured for player fines. Run database/002-players-and-fine-events.sql in Supabase.');
      }
      throw insertError;
    }

    return module.exports({ method: 'GET', headers: {} }, response);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Database request failed.' });
  }
};
