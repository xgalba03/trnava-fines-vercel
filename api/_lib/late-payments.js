const { dateRangeAfter, localDateString } = require('./dates');

const TIME_ZONE = 'Europe/Bratislava';
const monthFormatter = new Intl.DateTimeFormat('en', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit'
});

function occurrencePeriod(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    monthFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function belongsToPeriod(item, period) {
  if (item.monthly_period_id !== null && item.monthly_period_id !== undefined) {
    return Number(item.monthly_period_id) === Number(period.id);
  }
  return occurrencePeriod(item.occurred_at) === String(period.period_month).slice(0, 7);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildLatePaymentRows({
  periods, players, fines, adjustments, payments, fineType, amount, today
}) {
  const rows = [];
  const existingKeys = new Set((fines || []).map((fine) => fine.idempotency_key).filter(Boolean));
  const fallbackUserId = (fines || []).find((fine) => fine.user_id)?.user_id || null;

  for (const period of periods || []) {
    const periodMonth = String(period.period_month).slice(0, 7);
    const chargeDates = dateRangeAfter(period.payment_deadline, today);
    if (!chargeDates.length) continue;

    for (const player of players || []) {
      const playerFines = (fines || []).filter((fine) => (
        Number(fine.player_id) === Number(player.id) && belongsToPeriod(fine, period)
      ));
      const ordinaryCharges = playerFines
        .filter((fine) => fine.type !== 'late_payment')
        .reduce((sum, fine) => sum + Number(fine.amount), 0);
      const existingLateFines = new Map(playerFines
        .filter((fine) => fine.type === 'late_payment' && fine.idempotency_key)
        .map((fine) => [fine.idempotency_key, fine]));
      const signedAdjustments = (adjustments || [])
        .filter((adjustment) => (
          Number(adjustment.player_id) === Number(player.id) && belongsToPeriod(adjustment, period)
        ))
        .reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
      const periodPayments = (payments || [])
        .filter((payment) => (
          Number(payment.player_id) === Number(player.id)
          && String(payment.period_month).slice(0, 7) === periodMonth
        ));
      if (ordinaryCharges + signedAdjustments <= 0 && existingLateFines.size === 0) continue;

      const userId = playerFines.find((fine) => fine.user_id)?.user_id || fallbackUserId;
      if (!userId) continue;
      let lateCharges = 0;
      for (const chargeDate of chargeDates) {
        const idempotencyKey = `late-payment:${period.id}:${player.id}:${chargeDate}`;
        const existingLateFine = existingLateFines.get(idempotencyKey);
        if (existingLateFine) {
          lateCharges = roundMoney(lateCharges + Number(existingLateFine.amount));
          continue;
        }
        const paidBeforeDate = periodPayments
          .filter((payment) => localDateString(new Date(payment.paid_at)) < chargeDate)
          .reduce((sum, payment) => sum + Number(payment.amount), 0);
        const outstandingAtStartOfDay = roundMoney(
          ordinaryCharges + signedAdjustments + lateCharges - paidBeforeDate
        );
        if (outstandingAtStartOfDay <= 0 || existingKeys.has(idempotencyKey)) continue;
        rows.push({
          user_id: userId,
          player_id: player.id,
          season_id: period.season_id,
          monthly_period_id: period.id,
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
          note: `Automatic daily penalty for overdue ${periodMonth} settlement.`,
          occurred_at: `${chargeDate}T12:00:00Z`,
          type: 'late_payment',
          source: 'automatic',
          idempotency_key: idempotencyKey,
          metadata: {
            settlement_period_month: period.period_month,
            payment_deadline: period.payment_deadline
          }
        });
        lateCharges = roundMoney(lateCharges + amount);
        existingKeys.add(idempotencyKey);
      }
    }
  }
  return rows;
}

async function processLatePayments(supabase, today, settings) {
  if (!settings.latePenaltiesEnabled) return { generated: 0, disabled: true };
  const amount = Number(settings.dailyLatePaymentFine);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('The daily late-payment fine setting must be positive.');
  }

  const [periodsResult, playersResult, finesResult, adjustmentsResult, paymentsResult, fineTypeResult] = await Promise.all([
    supabase.from('monthly_periods')
      .select('id, season_id, period_month, payment_deadline')
      .not('payment_deadline', 'is', null)
      .lt('payment_deadline', today),
    supabase.from('players').select('id').eq('active', true),
    supabase.from('fines')
      .select('user_id, player_id, monthly_period_id, amount, occurred_at, type, idempotency_key')
      .is('voided_at', null),
    supabase.from('financial_adjustments')
      .select('player_id, monthly_period_id, amount, occurred_at'),
    supabase.from('payments')
      .select('player_id, period_month, amount, paid_at')
      .is('reversed_at', null),
    supabase.from('fine_types')
      .select('id, name, description, category')
      .eq('code', 'late-payment')
      .eq('active', true)
      .single()
  ]);
  const error = periodsResult.error || playersResult.error || finesResult.error
    || adjustmentsResult.error || paymentsResult.error || fineTypeResult.error;
  if (error) throw error;

  const rows = buildLatePaymentRows({
    periods: periodsResult.data,
    players: playersResult.data,
    fines: finesResult.data,
    adjustments: adjustmentsResult.data,
    payments: paymentsResult.data,
    fineType: fineTypeResult.data,
    amount,
    today
  });
  if (rows.length) {
    const { error: insertError } = await supabase
      .from('fines')
      .upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (insertError) throw insertError;
  }
  return { generated: rows.length, disabled: false };
}

module.exports = { belongsToPeriod, buildLatePaymentRows, processLatePayments };
