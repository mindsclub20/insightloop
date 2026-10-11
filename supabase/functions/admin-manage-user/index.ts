// supabase/functions/admin-manage-user/index.ts
// WRITTEN, NOT EXECUTED. Ports src/routes/admin.js's suspendUser/reactivateUser.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'ADMIN', 'SUPER_ADMIN');
    const { target_user_id, action, reason } = await req.json();

    if (!['suspend', 'reactivate'].includes(action)) throw new HttpError(400, `Unknown action: ${action}`);

    const { data: target } = await admin.from('profiles').select('id, role, status').eq('id', target_user_id).single();
    if (!target) throw new HttpError(404, 'User not found');

    // Same guard as src/routes/admin.js: no admin, however senior, can
    // suspend a SUPER_ADMIN through this path. There is deliberately no
    // function anywhere in this codebase that can - matching the Node
    // app's design, not loosening it for the Supabase port.
    if (target.role === 'SUPER_ADMIN') throw new HttpError(403, 'Cannot suspend a SUPER_ADMIN');

    const newStatus = action === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
    const { error } = await admin.from('profiles').update({ status: newStatus }).eq('id', target_user_id);
    if (error) throw new HttpError(500, error.message);
    // The audit_profile_status trigger (005) fires automatically on this
    // UPDATE regardless of the admin_actions insert below - that's the
    // guaranteed record. This insert adds the richer who/why.

    await admin.from('admin_actions').insert({
      admin_id: userId, action_type: action.toUpperCase() + '_USER', target_type: 'USER',
      target_id: target_user_id, notes: reason ?? null,
    });

    return json({ ok: true, status: newStatus });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
