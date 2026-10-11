// supabase/functions/admin-process-withdrawal/index.ts
//
// WRITTEN, NOT EXECUTED. Ports src/routes/admin.js's markWithdrawalPaidHandler
// / rejectWithdrawalHandler. CRITICAL BEHAVIOR carried over unchanged from
// the Node version: "mark paid" only RECORDS that a real UPI transfer was
// already sent manually, by a human, outside this system. This function
// performs zero real money movement - see ManualPaymentProvider.ts's
// createPayout(), which is what a real payout integration would replace
// this admin action with (a webhook-driven confirmation instead of a
// manual click), and README.md "What is still mocked/manual".

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'ADMIN', 'SUPER_ADMIN');
    const { withdrawal_id, action, reason } = await req.json();

    if (action === 'mark-paid') {
      const { data, error } = await admin.rpc('admin_mark_withdrawal_paid', { p_withdrawal_id: withdrawal_id });
      if (error) throw new HttpError(400, error.message);
      return json(data);
    }
    if (action === 'reject') {
      const { data, error } = await admin.rpc('admin_reject_withdrawal', { p_withdrawal_id: withdrawal_id, p_reason: reason ?? null });
      if (error) throw new HttpError(400, error.message);
      return json(data);
    }
    throw new HttpError(400, `Unknown action: ${action}`);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
