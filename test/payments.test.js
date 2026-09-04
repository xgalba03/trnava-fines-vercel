const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

let clientFactory = () => {
  throw new Error('Unexpected Supabase client creation.');
};

const originalLoad = Module._load;
Module._load = function mockSupabase(request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: (...args) => clientFactory(...args) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const handler = require('../api/payments');
Module._load = originalLoad;

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.ADMIN_EMAIL = 'admin@example.com';

function createResponse() {
  return {
    body: undefined,
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function resolved(data) {
  return Promise.resolve({ data, error: null });
}

test('monthly balances combine fines, credits, and player-level payments', async () => {
  const activePayments = [
    {
      id: 30,
      player_id: 7,
      amount: 4,
      period_month: '2026-09-01',
      paid_at: '2026-09-20T10:00:00Z',
      player: { name: 'Alex' }
    },
    {
      id: 29,
      player_id: 7,
      amount: 52,
      period_month: '2026-08-01',
      paid_at: '2026-08-20T10:00:00Z',
      player: { name: 'Alex' }
    }
  ];

  clientFactory = (_url, key, options) => {
    assert.equal(key, 'anon-key');
    assert.deepEqual(options, {});
    return {
      from(table) {
        if (table === 'players') {
          return {
            select: () => ({
              eq: () => ({ order: () => resolved([{ id: 7, name: 'Alex', active: true }]) })
            })
          };
        }
        if (table === 'fines') {
          return {
            select: () => ({
              is(column, value) {
                assert.equal(column, 'voided_at');
                assert.equal(value, null);
                return resolved([
                  { player_id: 7, amount: 10, occurred_at: '2026-09-10T10:00:00Z' },
                  {
                    player_id: 7,
                    amount: 1,
                    occurred_at: '2026-10-20T12:00:00Z',
                    monthly_period_id: 9,
                    monthly_period: { period_month: '2026-09-01' }
                  },
                  { player_id: 7, amount: 50, occurred_at: '2026-08-10T10:00:00Z' }
                ]);
              }
            })
          };
        }
        if (table === 'financial_adjustments') {
          return { select: () => resolved([
            { player_id: 7, amount: -2, occurred_at: '2026-09-11T10:00:00Z' }
          ]) };
        }
        if (table === 'seasons') {
          return {
            select: () => ({
              order: () => resolved([{
                id: 2, start_date: '2026-08-01', end_date: '2027-06-30', active: true
              }])
            })
          };
        }
        if (table === 'monthly_periods') {
          return {
            select: () => ({
              eq: () => resolved([{
                id: 9,
                season_id: 2,
                period_month: '2026-09-01',
                club_payment_date: '2026-08-27',
                payment_deadline: '2026-09-01'
              }])
            })
          };
        }
        if (table === 'settlement_exceptions') {
          return {
            select: () => ({ eq: () => resolved([]) })
          };
        }
        assert.equal(table, 'payments');
        return {
          select: () => ({
            is: () => ({ order: () => resolved(activePayments) })
          })
        };
      }
    };
  };

  const response = createResponse();
  await handler({ method: 'GET', headers: {}, query: { period: '2026-09' } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.monthly_period, {
    id: 9,
    season_id: 2,
    period_month: '2026-09-01',
    club_payment_date: '2026-08-27',
    payment_deadline: '2026-09-01',
    days_after_club_payment: 5
  });
  assert.deepEqual(response.body.balances, [{
    player_id: 7,
    player_name: 'Alex',
    opening_balance: -2,
    charges: 11,
    adjustments: -2,
    paid: 4,
    balance: 3,
    settlement_status: 'overdue',
    effective_deadline: '2026-09-01',
    exception: null
  }]);
  assert.deepEqual(response.body.payments, [activePayments[0]]);
});

test('admin records one monthly payment without changing any fine', async () => {
  let insertedPayment;
  let monthlyPeriodUpsert;

  clientFactory = (_url, _key, options) => {
    assert.equal(options.global.headers.Authorization, 'Bearer access');
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'admin-id', email: 'admin@example.com' } },
          error: null
        })
      },
      from(table) {
        if (table === 'players') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => resolved({ id: 7, active: true }) })
            })
          };
        }
        if (table === 'seasons') {
          return {
            select: () => ({
              order: () => resolved([{
                id: 2, start_date: '2026-08-01', end_date: '2027-06-30', active: true
              }])
            })
          };
        }
        if (table === 'monthly_periods') {
          return {
            upsert(value, optionsValue) {
              monthlyPeriodUpsert = { value, options: optionsValue };
              return {
                select: () => ({ single: () => resolved({ id: 9 }) })
              };
            }
          };
        }
        assert.equal(table, 'payments');
        return {
          insert(value) {
            insertedPayment = value;
            return resolved(null);
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: {
      player_id: '7',
      amount: '23',
      period_month: '2026-09',
      paid_at: '2026-09-20T10:00:00Z',
      payment_method: 'cash',
      admin_note: 'Paid after practice'
    }
  }, response);

  assert.equal(response.statusCode, 201);
  assert.deepEqual(monthlyPeriodUpsert, {
    value: { season_id: 2, period_month: '2026-09-01' },
    options: { onConflict: 'season_id,period_month' }
  });
  assert.equal(insertedPayment.player_id, 7);
  assert.equal(insertedPayment.season_id, 2);
  assert.equal(insertedPayment.monthly_period_id, 9);
  assert.equal(insertedPayment.period_month, '2026-09-01');
  assert.equal(insertedPayment.amount, 23);
  assert.equal(insertedPayment.payment_method, 'cash');
  assert.equal(insertedPayment.admin_note, 'Paid after practice');
  assert.equal(insertedPayment.created_by, 'admin-id');
  assert.match(insertedPayment.idempotency_key, /^[0-9a-f-]{36}$/);
});

