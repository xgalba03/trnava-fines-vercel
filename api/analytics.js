const { createSupabaseClient } = require('./_lib/supabase');

const ACCOUNT_TIME_ZONE = 'Europe/Bratislava';
const monthFormatter = new Intl.DateTimeFormat('en', {
  timeZone: ACCOUNT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit'
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function monthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    monthFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
}

function related(value) {
  return Array.isArray(value) ? value[0] : value;
}

function belongsToSeason(item, season, dateField) {
  if (item.season_id !== null && item.season_id !== undefined) {
    return Number(item.season_id) === Number(season.id);
  }
  const value = item[dateField];
  if (!value) return false;
  const date = String(value).slice(0, 10);
  return date >= season.start_date && (!season.end_date || date <= season.end_date);
}

function buildAnalytics({ season, players = [], fines = [], adjustments = [], payments = [] }) {
  const seasonFines = fines.filter((item) => belongsToSeason(item, season, 'occurred_at'));
  const seasonAdjustments = adjustments.filter((item) => belongsToSeason(item, season, 'occurred_at'));
  const seasonPayments = payments.filter((item) => belongsToSeason(item, season, 'period_month'));
  const playerRows = new Map(players.map((player) => [String(player.id), {
    player_id: player.id,
    player_name: player.name,
    total_amount: 0,
    fine_count: 0,
    normal_fine_count: 0,
    late_amount: 0,
    balance: 0
  }]));
  const offences = new Map();
  const months = new Map();
  let normalTotal = 0;
  let lateTotal = 0;

  for (const fine of seasonFines) {
    const amount = Number(fine.amount) || 0;
    const player = playerRows.get(String(fine.player_id));
    const fineType = related(fine.fine_type);
    const isLate = fine.type === 'late_payment';
    const isFilingFee = fineType?.code === 'objection-filing-fee';
    if (player) {
      player.total_amount = roundMoney(player.total_amount + amount);
      player.fine_count += 1;
      player.balance = roundMoney(player.balance + amount);
      if (isLate) player.late_amount = roundMoney(player.late_amount + amount);
      else if (!isFilingFee) player.normal_fine_count += 1;
    }
    if (isLate) lateTotal = roundMoney(lateTotal + amount);
    else normalTotal = roundMoney(normalTotal + amount);

    if (!isLate && !isFilingFee) {
      const offenceKey = String(fine.fine_type_id || fine.name);
      const offence = offences.get(offenceKey) || {
        fine_type_id: fine.fine_type_id,
        name: fineType?.name || fine.name || 'Unknown fine',
        category: fineType?.category || fine.category_snapshot || 'Other',
        count: 0,
        amount: 0
      };
      offence.count += 1;
      offence.amount = roundMoney(offence.amount + amount);
      offences.set(offenceKey, offence);
    }

    const month = monthKey(fine.occurred_at);
    if (month) {
      const row = months.get(month) || { month, normal_amount: 0, late_amount: 0, count: 0 };
      if (isLate) row.late_amount = roundMoney(row.late_amount + amount);
      else row.normal_amount = roundMoney(row.normal_amount + amount);
      row.count += 1;
      months.set(month, row);
    }
  }

  let adjustmentTotal = 0;
  for (const adjustment of seasonAdjustments) {
    const amount = Number(adjustment.amount) || 0;
    adjustmentTotal = roundMoney(adjustmentTotal + amount);
    const player = playerRows.get(String(adjustment.player_id));
    if (player) player.balance = roundMoney(player.balance + amount);
  }

  let collected = 0;
  for (const payment of seasonPayments) {
    const amount = Number(payment.amount) || 0;
    collected = roundMoney(collected + amount);
    const player = playerRows.get(String(payment.player_id));
    if (player) player.balance = roundMoney(player.balance - amount);
  }

  const assessed = roundMoney(normalTotal + lateTotal + adjustmentTotal);
  const outstanding = roundMoney([...playerRows.values()]
    .reduce((sum, player) => sum + Math.max(0, player.balance), 0));
  const leaderboard = [...playerRows.values()]
    .filter((player) => player.fine_count > 0)
    .sort((left, right) => (
      right.total_amount - left.total_amount
      || right.fine_count - left.fine_count
      || left.player_name.localeCompare(right.player_name)
    ))
    .map((player, index) => ({ ...player, rank: index + 1 }));

  return {
    summary: {
      team_pot: collected,
      assessed,
      outstanding,
      collection_rate: assessed > 0
        ? Math.min(100, Math.max(0, Math.round((collected / assessed) * 1000) / 10))
        : 0,
      fine_count: seasonFines.length,
      normal_total: normalTotal,
      late_total: lateTotal,
      adjustment_total: adjustmentTotal
    },
    leaderboard,
    offences: [...offences.values()].sort((left, right) => (
      right.count - left.count || right.amount - left.amount || left.name.localeCompare(right.name)
    )),
    months: [...months.values()]
      .map((row) => ({ ...row, total_amount: roundMoney(row.normal_amount + row.late_amount) }))
      .sort((left, right) => left.month.localeCompare(right.month))
  };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const requestedSeasonId = request.query?.season ? Number(request.query.season) : null;
    if (requestedSeasonId !== null && (!Number.isSafeInteger(requestedSeasonId) || requestedSeasonId <= 0)) {
      return response.status(400).json({ error: 'Choose a valid season.' });
    }

    const supabase = createSupabaseClient();
    const { data: seasons, error: seasonsError } = await supabase
      .from('seasons')
      .select('id, name, start_date, end_date, active')
      .order('start_date', { ascending: false });
    if (seasonsError) throw seasonsError;
    const selectedSeason = requestedSeasonId
      ? (seasons || []).find((season) => Number(season.id) === requestedSeasonId)
      : (seasons || []).find((season) => season.active) || seasons?.[0];
    if (requestedSeasonId && !selectedSeason) {
      return response.status(404).json({ error: 'Season not found.' });
    }
    if (!selectedSeason) {
      return response.status(200).json({ seasons: seasons || [], selected_season: null, analytics: null });
    }

    const [playersResult, finesResult, adjustmentsResult, paymentsResult] = await Promise.all([
      supabase.from('players').select('id, name, active').order('name'),
      supabase.from('fines')
        .select([
          'id', 'player_id', 'season_id', 'fine_type_id', 'name', 'amount',
          'category_snapshot', 'occurred_at', 'type',
          'fine_type:fine_types(code, name, category)'
        ].join(', '))
        .is('voided_at', null),
      supabase.from('financial_adjustments')
        .select('player_id, season_id, amount, kind, occurred_at'),
      supabase.from('payments')
        .select('player_id, season_id, period_month, amount, paid_at')
        .is('reversed_at', null)
    ]);
    const error = playersResult.error || finesResult.error || adjustmentsResult.error || paymentsResult.error;
    if (error) throw error;

    return response.status(200).json({
      seasons: seasons || [],
      selected_season: selectedSeason,
      analytics: buildAnalytics({
        season: selectedSeason,
        players: playersResult.data || [],
        fines: finesResult.data || [],
        adjustments: adjustmentsResult.data || [],
        payments: paymentsResult.data || []
      })
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to load analytics.' });
  }
};

module.exports.buildAnalytics = buildAnalytics;
