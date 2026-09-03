const { createClient } = require('@supabase/supabase-js');

function getClient(key, token) {
  const url = process.env.SUPABASE_URL;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variable.');
  }
  const options = token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {};
  return createClient(url, key, options);
}

module.exports = async function handler(request, response) {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (request.method === 'GET') {
      const supabase = getClient(serviceKey);
      const { data: fines, error } = await supabase
        .from('fines')
        .select('id, description, amount, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return response.status(200).json({ fines });
    }

    if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
    if (!token) return response.status(401).json({ error: 'Admin login required to add a fine.' });
    const supabase = getClient(process.env.SUPABASE_ANON_KEY, token);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return response.status(401).json({ error: 'Your session has expired.' });
    if (!process.env.ADMIN_EMAIL || user.email?.toLowerCase() !== process.env.ADMIN_EMAIL.toLowerCase()) {
      return response.status(403).json({ error: 'Only the configured admin can add fines.' });
    }

    const { description, amount } = request.body || {};
    const cleanDescription = String(description || '').trim();
    const numericAmount = Number(amount);
    if (!cleanDescription || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return response.status(400).json({ error: 'Enter a description and a positive amount.' });
    }

    const { error: insertError } = await supabase
      .from('fines')
      .insert({ user_id: user.id, description: cleanDescription, amount: numericAmount });
    if (insertError) {
      if (insertError.code === '42501') {
        throw new Error('Database RLS is not configured for authenticated inserts. Run repair-rls.sql in Supabase.');
      }
      throw insertError;
    }

    return module.exports({ method: 'GET', headers: {} }, response);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Database request failed.' });
  }
};