test('admin reverses a payment while preserving its record', async () => {
  let reversedValues;

  clientFactory = (_url, _key, options) => {
    assert.equal(options.global.headers.Authorization, 'Bearer access');
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'admin-id', email: 'admin@example.com' } },
          error: null
        })
      },
      from(table) {
        assert.equal(table, 'payments');
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => resolved({ id: 30, reversed_at: null }) })
          }),
          update(values) {
            reversedValues = values;
            return {
              eq: () => ({ is: () => resolved(null) })
            };
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: { action: 'reverse', payment_id: 30, reason: '' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(reversedValues.reversed_by, 'admin-id');
  assert.equal(reversedValues.reversal_reason, 'No reason provided.');
  assert.match(reversedValues.reversed_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('admin sets a club payment date and the configured five-day deadline', async () => {
  let updatedPeriod;

  clientFactory = (_url, _key, options) => {
    assert.equal(options.global.headers.Authorization, 'Bearer access');
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'admin-id', email: 'admin@example.com' } },
          error: null
        })
      },
      from(table) {
        if (table === 'seasons') {
          return {
            select: () => ({
              order: () => resolved([{
                id: 2, start_date: '2026-08-01', end_date: '2027-06-30', active: true
              }])
            })
          };
        }
        assert.equal(table, 'monthly_periods');
        return {
          upsert: () => ({
            select: () => ({ single: () => resolved({ id: 9 }) })
          }),
          update(values) {
            updatedPeriod = values;
            return { eq: () => resolved(null) };
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: {
      action: 'configure_period',
      period_month: '2026-09',
      club_payment_date: '2026-10-14'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(updatedPeriod, {
    club_payment_date: '2026-10-14',
    payment_deadline: '2026-10-19'
  });
  assert.equal(response.body.monthly_period.payment_deadline, '2026-10-19');
});

test('admin saves a private player exception for one settlement month', async () => {
  let insertedException;

  clientFactory = (_url, _key, options) => {
    assert.equal(options.global.headers.Authorization, 'Bearer access');
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'admin-id', email: 'admin@example.com' } },
          error: null
        })
      },
      from(table) {
        if (table === 'players') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => resolved({ id: 7, active: true }) })
            })
          };
        }
        if (table === 'seasons') {
          return {
            select: () => ({
              order: () => resolved([{
                id: 2, start_date: '2026-08-01', end_date: '2027-06-30', active: true
              }])
            })
          };
        }
        if (table === 'monthly_periods') {
          return {
            upsert: () => ({
              select: () => ({ single: () => resolved({ id: 9 }) })
            }),
            select: () => ({
              eq: () => ({ maybeSingle: () => resolved({ id: 9, payment_deadline: '2026-10-19' }) })
            })
          };
        }
        assert.equal(table, 'settlement_exceptions');
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => resolved(null) })
            })
          }),
          insert(value) {
            insertedException = value;
            return resolved(null);
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: {
      action: 'configure_exception',
      player_id: '7',
      period_month: '2026-09',
      custom_deadline: '2026-10-26',
      penalties_paused_until: '',
      penalties_waived: false,
      reason: 'Approved travel'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(insertedException, {
    player_id: 7,
    monthly_period_id: 9,
    custom_deadline: '2026-10-26',
    penalties_paused_until: null,
    penalties_waived: false,
    reason: 'Approved travel',
    active: true,
    updated_by: 'admin-id',
    created_by: 'admin-id'
  });
});

test('public settlement status reflects a pause without exposing a reason', () => {
  const balances = handler.addSettlementStatuses(
    [{
      player_id: 7,
      player_name: 'Alex',
      opening_balance: 0,
      charges: 10,
      adjustments: 0,
      paid: 0,
      balance: 10
    }],
    { payment_deadline: '2026-10-19' },
    [{
      id: 4,
      player_id: 7,
      active: true,
      custom_deadline: null,
      penalties_paused_until: '2026-10-25',
      penalties_waived: false
    }],
    '2026-10-22'
  );

  assert.equal(balances[0].settlement_status, 'paused');
  assert.equal(balances[0].effective_deadline, '2026-10-19');
  assert.equal(Object.hasOwn(balances[0].exception, 'reason'), false);
});
