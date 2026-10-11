// public/js/supabase/admin.js
// WRITTEN, NOT EXECUTED. Completes the admin side. Most reads here rely
// entirely on the "admin full access X" RLS policies (002) - no Edge
// Function needed for a plain SELECT an admin is allowed to see everything
// in; only WRITES that need role-escalation-proof logic or audit_actions
// logging go through a function.

import { supabase, invoke } from './client.js';

export async function listUsers() {
  const { data, error } = await supabase.from('profiles').select('id, role, full_name, city, status, created_at').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
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
    .select('*, response_quality(flag_reasons, review_decision), research_projects(title)')
    .eq('status', 'FLAGGED');
  if (error) throw error;
  // Only rows where review_decision is still null are actually pending -
  // filtered client-side since Supabase's nested-filter syntax for "column
  // on a joined table IS NULL" is awkward inline; fine for an admin-only
  // list that's never going to be huge enough to matter for performance.
  return (data ?? []).filter((r) => !r.response_quality || r.response_quality.review_decision === null);
}

export async function reviewResponse(responseId, decision, notes) {
  return invoke('admin-review-response', { response_id: responseId, decision, notes });
}

export async function listWithdrawals(status) {
  let query = supabase.from('withdrawals').select('*, profiles(full_name)').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function markWithdrawalPaid(withdrawalId) {
  return invoke('admin-process-withdrawal', { withdrawal_id: withdrawalId, action: 'mark-paid' });
}
export async function rejectWithdrawal(withdrawalId, reason) {
  return invoke('admin-process-withdrawal', { withdrawal_id: withdrawalId, action: 'reject', reason });
}

export async function ledgerAudit() {
  const { data, error } = await supabase.from('wallet_transactions')
    .select('*, wallets(profiles(full_name))').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  return data;
  // NOTE: the Node app's ledgerAudit() also runs a full reconcileWallet()
  // pass over every user (src/lib/ledger.js). There is no equivalent
  // client-side check here - the Postgres migrations rely on 006's atomic
  // SQL functions to make a mismatch structurally hard to produce, rather
  // than a periodic reconciliation query. A real production deployment
  // should still add a scheduled reconciliation job (e.g. a
  // pg_cron-scheduled function comparing wallets.balance_paise against
  // SUM(wallet_transactions...)) - not implemented in this pass, flagged
  // as follow-up work in the final report.
}

export async function platformStats() {
  const [users, businesses, verifiedBiz, active, pending, flagged, pendingW, rewards] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'USER'),
    supabase.from('businesses').select('id', { count: 'exact', head: true }),
    supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('verification_status', 'VERIFIED'),
    supabase.from('research_projects').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('research_projects').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED'),
    supabase.from('survey_responses').select('id', { count: 'exact', head: true }).eq('status', 'FLAGGED'),
    supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'REQUESTED'),
    // No SUM aggregate in supabase-js's query builder, so this pulls the
    // raw rows and reduces client-side. Fine at P0/demo scale (hundreds to
    // low thousands of confirmed rewards); a real production admin
    // dashboard should replace this with a Postgres view or RPC doing the
    // SUM server-side once transaction volume makes "download every row"
    // impractical - not a correctness issue yet, a scaling one, and
    // explicitly not addressed further in this pass per "do not add
    // unnecessary features."
    supabase.from('wallet_transactions').select('amount_paise').eq('type', 'SURVEY_REWARD').eq('status', 'CONFIRMED'),
  ]);
  const totalRewardsPaidPaise = (rewards.data ?? []).reduce((sum, r) => sum + r.amount_paise, 0);
  return {
    totalUsers: users.count ?? 0,
    totalBusinesses: businesses.count ?? 0,
    verifiedBusinesses: verifiedBiz.count ?? 0,
    activeStudies: active.count ?? 0,
    pendingApproval: pending.count ?? 0,
    flaggedResponses: flagged.count ?? 0,
    pendingWithdrawals: pendingW.count ?? 0,
    totalRewardsPaidPaise,
  };
}
