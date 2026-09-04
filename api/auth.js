const { createClient } = require('@supabase/supabase-js');

function getClient(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.');

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {})
  });
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function getToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function isAdmin(user) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(adminEmail && user?.email?.trim().toLowerCase() === adminEmail);
}

function publicSession(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at
  };
}

function methodNotAllowed(response, methods) {
  response.setHeader('Allow', methods.join(', '));
  return response.status(405).json({ error: 'Method not allowed.' });
}

async function validateAdmin(token) {
  if (!token) return { error: 'Admin login required.' };

  const supabase = getClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: 'Your session has expired.' };
  if (!isAdmin(data.user)) return { error: 'Admin access required.', forbidden: true };
  return { supabase, user: data.user };
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const result = await validateAdmin(getToken(request));
      if (result.error) {
        return response.status(result.forbidden ? 403 : 401).json({ error: result.error });
      }
      return response.status(200).json({ user: { email: result.user.email } });
    }

    if (request.method === 'DELETE') {
      const token = getToken(request);
      const refreshToken = request.body?.refresh_token;
      if (token && refreshToken) {
        const supabase = getClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: refreshToken
        });
        if (!sessionError) await supabase.auth.signOut({ scope: 'local' });
      }
      return response.status(204).end();
    }

    if (request.method !== 'POST') return methodNotAllowed(response, ['GET', 'POST', 'DELETE']);

    const action = request.body?.action || 'login';

    if (action === 'refresh') {
      const refreshToken = request.body?.refresh_token;
      if (!refreshToken) return response.status(401).json({ error: 'Your session has expired.' });

      const supabase = getClient();
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session || !isAdmin(data.user)) {
        return response.status(401).json({ error: 'Your session has expired.' });
      }
      return response.status(200).json({ session: publicSession(data.session) });
    }

    if (action === 'set_password') {
      const password = String(request.body?.password || '');
      if (password.length < 12) {
        return response.status(400).json({ error: 'Use a password with at least 12 characters.' });
      }

      const result = await validateAdmin(getToken(request));
      if (result.error) {
        return response.status(result.forbidden ? 403 : 401).json({ error: result.error });
      }

      const admin = getAdminClient();
      const { error } = await admin.auth.admin.updateUserById(result.user.id, { password });
      if (error) return response.status(400).json({ error: error.message });
      return response.status(200).json({ message: 'Password saved. You can use it for future logins.' });
    }

    const email = String(request.body?.email || '').trim();
    if (!email || email.toLowerCase() !== process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
      return response.status(401).json({ error: 'Invalid email or password.' });
    }

    if (action === 'magic_link') {
      const redirectUrl = process.env.SITE_URL;
      if (!redirectUrl?.startsWith('https://')) {
        throw new Error('SITE_URL must contain the production HTTPS URL.');
      }

      const supabase = getClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: false
        }
      });
      if (error) return response.status(400).json({ error: error.message });
      return response.status(200).json({ message: 'Check your email for the one-time setup link.' });
    }

    if (action !== 'login') return response.status(400).json({ error: 'Unknown authentication action.' });

    const password = String(request.body?.password || '');
    if (!password) return response.status(401).json({ error: 'Invalid email or password.' });

    const supabase = getClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session || !isAdmin(data.user)) {
      if (data?.session) await supabase.auth.signOut({ scope: 'local' });
      return response.status(401).json({ error: 'Invalid email or password.' });
    }

    return response.status(200).json({
      session: publicSession(data.session),
      message: 'Logged in.'
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Authentication failed.' });
  }
};
