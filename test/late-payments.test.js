const assert = require('node:assert/strict');
const test = require('node:test');
const { belongsToPeriod, buildLatePaymentRows } = require('../api/_lib/late-payments');

const period = {
  id: 9,
  season_id: 2,
  period_month: '2026-09-01',
  payment_deadline: '2026-10-19'
};

const fineType = {
  id: 40,
  name: 'Late monthly payment',
  description: 'Automatic daily penalty for an overdue monthly settlement.',
  category: 'Payment'
};

test('a linked late fine belongs to its settlement month, not its occurrence month', () => {
  assert.equal(belongsToPeriod({
    monthly_period_id: 9,
    occurred_at: '2026-10-20T12:00:00Z'
  }, period), true);
});

test('late-payment rows backfill missed days without duplicating existing fines', () => {
  const rows = buildLatePaymentRows({
    periods: [period],
    players: [{ id: 7 }, { id: 8 }],
    fines: [
      {
        user_id: 'admin-id',
        player_id: 7,
        monthly_period_id: null,
        amount: 16,
        occurred_at: '2026-09-10T10:00:00Z',
        type: 'normal',
        idempotency_key: null
      },
      {
        user_id: 'admin-id',
        player_id: 7,
        monthly_period_id: 9,
        amount: 1,
        occurred_at: '2026-10-20T12:00:00Z',
        type: 'late_payment',
        idempotency_key: 'late-payment:9:7:2026-10-20'
      },
      {
        user_id: 'admin-id',
        player_id: 8,
        monthly_period_id: null,
        amount: 10,
        occurred_at: '2026-09-12T10:00:00Z',
        type: 'normal',
        idempotency_key: null
      }
    ],
    adjustments: [],
    payments: [{
      player_id: 8,
      period_month: '2026-09-01',
      amount: 10,
      paid_at: '2026-10-18T10:00:00Z'
    }],
    fineType,
    amount: 1,
    today: '2026-10-22'
  });

  assert.deepEqual(rows.map((row) => row.idempotency_key), [
    'late-payment:9:7:2026-10-21',
    'late-payment:9:7:2026-10-22'
  ]);
  assert.ok(rows.every((row) => row.type === 'late_payment'));
  assert.ok(rows.every((row) => row.monthly_period_id === 9));
  assert.ok(rows.every((row) => row.amount === 1));
});

test('late-payment fines stop once the full period balance is covered', () => {
  const rows = buildLatePaymentRows({
    periods: [period],
    players: [{ id: 7 }],
    fines: [{
      user_id: 'admin-id',
      player_id: 7,
      monthly_period_id: null,
      amount: 16,
      occurred_at: '2026-09-10T10:00:00Z',
      type: 'normal',
      idempotency_key: null
    }],
    adjustments: [],
    payments: [{
      player_id: 7,
      period_month: '2026-09-01',
      amount: 16,
      paid_at: '2026-10-18T10:00:00Z'
    }],
    fineType,
    amount: 1,
    today: '2026-10-22'
  });

  assert.deepEqual(rows, []);
});

test('a payment on an overdue day does not erase penalties for earlier missed days', () => {
  const rows = buildLatePaymentRows({
    periods: [period],
    players: [{ id: 7 }],
    fines: [{
      user_id: 'admin-id',
      player_id: 7,
      monthly_period_id: null,
      amount: 16,
      occurred_at: '2026-09-10T10:00:00Z',
      type: 'normal',
      idempotency_key: null
    }],
    adjustments: [],
    payments: [{
      player_id: 7,
      period_month: '2026-09-01',
      amount: 19,
      paid_at: '2026-10-22T18:00:00Z'
    }],
    fineType,
    amount: 1,
    today: '2026-10-23'
  });

  assert.deepEqual(rows.map((row) => row.idempotency_key), [
    'late-payment:9:7:2026-10-20',
    'late-payment:9:7:2026-10-21',
    'late-payment:9:7:2026-10-22'
  ]);
});

test('custom deadlines, pauses, and waivers change automatic penalty dates', () => {
  const common = {
    periods: [period],
    players: [{ id: 7 }],
    fines: [{
      user_id: 'admin-id',
      player_id: 7,
      monthly_period_id: null,
      amount: 16,
      occurred_at: '2026-09-10T10:00:00Z',
      type: 'normal',
      idempotency_key: null
    }],
    adjustments: [],
    payments: [],
    fineType,
    amount: 1,
    today: '2026-10-23'
  };

  const extended = buildLatePaymentRows({
    ...common,
    exceptions: [{
      active: true,
      player_id: 7,
      monthly_period_id: 9,
      custom_deadline: '2026-10-21',
      penalties_paused_until: null,
      penalties_waived: false
    }]
  });
  assert.deepEqual(extended.map((row) => row.occurred_at), [
    '2026-10-22T12:00:00Z',
    '2026-10-23T12:00:00Z'
  ]);

  const paused = buildLatePaymentRows({
    ...common,
    exceptions: [{
      active: true,
      player_id: 7,
      monthly_period_id: 9,
      custom_deadline: null,
      penalties_paused_until: '2026-10-22',
      penalties_waived: false
    }]
  });
  assert.deepEqual(paused.map((row) => row.occurred_at), ['2026-10-23T12:00:00Z']);

  const waived = buildLatePaymentRows({
    ...common,
    exceptions: [{
      active: true,
      player_id: 7,
      monthly_period_id: 9,
      custom_deadline: null,
      penalties_paused_until: null,
      penalties_waived: true
    }]
  });
  assert.deepEqual(waived, []);
});
