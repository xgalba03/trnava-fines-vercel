const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.');
  }
  return createClient(url, key);
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const supabase = getClient();
    const { data: players, error } = await supabase
      .from('players')
      .select('id, name, jersey_number, active')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) throw error;

    return response.status(200).json({ players });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to load players.' });
  }
};
