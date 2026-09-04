const { createSupabaseClient, requireAdmin } = require('./_lib/supabase');

async function listObjections(supabase) {
  const { data, error } = await supabase
    .from('objections')
    .select([
      'id', 'fine_id', 'player_id', 'status', 'reason', 'filing_fee_amount',
      'accepted_credit_amount', 'fee_fine_id', 'resolution_note', 'submitted_at',
      'resolved_at', 'player:players(id, name)', 'fine:fines(id, name, amount, occurred_at)'
    ].join(', '))
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

module.exports = async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const supabase = createSupabaseClient();
      return response.status(200).json({ objections: await listObjections(supabase) });
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Method not allowed.' });
    }

    const auth = await requireAdmin(request);
    if (auth.error) return response.status(auth.status).json({ error: auth.error });
    const { supabase } = auth;
    const body = request.body || {};
    const action = String(body.action || 'submit');

    if (action === 'submit') {
      const fineId = Number(body.fine_id);
      const reason = String(body.reason || '').trim();
      if (!Number.isSafeInteger(fineId) || fineId <= 0 || !reason) {
        return response.status(400).json({ error: 'Fine and objection reason are required.' });
      }
      const { error } = await supabase.rpc('submit_objection', {
        requested_fine_id: fineId,
        objection_reason: reason
      });
      if (error) throw error;
    } else if (action === 'resolve') {
      const objectionId = Number(body.objection_id);
      const decision = String(body.decision || '');
      if (!Number.isSafeInteger(objectionId) || objectionId <= 0 || !['accepted', 'rejected'].includes(decision)) {
        return response.status(400).json({ error: 'Objection and accepted/rejected decision are required.' });
      }
      const { error } = await supabase.rpc('resolve_objection', {
        requested_objection_id: objectionId,
        decision,
        decision_note: String(body.note || '').trim() || null
      });
      if (error) throw error;
    } else {
      return response.status(400).json({ error: 'Unknown objection action.' });
    }

    return response.status(200).json({ objections: await listObjections(supabase) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || 'Unable to manage objections.' });
  }
};
