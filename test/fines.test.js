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

const handler = require('../api/fines');
Module._load = originalLoad;

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.ADMIN_EMAIL = 'admin@example.com';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

function createResponse() {
  return {
    body: undefined,
    statusCode: 200,
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

test('public fines can be read with the anon key and no login or service key', async () => {
  const expectedFines = [
    {
      id: 1,
      player_id: 7,
      fine_type_id: 3,
      name: 'Late to training',
      description: 'Late to training',
      amount: 2,
      occurred_at: '2026-09-04T10:00:00Z',
      type: 'normal',
      quantity: 2,
      unit_name_snapshot: 'minute',
      is_match_day: false,
      multiplier_applied: 1,
      calculated_amount: 2,
      amount_overridden: false,
      note: null,
      created_at: '2026-09-04T10:00:00Z',
      player: { name: 'Alex' },
      fine_type: { code: 'late-to-training', name: 'Late to training' }
    }
  ];

  clientFactory = (url, key, options) => {
    assert.equal(url, 'https://example.supabase.co');
    assert.equal(key, 'anon-key');
    assert.deepEqual(options, {});
    return {
      from(table) {
        assert.equal(table, 'fines');
        return {
          select(columns) {
            assert.equal(
              columns,
              [
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
              ].join(', ')
            );
            return {
              order(column, order) {
                assert.equal(column, 'occurred_at');
                assert.deepEqual(order, { ascending: false });
                return Promise.resolve({ data: expectedFines, error: null });
              }
            };
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { fines: expectedFines });
});

test('an admin fine records the selected active player', async () => {
  let insertedFine;
  const returnedFines = [];

  clientFactory = (_url, key, options) => {
    if (options?.global?.headers?.Authorization === 'Bearer access') {
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
              select() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({ data: { id: 7, active: true }, error: null })
                    };
                  }
                };
              }
            };
          }

          if (table === 'fine_types') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: 3,
                          code: 'late-to-training',
                          name: 'Late to training',
                          description: 'Player arrived late.',
                          default_amount: 1,
                          category: 'Training',
                          calculation_mode: 'per_unit',
                          unit_name: 'minute',
                          match_day_only: false,
                          double_on_match_day: true,
                          match_day_multiplier: 2,
                          active: true
                        },
                        error: null
                      })
                    };
                  }
                };
              }
            };
          }

          assert.equal(table, 'fines');
          return {
            insert(value) {
              insertedFine = value;
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }

    assert.equal(key, 'anon-key');
    return {
      from(table) {
        assert.equal(table, 'fines');
        return {
          select() {
            return {
              order: async () => ({ data: returnedFines, error: null })
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
    body: {
      player_id: '7',
      fine_type_id: '3',
      quantity: '7',
      is_match_day: true,
      amount: '14',
      note: 'Traffic',
      occurred_at: '2026-09-04T10:00:00Z'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(insertedFine.user_id, 'admin-id');
  assert.equal(insertedFine.player_id, 7);
  assert.equal(insertedFine.fine_type_id, 3);
  assert.equal(insertedFine.description, 'Player arrived late.');
  assert.equal(insertedFine.quantity, 7);
  assert.equal(insertedFine.base_amount, 7);
  assert.equal(insertedFine.multiplier_applied, 2);
  assert.equal(insertedFine.calculated_amount, 14);
  assert.equal(insertedFine.amount, 14);
  assert.equal(insertedFine.amount_overridden, false);
  assert.equal(insertedFine.is_match_day, true);
  assert.equal(insertedFine.note, 'Traffic');
  assert.equal(insertedFine.type, 'normal');
  assert.equal(insertedFine.source, 'manual');
  assert.equal(insertedFine.occurred_at, '2026-09-04T10:00:00.000Z');
});
