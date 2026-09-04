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

const handler = require('../api/auth');
Module._load = originalLoad;

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.SITE_URL = 'https://example.vercel.app';

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
    },
    end() {
      return this;
    }
  };
}

test('password login returns only the browser session fields', async () => {
  clientFactory = () => ({
    auth: {
      signInWithPassword: async ({ email, password }) => {
        assert.equal(email, 'admin@example.com');
        assert.equal(password, 'correct horse battery staple');
        return {
          data: {
            user: { email: 'admin@example.com' },
            session: {
              access_token: 'access',
              refresh_token: 'refresh',
              expires_at: 123,
              provider_token: 'not-for-the-browser'
            }
          },
          error: null
        };
      }
    }
  });

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: {},
    body: {
      action: 'login',
      email: 'admin@example.com',
      password: 'correct horse battery staple'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.session, {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 123
  });
});

test('a non-admin email is rejected before contacting Supabase', async () => {
  clientFactory = () => {
    throw new Error('Supabase should not be contacted.');
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: {},
    body: { action: 'login', email: 'other@example.com', password: 'password' }
  }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, 'Invalid email or password.');
});

test('the setup link cannot create a new account', async () => {
  clientFactory = () => ({
    auth: {
      signInWithOtp: async ({ email, options }) => {
        assert.equal(email, 'admin@example.com');
        assert.equal(options.emailRedirectTo, 'https://example.vercel.app');
        assert.equal(options.shouldCreateUser, false);
        return { error: null };
      }
    }
  });

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: {},
    body: { action: 'magic_link', email: 'admin@example.com' }
  }, response);

  assert.equal(response.statusCode, 200);
});

test('an authenticated admin can set a password through the server-only client', async () => {
  let passwordUpdate;
  clientFactory = (_url, key) => {
    if (key === 'anon-key') {
      return {
        auth: {
          getUser: async (token) => {
            assert.equal(token, 'access');
            return { data: { user: { id: 'admin-id', email: 'admin@example.com' } }, error: null };
          }
        }
      };
    }

    assert.equal(key, 'service-key');
    return {
      auth: {
        admin: {
          updateUserById: async (id, attributes) => {
            passwordUpdate = { id, attributes };
            return { error: null };
          }
        }
      }
    };
  };

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer access' },
    body: { action: 'set_password', password: 'a sufficiently long password' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(passwordUpdate, {
    id: 'admin-id',
    attributes: { password: 'a sufficiently long password' }
  });
});

test('a refresh token returns a replacement session for the admin', async () => {
  clientFactory = () => ({
    auth: {
      refreshSession: async ({ refresh_token: refreshToken }) => {
        assert.equal(refreshToken, 'old-refresh');
        return {
          data: {
            user: { email: 'admin@example.com' },
            session: {
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_at: 456
            }
          },
          error: null
        };
      }
    }
  });

  const response = createResponse();
  await handler({
    method: 'POST',
    headers: {},
    body: { action: 'refresh', refresh_token: 'old-refresh' }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.session.access_token, 'new-access');
});
