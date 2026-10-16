// supabase/functions/admin-study-action/index.ts
//
// WRITTEN, NOT EXECUTED. Combines src/routes/admin.js's approveStudy /
// rejectStudy / pauseStudy / resumeStudy / cancelStudy / completeStudy into
// one function dispatching on an `action` field, to keep the Edge Function
// count manageable - each action is still exactly the same checks and
// transition as its Node counterpart, just not given its own deployed
// function. Split these back into separate functions if your deployment
// pipeline wants per-action logs/metrics/rate-limits.
//
// A business's own cancel-own-study action is intentionally a SEPARATE
// function (business-cancel-study, not shown here but following this exact
// pattern with requireRole(req, admin, 'BUSINESS') + an ownership check) -
// mixing "things an admin can do to anyone's study" and "the one thing a
// business can do to its own study" in a single dispatcher would make the
// authorization logic harder to audit at a glance, which is exactly the
// failure mode docs/RLS_ROUTE_AUDIT.md exists to catch.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';
import { canTransition } from '../_shared/lifecycle.ts';

const ACTION_TARGET: Record<string, string> = {
  approve: 'APPROVED', // then a second transition to ACTIVE below, same two-step as the Node version
  reject: 'REJECTED',
  pause: 'PAUSED',
  resume: 'ACTIVE',
  cancel: 'CANCELLED',
  complete: 'COMPLETED',
};

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'ADMIN', 'SUPER_ADMIN');
    const { research_project_id, action, reason } = await req.json();

    if (!ACTION_TARGET[action]) throw new HttpError(400, `Unknown action: ${action}`);

    const { data: project } = await admin.from('research_projects').select('*').eq('id', research_project_id).single();
    if (!project) throw new HttpError(404, 'Study not found');

    const target = ACTION_TARGET[action];
    if (!canTransition(project.status, target)) {
      throw new HttpError(400, `Illegal study status transition: ${project.status} -> ${target}`);
    }

    if (action === 'approve') {
      const { data: payment, error: paymentError } = await admin.from('business_payments').select('id,status')
        .eq('research_project_id', research_project_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (paymentError) throw new HttpError(500, paymentError.message);
      if (!payment) throw new HttpError(400, 'No payment record found for this study - cannot activate');
      if (payment.status !== 'SUCCESS') {
        throw new HttpError(400, 'Reward funding is not confirmed. This survey cannot be activated until payment status is SUCCESS.');
      }

      const { error: approveError } = await admin.from('research_projects')
        .update({ status: 'APPROVED' }).eq('id', research_project_id).eq('status', project.status);
      if (approveError) throw new HttpError(500, approveError.message);
      if (!canTransition('APPROVED', 'ACTIVE')) throw new HttpError(500, 'Lifecycle graph inconsistency: APPROVED -> ACTIVE should always be legal');
      const { error: activateError } = await admin.from('research_projects')
        .update({ status: 'ACTIVE' }).eq('id', research_project_id).eq('status', 'APPROVED');
      if (activateError) throw new HttpError(500, activateError.message);
    } else if (action === 'reject') {
      await admin.from('research_projects').update({ status: 'REJECTED', rejection_reason: reason ?? 'No reason provided' }).eq('id', research_project_id);
    } else {
      await admin.from('research_projects').update({ status: target }).eq('id', research_project_id);
    }

    await admin.from('admin_actions').insert({
      admin_id: userId, action_type: action.toUpperCase() + '_STUDY', target_type: 'RESEARCH_PROJECT',
      target_id: research_project_id, notes: reason ?? null,
    });
    // audit_logs itself is also populated automatically by the
    // audit_project_status trigger (005) regardless of this admin_actions
    // insert - this call is for the richer admin_actions record (who, why),
    // the trigger is the guaranteed-fires-regardless backstop (see 005's
    // header comment).

    const { data: final } = await admin.from('research_projects').select('*').eq('id', research_project_id).single();
    return json(final);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
