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

const handler = require('../api/objections');
Module._load = originalLoad;

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.ADMIN_EMAIL = 'admin@example.com';

function createResponse() {
  return {
    body: undefined,
    statusCode: 200,
    setHeader() {},
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

test('objection listing explicitly selects the original-fine relationship', async () => {
  clientFactory = () => ({
    from(table) {
      assert.equal(table, 'objections');
      return {
        select(columns) {
          assert.match(columns, /fine:fines!objections_fine_id_fkey\(/);
          return {
            order: async () => ({ data: [], error: null })
          };
        }
      };
    }
  });

  const response = createResponse();
  await handler({ method: 'GET', headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { objections: [] });
});

test('retrying an existing objection does not call the creation RPC again', async () => {
  let rpcCalls = 0;
  const existing = { id: 9, fine_id: 4, status: 'pending' };
  clientFactory = () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'admin-id', email: 'admin@example.com' } },
        error: null
      })
    },
    rpc() {
      rpcCalls += 1;
      return Promise.resolve({ error: null });
    },
    from(table) {
      assert.equal(table, 'objections');
      return {
        select(columns) {
          if (columns === 'id, status') {
            return {
              eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) })
            };
          }
          return {
            order: async () => ({ data: [existing], error: null })
          };
        }
      };
    }
  });

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: { action: 'submit', fine_id: 4, reason: 'Retry' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(rpcCalls, 0);
  assert.deepEqual(response.body, { objections: [existing] });
});
