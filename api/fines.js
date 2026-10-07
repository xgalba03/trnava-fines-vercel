const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');

function getClient(key, token) {
  const url = process.env.SUPABASE_URL;
  if (!url || !key) {
    throw new Error('Chýba premenná prostredia Supabase.');
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
        if (userError || !user) return response.status(401).json({ error: 'Platnosť relácie vypršala.' });
        if (!process.env.ADMIN_EMAIL || user.email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
          return response.status(403).json({ error: 'Históriu zmien môže zobraziť iba nastavený správca.' });
        }
        includeAuditFields = true;
      }
      const fines = await readFines(supabase, includeAuditFields);
      return response.status(200).json({ fines });
    }

    if (request.method !== 'POST') return response.status(405).json({ error: 'Táto metóda nie je povolená.' });
    if (!token) return response.status(401).json({ error: 'Na pridanie pokuty sa musíte prihlásiť ako správca.' });
    const supabase = getClient(process.env.SUPABASE_ANON_KEY, token);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return response.status(401).json({ error: 'Platnosť relácie vypršala.' });
    if (!process.env.ADMIN_EMAIL || user.email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
      return response.status(403).json({ error: 'Pokuty môže pridávať iba nastavený správca.' });
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
      const reason = String(request.body?.reason || '').trim() || 'Dôvod nebol uvedený.';
      if (!Number.isSafeInteger(fineId) || fineId <= 0) {
        return response.status(400).json({ error: 'Vyberte pokutu, ktorú chcete zrušiť.' });
      }
      if (reason.length > 500) {
        return response.status(400).json({ error: 'Dôvod zrušenia nesmie presiahnuť 500 znakov.' });
      }
      const { data: existingFine, error: existingError } = await supabase
        .from('fines')
        .select('id, objection_id, voided_at')
        .eq('id', fineId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingFine) return response.status(404).json({ error: 'Pokuta sa nenašla.' });
      if (existingFine.voided_at) return response.status(409).json({ error: 'Táto pokuta už je zrušená.' });
      if (existingFine.objection_id) {
        return response.status(409).json({ error: 'Pokutu prepojenú s námietkou zmeňte rozhodnutím o námietke.' });
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
        message: 'Pokuta bola zrušená. Pôvodný záznam zostal zachovaný.'
      });
    }

    if (!['create', 'update'].includes(action)) {
      return response.status(400).json({ error: 'Nepodporovaná akcia s pokutou.' });
    }
    if (action === 'update' && (!Number.isSafeInteger(fineId) || fineId <= 0)) {
      return response.status(400).json({ error: 'Vyberte pokutu, ktorú chcete upraviť.' });
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
      if (!existingFine) return response.status(404).json({ error: 'Pokuta sa nenašla.' });
      if (existingFine.voided_at) return response.status(409).json({ error: 'Zrušenú pokutu nemožno upraviť.' });
      if (existingFine.type !== 'normal' || existingFine.source !== 'manual') {
        return response.status(400).json({ error: 'Upraviť možno iba manuálne zadané pokuty.' });
      }
      if (existingFine.objection_id) {
        return response.status(409).json({ error: 'Pokutu prepojenú s námietkou nemožno upraviť.' });
      }
    }
    const playerId = Number(playerIdValue);
    const fineTypeId = Number(fineTypeIdValue);
    const isMatchDay = readBoolean(isMatchDayValue);
    const cleanNote = String(noteValue || '').trim();
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return response.status(400).json({ error: 'Vyberte aktívneho hráča.' });
    }
    if (!Number.isSafeInteger(fineTypeId) || fineTypeId <= 0) {
      return response.status(400).json({ error: 'Vyberte aktívny typ pokuty.' });
    }
    if (cleanNote.length > 500) {
      return response.status(400).json({ error: 'Poznámka nesmie presiahnuť 500 znakov.' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, active')
      .eq('id', playerId)
      .maybeSingle();
    if (playerError) throw playerError;
    if (!player?.active) {
      return response.status(400).json({ error: 'Vyberte aktívneho hráča.' });
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
      return response.status(400).json({ error: 'Vyberte aktívny typ pokuty.' });
    }
    if (fineType.code === 'custom-fine' && !cleanNote) {
      return response.status(400).json({ error: 'V poznámke opíšte vlastnú pokutu.' });
    }
    if (fineType.match_day_only && !isMatchDay) {
      return response.status(400).json({ error: 'Túto pokutu možno udeliť iba v deň zápasu.' });
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
          ? `Zadajte kladný počet jednotiek (${fineType.unit_name || 'jednotky'}).`
          : 'Zadajte celé množstvo od 1 do 100.'
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
      throw new Error('Vybraný typ pokuty má neplatné nastavenie výpočtu.');
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
      return response.status(400).json({ error: 'Zadajte kladnú konečnú sumu.' });
    }

    const occurredAt = occurredAtValue ? new Date(occurredAtValue) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return response.status(400).json({ error: 'Zadajte platný dátum a čas.' });
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
      return response.status(200).json({ message: 'Pokuta bola upravená.' });
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
        throw new Error('Databázové oprávnenia pre pokuty hráčov nie sú nastavené. Spustite database/002-players-and-fine-events.sql v Supabase.');
      }
      throw insertError;
    }

    return response.status(200).json({ message: 'Pokuta bola pridaná.' });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Databázová požiadavka zlyhala.' });
  }
};
