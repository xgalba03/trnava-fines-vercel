const { randomUUID } = require('node:crypto');
const { createSupabaseClient, requireAdmin } = require('./_lib/supabase');
const { localDateString } = require('./_lib/dates');
const appSettings = require('../seed/settings.json').settings;

const ACCOUNT_TIME_ZONE = 'Europe/Bratislava';
const periodFormatter = new Intl.DateTimeFormat('en', {
  timeZone: ACCOUNT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit'
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function currentPeriod() {
  const parts = Object.fromEntries(
    periodFormatter.formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function occurrencePeriod(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    periodFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function transactionPeriod(item) {
  const relatedPeriod = Array.isArray(item.monthly_period)
    ? item.monthly_period[0]
    : item.monthly_period;
  return relatedPeriod?.period_month
    ? String(relatedPeriod.period_month).slice(0, 7)
    : occurrencePeriod(item.occurred_at);
}

function parsePeriod(value) {
  const period = String(value || currentPeriod()).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  return period;
}

function parseDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

function addDays(date, numberOfDays) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + numberOfDays);
  return result.toISOString().slice(0, 10);
}

function findSeason(seasons, period) {
  const periodStart = `${period}-01`;
  const monthEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0))
    .toISOString().slice(0, 10);
  return (seasons || []).find((item) => (
    item.start_date <= monthEnd && (!item.end_date || item.end_date >= periodStart)
  )) || null;
}

function addSettlementStatuses(balances, monthlyPeriod, exceptions = [], today = localDateString()) {
  return balances.map((balance) => {
    const exception = exceptions.find((item) => (
      item.active && Number(item.player_id) === Number(balance.player_id)
    )) || null;
    const hasActivity = balance.opening_balance !== 0 || balance.charges !== 0
      || balance.adjustments !== 0 || balance.paid !== 0;
    const effectiveDeadline = exception?.custom_deadline || monthlyPeriod?.payment_deadline || null;
    let settlementStatus = 'due';
    if (!hasActivity) settlementStatus = 'no_balance';
    else if (balance.balance < 0) settlementStatus = 'credit';
    else if (balance.balance === 0) settlementStatus = 'settled';
    else if (exception?.penalties_waived) settlementStatus = 'waived';
    else if (exception?.penalties_paused_until && today <= exception.penalties_paused_until) {
      settlementStatus = 'paused';
    } else if (effectiveDeadline && today > effectiveDeadline) {
      settlementStatus = 'overdue';
    }
    return {
      ...balance,
      settlement_status: settlementStatus,
      effective_deadline: effectiveDeadline,
      exception
    };
  });
}

function readBoolean(value) {
  return value === true || value === 'true' || value === 'on';
}

function buildBalances(players, fines, adjustments, payments, period) {
  const totals = new Map((players || []).map((player) => [String(player.id), {
    player_id: player.id,
    player_name: player.name,
    opening_balance: 0,
    charges: 0,
    adjustments: 0,
    paid: 0,
    balance: 0
  }]));

  for (const fine of fines || []) {
    const finePeriod = transactionPeriod(fine);
    if (!finePeriod || finePeriod > period) continue;
    const row = totals.get(String(fine.player_id));
    if (!row) continue;
    if (finePeriod < period) row.opening_balance = roundMoney(row.opening_balance + Number(fine.amount));
    else row.charges = roundMoney(row.charges + Number(fine.amount));
  }
  for (const adjustment of adjustments || []) {
    const adjustmentPeriod = transactionPeriod(adjustment);
    if (!adjustmentPeriod || adjustmentPeriod > period) continue;
    const row = totals.get(String(adjustment.player_id));
    if (!row) continue;
    if (adjustmentPeriod < period) {
      row.opening_balance = roundMoney(row.opening_balance + Number(adjustment.amount));
    } else {
      row.adjustments = roundMoney(row.adjustments + Number(adjustment.amount));
    }
  }
  for (const payment of payments || []) {
    const paymentPeriod = String(payment.period_month || '').slice(0, 7);
    if (!paymentPeriod || paymentPeriod > period) continue;
    const row = totals.get(String(payment.player_id));
    if (!row) continue;
    if (paymentPeriod < period) {
      row.opening_balance = roundMoney(row.opening_balance - Number(payment.amount));
    } else {
      row.paid = roundMoney(row.paid + Number(payment.amount));
    }
  }
  for (const row of totals.values()) {
    row.balance = roundMoney(row.opening_balance + row.charges + row.adjustments - row.paid);
  }

  return [...totals.values()].sort((left, right) => (
    right.balance - left.balance || left.player_name.localeCompare(right.player_name)
  ));
}

async function findOrCreateMonthlyPeriod(supabase, period) {
  const periodStart = `${period}-01`;
  const { data: seasons, error: seasonsError } = await supabase
    .from('seasons')
    .select('id, start_date, end_date, active')
    .order('active', { ascending: false });
  if (seasonsError) throw seasonsError;

  const season = findSeason(seasons, period);
  if (!season) return { seasonId: null, monthlyPeriodId: null };

  const { data: monthlyPeriod, error: monthlyPeriodError } = await supabase
    .from('monthly_periods')
    .upsert({ season_id: season.id, period_month: periodStart }, {
      onConflict: 'season_id,period_month'
    })
    .select('id')
    .single();
  if (monthlyPeriodError) throw monthlyPeriodError;
  return { seasonId: season.id, monthlyPeriodId: monthlyPeriod.id };
}

async function loadSnapshot(supabase, period) {
  const periodDate = `${period}-01`;
  const [
    playersResult, finesResult, adjustmentsResult, paymentsResult,
    seasonsResult, monthlyPeriodsResult, exceptionsResult
  ] = await Promise.all([
    supabase.from('players').select('id, name, active').eq('active', true).order('name'),
    supabase.from('fines')
      .select('player_id, monthly_period_id, amount, occurred_at, monthly_period:monthly_periods(period_month)'),
    supabase.from('financial_adjustments')
      .select('player_id, monthly_period_id, amount, occurred_at, monthly_period:monthly_periods(period_month)'),
    supabase.from('payments')
      .select('id, player_id, period_month, amount, currency, paid_at, created_at, reversed_at, player:players(name)')
      .is('reversed_at', null)
      .order('paid_at', { ascending: false }),
    supabase.from('seasons').select('id, start_date, end_date, active').order('active', { ascending: false }),
    supabase.from('monthly_periods')
      .select('id, season_id, period_month, club_payment_date, payment_deadline')
      .eq('period_month', periodDate),
    supabase.from('settlement_exceptions')
      .select('id, player_id, monthly_period_id, custom_deadline, penalties_paused_until, penalties_waived, active')
      .eq('active', true)
  ]);
  const error = playersResult.error || finesResult.error || adjustmentsResult.error
    || paymentsResult.error || seasonsResult.error || monthlyPeriodsResult.error
    || exceptionsResult.error;
  if (error) throw error;

  const season = findSeason(seasonsResult.data, period);
  const storedPeriod = (monthlyPeriodsResult.data || []).find((item) => item.season_id === season?.id) || null;
  const monthlyPeriod = {
    id: storedPeriod?.id || null,
    season_id: season?.id || null,
    period_month: periodDate,
    club_payment_date: storedPeriod?.club_payment_date || null,
    payment_deadline: storedPeriod?.payment_deadline || null,
    days_after_club_payment: Number(appSettings.daysAfterClubPaymentBeforeDeadline)
  };
  const balances = buildBalances(
    playersResult.data,
    finesResult.data,
    adjustmentsResult.data,
    paymentsResult.data,
    period
  );

  return {
    period,
    monthly_period: monthlyPeriod,
    balances: addSettlementStatuses(
      balances,
      monthlyPeriod,
      (exceptionsResult.data || []).filter((item) => (
        Number(item.monthly_period_id) === Number(storedPeriod?.id)
      ))
    ),
    payments: (paymentsResult.data || []).filter((payment) => (
      String(payment.period_month || '').slice(0, 7) === period
    ))
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const period = parsePeriod(request.query?.period);
      if (!period) return response.status(400).json({ error: 'Enter a valid month.' });
      const supabase = createSupabaseClient();
      return response.status(200).json(await loadSnapshot(supabase, period));
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const body = request.body || {};

    if (body.action === 'configure_period') {
      const period = parsePeriod(body.period_month);
      const clubPaymentDate = parseDate(body.club_payment_date);
      const deadlineDays = Number(appSettings.daysAfterClubPaymentBeforeDeadline);
      if (!period || !clubPaymentDate) {
        return response.status(400).json({ error: 'Choose a valid month and club payment date.' });
      }
      if (!Number.isSafeInteger(deadlineDays) || deadlineDays < 0 || deadlineDays > 365) {
        throw new Error('The configured payment deadline is invalid.');
      }

      const links = await findOrCreateMonthlyPeriod(auth.supabase, period);
      if (!links.monthlyPeriodId) {
        return response.status(400).json({ error: 'No matching season is available for this month.' });
      }
      const paymentDeadline = addDays(clubPaymentDate, deadlineDays);
      const { error: updateError } = await auth.supabase
        .from('monthly_periods')
        .update({
          club_payment_date: clubPaymentDate,
          payment_deadline: paymentDeadline
        })
        .eq('id', links.monthlyPeriodId);
      if (updateError) throw updateError;
      return response.status(200).json({
        message: `Deadline set to ${paymentDeadline}.`,
        monthly_period: {
          id: links.monthlyPeriodId,
          season_id: links.seasonId,
          period_month: `${period}-01`,
          club_payment_date: clubPaymentDate,
          payment_deadline: paymentDeadline,
          days_after_club_payment: deadlineDays
        }
      });
    }

    if (body.action === 'configure_exception' || body.action === 'clear_exception') {
      const playerId = Number(body.player_id);
      const period = parsePeriod(body.period_month);
      if (!Number.isSafeInteger(playerId) || playerId <= 0 || !period) {
        return response.status(400).json({ error: 'Choose a player and settlement month.' });
      }
      const { data: player, error: playerError } = await auth.supabase
        .from('players')
        .select('id, active')
        .eq('id', playerId)
        .maybeSingle();
      if (playerError) throw playerError;
      if (!player?.active) return response.status(400).json({ error: 'Select an active player.' });

      const links = await findOrCreateMonthlyPeriod(auth.supabase, period);
      if (!links.monthlyPeriodId) {
        return response.status(400).json({ error: 'No matching season is available for this month.' });
      }
      const { data: monthlyPeriod, error: monthlyPeriodError } = await auth.supabase
        .from('monthly_periods')
        .select('id, payment_deadline')
        .eq('id', links.monthlyPeriodId)
        .maybeSingle();
      if (monthlyPeriodError) throw monthlyPeriodError;
      if (!monthlyPeriod?.payment_deadline) {
        return response.status(400).json({ error: 'Set the monthly payment deadline before adding an exception.' });
      }

      if (body.action === 'clear_exception') {
        const { error: clearError } = await auth.supabase
          .from('settlement_exceptions')
          .update({ active: false, updated_by: auth.user.id })
          .eq('player_id', playerId)
          .eq('monthly_period_id', links.monthlyPeriodId);
        if (clearError) throw clearError;
        return response.status(200).json({ message: 'Settlement exception cleared.' });
      }

      const customDeadline = body.custom_deadline ? parseDate(body.custom_deadline) : null;
      const pausedUntil = body.penalties_paused_until
        ? parseDate(body.penalties_paused_until)
        : null;
      const penaltiesWaived = readBoolean(body.penalties_waived);
      const reason = String(body.reason || '').trim();
      if ((body.custom_deadline && !customDeadline)
        || (body.penalties_paused_until && !pausedUntil)) {
        return response.status(400).json({ error: 'Enter valid exception dates.' });
      }
      if (customDeadline && customDeadline < monthlyPeriod.payment_deadline) {
        return response.status(400).json({ error: 'An extended deadline cannot be earlier than the normal deadline.' });
      }
      if (!customDeadline && !pausedUntil && !penaltiesWaived) {
        return response.status(400).json({ error: 'Extend the deadline, pause penalties, or waive them.' });
      }
      if (reason.length > 500) {
        return response.status(400).json({ error: 'The private reason cannot exceed 500 characters.' });
      }

      const { data: existing, error: existingError } = await auth.supabase
        .from('settlement_exceptions')
        .select('id')
        .eq('player_id', playerId)
        .eq('monthly_period_id', links.monthlyPeriodId)
        .maybeSingle();
      if (existingError) throw existingError;
      const values = {
        custom_deadline: customDeadline,
        penalties_paused_until: pausedUntil,
        penalties_waived: penaltiesWaived,
        active: true,
        updated_by: auth.user.id
      };
      if (reason) values.reason = reason;
      const result = existing
        ? await auth.supabase.from('settlement_exceptions').update(values).eq('id', existing.id)
        : await auth.supabase.from('settlement_exceptions').insert({
          player_id: playerId,
          monthly_period_id: links.monthlyPeriodId,
          ...values,
          created_by: auth.user.id
        });
      if (result.error) throw result.error;
      return response.status(200).json({ message: 'Settlement exception saved.' });
    }

    if (body.action === 'reverse') {
      const paymentId = Number(body.payment_id);
      const reason = String(body.reason || '').trim();
      if (!Number.isSafeInteger(paymentId) || paymentId <= 0 || !reason) {
        return response.status(400).json({ error: 'Choose a payment and enter a reversal reason.' });
      }
      if (reason.length > 500) {
        return response.status(400).json({ error: 'The reversal reason cannot exceed 500 characters.' });
      }
      const { data: payment, error: paymentError } = await auth.supabase
        .from('payments')
        .select('id, reversed_at')
        .eq('id', paymentId)
        .maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return response.status(404).json({ error: 'Payment not found.' });
      if (payment.reversed_at) return response.status(409).json({ error: 'This payment is already reversed.' });

      const { error: reverseError } = await auth.supabase
        .from('payments')
        .update({
          reversed_at: new Date().toISOString(),
          reversed_by: auth.user.id,
          reversal_reason: reason
        })
        .eq('id', paymentId)
        .is('reversed_at', null);
      if (reverseError) throw reverseError;
      return response.status(200).json({ message: 'Payment reversed. The original record was kept.' });
    }

    const playerId = Number(body.player_id);
    const amount = Number(body.amount);
    const period = parsePeriod(body.period_month);
    const method = String(body.payment_method || '').trim();
    const note = String(body.admin_note || '').trim();
    const paidAt = new Date(body.paid_at || Date.now());
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return response.status(400).json({ error: 'Select an active player.' });
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return response.status(400).json({ error: 'Enter a positive payment amount.' });
    }
    if (!period) return response.status(400).json({ error: 'Enter a valid payment month.' });
    if (!['cash', 'bank_transfer', 'other'].includes(method)) {
      return response.status(400).json({ error: 'Select cash, bank transfer, or other.' });
    }
    if (Number.isNaN(paidAt.getTime())) return response.status(400).json({ error: 'Enter a valid payment date.' });
    if (note.length > 500) return response.status(400).json({ error: 'The note cannot exceed 500 characters.' });

    const { data: player, error: playerError } = await auth.supabase
      .from('players')
      .select('id, active')
      .eq('id', playerId)
      .maybeSingle();
    if (playerError) throw playerError;
    if (!player?.active) return response.status(400).json({ error: 'Select an active player.' });

    const links = await findOrCreateMonthlyPeriod(auth.supabase, period);
    const { error: insertError } = await auth.supabase.from('payments').insert({
      player_id: playerId,
      season_id: links.seasonId,
      monthly_period_id: links.monthlyPeriodId,
      period_month: `${period}-01`,
      amount: roundMoney(amount),
      currency: 'EUR',
      payment_method: method,
      paid_at: paidAt.toISOString(),
      admin_note: note || null,
      idempotency_key: randomUUID(),
      created_by: auth.user.id
    });
    if (insertError) throw insertError;

    return response.status(201).json({ message: 'Payment recorded.' });
  } catch (error) {
    console.error(error);
    const errorText = String(error.message || '');
    const missingExceptions = ['42P01', 'PGRST205'].includes(error?.code)
      && errorText.toLowerCase().includes('settlement_exceptions');
    const missingTable = ['42P01', 'PGRST205'].includes(error?.code)
      && errorText.toLowerCase().includes('payments');
    return response.status(500).json({
      error: missingExceptions
        ? 'Settlement exceptions are not configured yet. Run database/009-settlement-exceptions.sql in Supabase.'
        : missingTable
        ? 'Payments are not configured yet. Run database/007-player-payment-ledger.sql in Supabase.'
        : (error.message || 'Unable to process payments.')
    });
  }
};

module.exports.buildBalances = buildBalances;
module.exports.occurrencePeriod = occurrencePeriod;
module.exports.addSettlementStatuses = addSettlementStatuses;
