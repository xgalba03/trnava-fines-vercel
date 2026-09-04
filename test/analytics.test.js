const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function mockSupabase(request, parent, isMain) {
  if (request === '@supabase/supabase-js') return { createClient: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
const { buildAnalytics } = require('../api/analytics');
Module._load = originalLoad;

test('season analytics separate normal fines, late fees, credits, and payments', () => {
  const season = {
    id: 2,
    name: '2026/27',
    start_date: '2026-08-01',
    end_date: '2027-06-30'
  };
  const analytics = buildAnalytics({
    season,
    players: [
      { id: 7, name: 'Alex', active: true },
      { id: 8, name: 'Ben', active: true }
    ],
    fines: [
      {
        id: 1, player_id: 7, season_id: 2, fine_type_id: 3,
        name: 'Late to training', amount: 10, type: 'normal',
        occurred_at: '2026-09-04T10:00:00Z',
        fine_type: { code: 'late-to-training', name: 'Late to training', category: 'Training' }
      },
      {
        id: 2, player_id: 7, season_id: 2, fine_type_id: 4,
        name: 'Late payment', amount: 2, type: 'late_payment',
        occurred_at: '2026-09-20T10:00:00Z',
        fine_type: { code: 'late-payment', name: 'Late payment', category: 'Administration' }
      },
      {
        id: 3, player_id: 8, season_id: 2, fine_type_id: 3,
        name: 'Late to training', amount: 5, type: 'normal',
        occurred_at: '2026-10-04T10:00:00Z',
        fine_type: { code: 'late-to-training', name: 'Late to training', category: 'Training' }
      },
      {
        id: 4, player_id: 8, season_id: 2, fine_type_id: 5,
        name: 'Objection fee', amount: 1, type: 'normal',
        occurred_at: '2026-10-05T10:00:00Z',
        fine_type: { code: 'objection-filing-fee', name: 'Objection fee', category: 'Administration' }
      },
      {
        id: 5, player_id: 7, season_id: 1, fine_type_id: 3,
        name: 'Old fine', amount: 99, type: 'normal',
        occurred_at: '2025-09-04T10:00:00Z',
        fine_type: { code: 'old', name: 'Old fine', category: 'Other' }
      }
    ],
    adjustments: [
      { player_id: 7, season_id: 2, amount: -2, kind: 'objection_credit', occurred_at: '2026-09-21T10:00:00Z' },
      { player_id: 8, season_id: 2, amount: 3, kind: 'manual_charge', occurred_at: '2026-10-06T10:00:00Z' }
    ],
    payments: [
      { player_id: 7, season_id: 2, period_month: '2026-09-01', amount: 5 },
      { player_id: 8, season_id: 2, period_month: '2026-10-01', amount: 2 },
      { player_id: 7, season_id: 1, period_month: '2025-09-01', amount: 100 }
    ]
  });

  assert.deepEqual(analytics.summary, {
    team_pot: 7,
    assessed: 19,
    outstanding: 12,
    collection_rate: 36.8,
    fine_count: 4,
    normal_total: 16,
    late_total: 2,
    adjustment_total: 1
  });
  assert.equal(analytics.leaderboard[0].player_name, 'Alex');
  assert.equal(analytics.leaderboard[0].total_amount, 12);
  assert.equal(analytics.leaderboard[0].late_amount, 2);
  assert.equal(analytics.leaderboard[1].balance, 7);
  assert.deepEqual(analytics.offences, [{
    fine_type_id: 3,
    name: 'Late to training',
    category: 'Training',
    count: 2,
    amount: 15
  }]);
  assert.deepEqual(analytics.months.map((month) => [month.month, month.total_amount]), [
    ['2026-09', 12],
    ['2026-10', 6]
  ]);
});

test('legacy records without a season id use their transaction date', () => {
  const analytics = buildAnalytics({
    season: { id: 2, start_date: '2026-08-01', end_date: '2027-06-30' },
    players: [{ id: 7, name: 'Alex' }],
    fines: [{
      id: 1,
      player_id: 7,
      season_id: null,
      amount: 4,
      name: 'Legacy fine',
      type: 'normal',
      occurred_at: '2026-08-02T10:00:00Z'
    }]
  });

  assert.equal(analytics.summary.assessed, 4);
  assert.equal(analytics.leaderboard[0].player_name, 'Alex');
});
