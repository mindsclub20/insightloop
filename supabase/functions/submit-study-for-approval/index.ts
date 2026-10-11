// supabase/functions/submit-study-for-approval/index.ts
// WRITTEN, NOT EXECUTED. Ports src/routes/business.js's submitStudyForApproval().
// Payment creation logic mirrors src/lib/payments/PaymentService.js /
// ManualPaymentProvider.js exactly - still MANUAL_PENDING, still no real
// gateway, for the same documented reasons.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';
import { canTransition } from '../_shared/lifecycle.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const { research_project_id } = await req.json();

    const { data: project } = await admin.from('research_projects').select('*').eq('id', research_project_id).single();
    if (!project) throw new HttpError(404, 'Study not found');

    const { data: membership } = await admin.from('business_members')
      .select('business_id').eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (!membership) throw new HttpError(403, 'This study does not belong to your business');

    if (!canTransition(project.status, 'SUBMITTED')) {
      throw new HttpError(400, `Illegal study status transition: ${project.status} -> SUBMITTED`);
    }

    const { count } = await admin.from('survey_questions').select('id', { count: 'exact', head: true }).eq('research_project_id', research_project_id);
    if (!count) throw new HttpError(400, 'Add at least one question before submitting');

    // NO REAL PAYMENT GATEWAY — see ManualPaymentProvider.js's Node twin.
    // This is a bookkeeping row, never SUCCESS, exactly as in the Node app.
    const { data: payment, error: paymentErr } = await admin.from('business_payments').insert({
      business_id: project.business_id, research_project_id, amount_paise: project.budget_paise,
      gateway_reference: `manual-${crypto.randomUUID()}`, status: 'MANUAL_PENDING',
    }).select().single();
    if (paymentErr) throw new HttpError(500, paymentErr.message);

    // The 003 trigger re-validates this transition at the database level
    // regardless of the canTransition() check above - this update is
    // rejected by Postgres itself if the two ever disagree.
    const { data: updated, error: updateErr } = await admin.from('research_projects')
      .update({ status: 'SUBMITTED' }).eq('id', research_project_id).select().single();
    if (updateErr) throw new HttpError(400, updateErr.message);

    return json({ ...updated, paymentId: payment.id, paymentStatus: payment.status });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
