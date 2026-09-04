const { requireAdmin } = require('./_lib/supabase');
const { scheduleBirthdays } = require('./_lib/birthday-scheduler');

module.exports = async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }
    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const seasonId = request.body?.season_id ? Number(request.body.season_id) : null;
    let query = auth.supabase.from('seasons').select('id, name, start_date, end_date');
    query = seasonId ? query.eq('id', seasonId) : query.eq('active', true);
    const { data: seasons, error } = await query.order('start_date', { ascending: false }).limit(1);
    if (error) throw error;
    if (!seasons?.length) return response.status(400).json({ error: 'No matching season is available.' });
    const count = await scheduleBirthdays(auth.supabase, auth.user.id, seasons[0]);
    return response.status(200).json({ message: `Scheduled ${count} birthday obligation${count === 1 ? '' : 's'}.`, count });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to schedule birthdays.' });
  }
};
