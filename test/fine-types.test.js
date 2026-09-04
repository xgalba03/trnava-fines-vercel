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

const handler = require('../api/fine-types');
Module._load = originalLoad;

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';

function createResponse() {
  return {
    body: undefined,
    headers: {},
    statusCode: 200,
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

test('active fine types expose their calculation and match-day rules', async () => {
  const expectedFineTypes = [{
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
    active: true,
    system_managed: false
  }];

  clientFactory = () => ({
    from(table) {
      assert.equal(table, 'fine_types');
      return {
        select(columns) {
          assert.match(columns, /calculation_mode/);
          assert.match(columns, /double_on_match_day/);
          return {
            eq(column, value) {
              assert.equal(column, 'active');
              assert.equal(value, true);
              return {
                eq(secondColumn, secondValue) {
                  assert.equal(secondColumn, 'system_managed');
                  assert.equal(secondValue, false);
                  return {
                    order(columnOne) {
                      assert.equal(columnOne, 'category');
                      return {
                        order(columnTwo) {
                          assert.equal(columnTwo, 'name');
                          return Promise.resolve({ data: expectedFineTypes, error: null });
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  });

  const response = createResponse();
  await handler({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { fineTypes: expectedFineTypes });
});
