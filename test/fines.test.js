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
    { id: 1, description: 'Late to training', amount: 2, created_at: '2026-09-04T10:00:00Z' }
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
            assert.equal(columns, 'id, description, amount, created_at');
            return {
              order(column, order) {
                assert.equal(column, 'created_at');
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
