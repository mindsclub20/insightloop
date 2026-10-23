// public/js/supabase/admin.js
// WRITTEN, NOT EXECUTED. Completes the admin side. Most reads here rely
// entirely on the "admin full access X" RLS policies (002) - no Edge
// Function needed for a plain SELECT an admin is allowed to see everything
// in; only WRITES that need role-escalation-proof logic or audit_actions
// logging go through a function.

import { supabase, invoke } from './client.js';

export async function listUsers() {
  throw new Error('Participant personal details are restricted and are not available in the admin dashboard.');
}

export async function suspendUser(targetUserId, reason) {
  return invoke('admin-manage-user', { target_user_id: targetUserId, action: 'suspend', reason });
}
export async function reactivateUser(targetUserId) {
  return invoke('admin-manage-user', { target_user_id: targetUserId, action: 'reactivate' });
}

export async function listBusinesses() {
  const { data, error } = await supabase.from('businesses').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function verifyBusiness(businessId) {
  return invoke('admin-manage-business', { business_id: businessId, action: 'verify' });
}
export async function rejectBusiness(businessId, reason) {
  return invoke('admin-manage-business', { business_id: businessId, action: 'reject', reason });
}

export async function listStudies(status) {
  let query = supabase.from('research_projects').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Covers approve/reject/pause/resume/cancel/complete - all six map to the
// single admin-study-action Edge Function (see that function's header
// comment for why they're combined rather than six separate deployments).
export async function studyAction(researchProjectId, action, reason) {
  return invoke('admin-study-action', { research_project_id: researchProjectId, action, reason });
}

export async function listFlaggedResponses() {
  const { data, error } = await supabase.from('survey_responses')
    .select('id,research_project_id,completed_at,duration_seconds,status,quality_score,response_quality(flag_reasons, review_decision),research_projects(title)')
    .eq('status', 'FLAGGED');
  if (error) throw error;
  // Only rows where review_decision is still null are actually pending -
  // filtered client-side since Supabase's nested-filter syntax for "column
  // on a joined table IS NULL" is awkward inline; fine for an admin-only
  // list that's never going to be huge enough to matter for performance.
  return (data ?? []).filter((r) => !r.response_quality || r.response_quality.review_decision === null);
}

export async function listSurveyResponses() {
  const { data, error } = await supabase.from('survey_responses')
    .select('id,research_project_id,completed_at,duration_seconds,status,quality_score,research_projects(title),answers(id,question_id,selected_option_ids,text_answer,rating_value,survey_questions(question_text,question_type,question_options(id,option_text)))')
    .order('completed_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function reviewResponse(responseId, decision, notes) {
  return invoke('admin-review-response', { response_id: responseId, decision, notes });
}

// Cash withdrawals and the legacy cash wallet are disabled in the current token-based product.
export async function listWithdrawals() {
  throw new Error('Cash withdrawals are not available in the current token-based version.');
}
export async function markWithdrawalPaid() {
  throw new Error('Cash payouts are disabled. Anvesh currently uses internal tokens.');
}
export async function rejectWithdrawal() {
  throw new Error('Cash withdrawals are not available in the current token-based version.');
}
export async function ledgerAudit() {
  return [];
}

export async function platformStats() {
  const [businesses, active, pending, flagged] = await Promise.all([
    supabase.from('businesses').select('id', { count: 'exact', head: true }),
    supabase.from('research_projects').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('research_projects').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED'),
    supabase.from('survey_responses').select('id', { count: 'exact', head: true }).eq('status', 'FLAGGED'),
  ]);
  for (const result of [businesses, active, pending, flagged]) {
    if (result.error) throw result.error;
  }
  return {
    totalBusinesses: businesses.count ?? 0,
    activeStudies: active.count ?? 0,
    pendingApproval: pending.count ?? 0,
    flaggedResponses: flagged.count ?? 0,
  };
}
