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

    if (request.method === 'GET') {
      const supabase = getClient(process.env.SUPABASE_ANON_KEY);
      const { data: fines, error } = await supabase
        .from('fines')
        .select('id, player_id, description, amount, occurred_at, created_at, player:players(name)')
        .order('occurred_at', { ascending: false });
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

    const { player_id: playerIdValue, description, amount } = request.body || {};
    const playerId = Number(playerIdValue);
    const cleanDescription = String(description || '').trim();
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) {
      return response.status(400).json({ error: 'Select an active player.' });
    }
    if (!cleanDescription || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return response.status(400).json({ error: 'Enter a description and a positive amount.' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, active')
      .eq('id', playerId)
      .maybeSingle();
    if (playerError) throw playerError;
    if (!player?.active) {
      return response.status(400).json({ error: 'Select an active player.' });
    }

    const { error: insertError } = await supabase
      .from('fines')
      .insert({
        user_id: user.id,
        player_id: playerId,
        name: cleanDescription,
        description: cleanDescription,
        amount: numericAmount,
        occurred_at: new Date().toISOString(),
        type: 'normal',
        source: 'manual'
      });
    if (insertError) {
      if (insertError.code === '42501') {
        throw new Error('Database permissions are not configured for player fines. Run database/002-players-and-fine-events.sql in Supabase.');
      }
      throw insertError;
    }

    return module.exports({ method: 'GET', headers: {} }, response);
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Database request failed.' });
  }
};
