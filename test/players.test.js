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

const handler = require('../api/players');
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

test('active players are publicly readable in name order', async () => {
  const expectedPlayers = [
    { id: 7, name: 'Alex', jersey_number: null, active: true },
    { id: 1, name: 'Martin', jersey_number: null, active: true }
  ];

  clientFactory = (url, key) => {
    assert.equal(url, 'https://example.supabase.co');
    assert.equal(key, 'anon-key');
    return {
      from(table) {
        assert.equal(table, 'players');
        return {
          select(columns) {
            assert.equal(columns, 'id, name, jersey_number, active');
            return {
              eq(column, value) {
                assert.equal(column, 'active');
                assert.equal(value, true);
                return {
                  order(orderColumn, options) {
                    assert.equal(orderColumn, 'name');
                    assert.deepEqual(options, { ascending: true });
                    return Promise.resolve({ data: expectedPlayers, error: null });
                  }
                };
              }
            };
          }
        };
      }
    };
  };

  const response = createResponse();
  await handler({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { players: expectedPlayers });
});
