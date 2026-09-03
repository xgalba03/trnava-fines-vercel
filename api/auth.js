const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.');
  return createClient(url, key);
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
    const { email } = request.body || {};
    if (!email || email.toLowerCase() !== process.env.ADMIN_EMAIL?.toLowerCase()) {
      return response.status(403).json({ error: 'Only the configured admin can request a login link.' });
    }

    const supabase = getClient();
    const result = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: process.env.SITE_URL || request.headers.origin }
    });
    if (result.error) return response.status(400).json({ error: result.error.message });
    return response.status(200).json({ message: 'Check your email for the login link.' });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Authentication failed.' });
  }
};