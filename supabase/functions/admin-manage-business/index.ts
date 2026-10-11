// supabase/functions/admin-manage-business/index.ts
// WRITTEN, NOT EXECUTED. Ports src/routes/admin.js's verifyBusiness/rejectBusiness.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'ADMIN', 'SUPER_ADMIN');
    const { business_id, action, reason } = await req.json();

    if (!['verify', 'reject'].includes(action)) throw new HttpError(400, `Unknown action: ${action}`);

    const { data: business } = await admin.from('businesses').select('id, verification_status').eq('id', business_id).single();
    if (!business) throw new HttpError(404, 'Business not found');

    const newStatus = action === 'verify' ? 'VERIFIED' : 'REJECTED';
    const { error } = await admin.from('businesses').update({ verification_status: newStatus }).eq('id', business_id);
    if (error) throw new HttpError(500, error.message);
    // audit_business_verification trigger (005) fires automatically here too.

    await admin.from('admin_actions').insert({
      admin_id: userId, action_type: action.toUpperCase() + '_BUSINESS', target_type: 'BUSINESS',
      target_id: business_id, notes: reason ?? null,
    });

    return json({ ok: true, status: newStatus });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
