// supabase/functions/admin-review-response/index.ts
//
// WRITTEN, NOT EXECUTED. Ports src/routes/admin.js's reviewResponse().
// Deliberately calls the ADMIN-GATED RPCs from migrations/004
// (admin_confirm_reward / admin_forfeit_reward) rather than mutating
// wallet_transactions/wallets directly, even though this function already
// runs as service role and technically could - going through the same RPC
// a client-direct admin call would use means this path is exercised and
// tested by the exact same code a future client-side admin UI would call,
// rather than a second, easily-drifting implementation of "how a reward
// gets confirmed."

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'ADMIN', 'SUPER_ADMIN');
    const { response_id, decision, notes } = await req.json();

    if (!['VALID', 'REJECTED'].includes(decision)) throw new HttpError(400, 'decision must be VALID or REJECTED');

    const { data: response } = await admin.from('survey_responses').select('*').eq('id', response_id).single();
    if (!response) throw new HttpError(404, 'Response not found');
    if (response.status !== 'FLAGGED') throw new HttpError(400, 'Only FLAGGED responses can be reviewed here');

    await admin.from('response_quality').update({
      reviewed_by: userId, review_decision: decision, review_notes: notes ?? null, reviewed_at: new Date().toISOString(),
    }).eq('response_id', response_id);

    await admin.from('survey_responses').update({ status: decision }).eq('id', response_id);

    if (decision === 'VALID') {
      const { error } = await admin.rpc('admin_confirm_reward', { p_response_id: response_id });
      if (error) throw new HttpError(500, `Reward confirmation failed: ${error.message}`);
    } else {
      const { error } = await admin.rpc('admin_forfeit_reward', { p_response_id: response_id });
      if (error) throw new HttpError(500, `Reward forfeiture failed: ${error.message}`);
      await admin.from('fraud_flags').update({ resolved: true }).eq('entity_type', 'RESPONSE').eq('entity_id', response_id);
    }

    return json({ ok: true, decision });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
