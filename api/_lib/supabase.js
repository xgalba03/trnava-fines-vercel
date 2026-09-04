const { createClient } = require('@supabase/supabase-js');

function createSupabaseClient(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variable.');
  const options = token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {};
  return createClient(url, key, options);
}

function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing server-only Supabase environment variable.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getToken(request) {
  return request.headers.authorization?.replace(/^Bearer\s+/i, '') || null;
}

async function requireAdmin(request) {
  const token = getToken(request);
  if (!token) return { error: 'Admin login required.', status: 401 };
  const supabase = createSupabaseClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: 'Your session has expired.', status: 401 };
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail || data.user.email?.trim().toLowerCase() !== adminEmail) {
    return { error: 'Admin access required.', status: 403 };
  }
  return { supabase, user: data.user };
}

module.exports = {
  createSupabaseClient,
  createServiceClient,
  getToken,
  requireAdmin
};
