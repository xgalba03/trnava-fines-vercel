const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');

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

function selectColumns(includeAuditFields = false) {
  const columns = [
    'id',
    'player_id',
    'fine_type_id',
    'name',
    'description',
    'amount',
    'occurred_at',
    'type',
    'source',
    'quantity',
    'unit_name_snapshot',
    'is_match_day',
    'multiplier_applied',
    'calculated_amount',
    'amount_overridden',
    'obligation_id',
    'objection_id',
    'objection:objections!objections_fine_id_fkey(status)',
    'note',
    'created_at',
    'player:players(name)',
    'fine_type:fine_types(code, name)'
  ];
  if (includeAuditFields) columns.push('voided_at', 'void_reason', 'metadata', 'updated_at');
  return columns.join(', ');
}

async function readFines(supabase, includeAuditFields = false) {
  const { data: fines, error } = await supabase
    .from('fines')
    .select(selectColumns(includeAuditFields))
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return fines;
}

module.exports = async function handler(request, response) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (request.method === 'GET') {
      let supabase = getClient(process.env.SUPABASE_ANON_KEY);
      let includeAuditFields = false;
      if (token) {
        supabase = getClient(process.env.SUPABASE_ANON_KEY, token);
        const { data: userData, error: userError } = await supabase.auth.getUser(token);
        const user = userData?.user;
        if (userError || !user) return response.status(401).json({ error: 'Your session has expired.' });
        if (!process.env.ADMIN_EMAIL || user.email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
          return response.status(403).json({ error: 'Only the configured admin can view audit history.' });
        }
        includeAuditFields = true;
      }
      const fines = await readFines(supabase, includeAuditFields);
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
      action: actionValue,
      fine_id: fineIdValue,
      player_id: playerIdValue,
      fine_type_id: fineTypeIdValue,
      quantity: quantityValue,
      is_match_day: isMatchDayValue,
      amount: amountValue,
      note: noteValue,
      occurred_at: occurredAtValue
    } = request.body || {};
    const action = String(actionValue || 'create');
    const fineId = Number(fineIdValue);

    if (action === 'void') {
      const reason = String(request.body?.reason || '').trim() || 'No reason provided.';
      if (!Number.isSafeInteger(fineId) || fineId <= 0) {
        return response.status(400).json({ error: 'Choose a fine to void.' });
      }
      if (reason.length > 500) {
        return response.status(400).json({ error: 'The void reason cannot exceed 500 characters.' });
      }
      const { data: existingFine, error: existingError } = await supabase
        .from('fines')
        .select('id, objection_id, voided_at')
        .eq('id', fineId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingFine) return response.status(404).json({ error: 'Fine not found.' });
      if (existingFine.voided_at) return response.status(409).json({ error: 'This fine is already voided.' });
      if (existingFine.objection_id) {
        return response.status(409).json({ error: 'Use the objection decision to change a fine linked to an objection.' });
      }
      const { error: voidError } = await supabase
        .from('fines')
        .update({
          voided_at: new Date().toISOString(),
          voided_by: user.id,
          void_reason: reason,
          updated_by: user.id
        })
        .eq('id', fineId)
        .is('voided_at', null);
      if (voidError) throw voidError;
      return response.status(200).json({
        message: 'Fine voided. The original record was kept.'
      });
    }

    if (!['create', 'update'].includes(action)) {
      return response.status(400).json({ error: 'Unsupported fine action.' });
    }
    if (action === 'update' && (!Number.isSafeInteger(fineId) || fineId <= 0)) {
      return response.status(400).json({ error: 'Choose a fine to edit.' });
    }

    let existingFine = null;
    if (action === 'update') {
      const { data, error: existingError } = await supabase
        .from('fines')
        .select([
          'id', 'type', 'source', 'objection_id', 'voided_at', 'player_id',
          'fine_type_id', 'name', 'description', 'amount', 'occurred_at',
          'quantity', 'is_match_day', 'note', 'calculated_amount',
          'amount_overridden', 'metadata'
        ].join(', '))
        .eq('id', fineId)
        .maybeSingle();
      if (existingError) throw existingError;
      existingFine = data;
      if (!existingFine) return response.status(404).json({ error: 'Fine not found.' });
      if (existingFine.voided_at) return response.status(409).json({ error: 'A voided fine cannot be edited.' });
      if (existingFine.type !== 'normal' || existingFine.source !== 'manual') {
        return response.status(400).json({ error: 'Only manually entered fines can be edited.' });
      }
      if (existingFine.objection_id) {
        return response.status(409).json({ error: 'A fine linked to an objection cannot be edited.' });
      }
    }
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

    const isPerUnit = fineType.calculation_mode === 'per_unit';
    const requestedQuantity = Number(quantityValue || 1);
    const quantity = isPerUnit ? requestedQuantity : 1;
    const batchCount = isPerUnit ? 1 : requestedQuantity;
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0
      || (isPerUnit && requestedQuantity > 10000)
      || (!isPerUnit && (!Number.isSafeInteger(requestedQuantity) || requestedQuantity > 100))) {
      return response.status(400).json({
        error: isPerUnit
          ? `Enter a positive number of ${fineType.unit_name || 'units'}.`
          : 'Enter a whole-number quantity from 1 to 100.'
      });
    }
    if (action === 'update' && !isPerUnit && requestedQuantity !== 1) {
      return response.status(400).json({
        error: 'A fixed fine is stored as one event. Edit this event with quantity 1, or add more separate fines.'
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

    const fineValues = {
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
      };

    if (action === 'update') {
      const currentMetadata = existingFine.metadata && typeof existingFine.metadata === 'object'
        ? existingFine.metadata
        : {};
      const editHistory = Array.isArray(currentMetadata.edit_history)
        ? currentMetadata.edit_history
        : [];
      const metadata = {
        ...currentMetadata,
        edit_history: [...editHistory, {
          edited_at: new Date().toISOString(),
          edited_by: user.id,
          previous: {
            player_id: existingFine.player_id,
            fine_type_id: existingFine.fine_type_id,
            name: existingFine.name,
            description: existingFine.description,
            amount: existingFine.amount,
            occurred_at: existingFine.occurred_at,
            quantity: existingFine.quantity,
            is_match_day: existingFine.is_match_day,
            note: existingFine.note,
            calculated_amount: existingFine.calculated_amount,
            amount_overridden: existingFine.amount_overridden
          }
        }]
      };
      const { error: updateError } = await supabase
        .from('fines')
        .update({ ...fineValues, metadata, updated_by: user.id })
        .eq('id', fineId)
        .is('voided_at', null);
      if (updateError) throw updateError;
      return response.status(200).json({ message: 'Fine updated.' });
    }

    fineValues.user_id = user.id;
    let insertValues = fineValues;
    if (batchCount > 1) {
      const batchId = randomUUID();
      insertValues = Array.from({ length: batchCount }, (_, index) => ({
        ...fineValues,
        metadata: {
          batch_id: batchId,
          batch_size: batchCount,
          batch_index: index + 1
        }
      }));
    }
    const { error: insertError } = await supabase
      .from('fines')
      .insert(insertValues);
    if (insertError) {
      if (insertError.code === '42501') {
        throw new Error('Database permissions are not configured for player fines. Run database/002-players-and-fine-events.sql in Supabase.');
      }
      throw insertError;
    }

    return response.status(200).json({ message: 'Fine added.' });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Database request failed.' });
  }
};
