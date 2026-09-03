const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }
  return createClient(url, key);
}

module.exports = async function handler(request, response) {
  try {
    const supabase = getClient();

    if (request.method === 'POST') {
      const { description, amount } = request.body || {};
      const cleanDescription = String(description || '').trim();
      const numericAmount = Number(amount);
      if (!cleanDescription || !Number.isFinite(numericAmount) || numericAmount <= 0) {
        return response.status(400).json({ error: 'Enter a description and a positive amount.' });
      }

      const { error: insertError } = await supabase
        .from('fines')
        .insert({ description: cleanDescription, amount: numericAmount });
      if (insertError) throw insertError;
    } else if (request.method !== 'GET') {
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const { data: fines, error } = await supabase
      .from('fines')
      .select('id, description, amount, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;

    return response.status(200).json({ fines });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Database request failed.' });
  }
};