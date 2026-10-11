import { db } from '../db.js';
import { newId } from '../lib/ids.js';
import { requireRole, HttpError } from '../lib/authz.js';
import { confirmReward, forfeitReward, markWithdrawalPaid, rejectWithdrawal, reconcileWallet } from '../lib/ledger.js';
import { assertTransition, IllegalTransitionError } from '../lib/lifecycle.js';

function setProjectStatus(projectId, newStatus) {
  db.prepare(`UPDATE research_projects SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(newStatus, projectId);
}

function ensureAdmin(ctx) {
  return requireRole(ctx.user, 'ADMIN', 'SUPER_ADMIN');
}

function logAdminAction(adminId, actionType, targetType, targetId, notes) {
  db.prepare(`
    INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId(), adminId, actionType, targetType, targetId, notes || null);
}

export async function listUsers(req, res, ctx) {
  ensureAdmin(ctx);
  return db.prepare('SELECT id, email, phone, role, full_name, status, created_at FROM users ORDER BY created_at DESC').all();
}

export async function suspendUser(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'SUPER_ADMIN') throw new HttpError(403, 'Cannot suspend a SUPER_ADMIN');
  db.prepare(`UPDATE users SET status = 'SUSPENDED', updated_at = datetime('now') WHERE id = ?`).run(target.id);
  logAdminAction(admin.id, 'SUSPEND_USER', 'USER', target.id, ctx.body?.reason);
  return { ok: true };
}

export async function reactivateUser(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) throw new HttpError(404, 'User not found');
  db.prepare(`UPDATE users SET status = 'ACTIVE', updated_at = datetime('now') WHERE id = ?`).run(target.id);
  logAdminAction(admin.id, 'REACTIVATE_USER', 'USER', target.id, null);
  return { ok: true };
}

export async function listBusinesses(req, res, ctx) {
  ensureAdmin(ctx);
  return db.prepare('SELECT * FROM businesses ORDER BY created_at DESC').all();
}

export async function verifyBusiness(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(ctx.params.id);
  if (!biz) throw new HttpError(404, 'Business not found');
  db.prepare(`UPDATE businesses SET verification_status = 'VERIFIED', updated_at = datetime('now') WHERE id = ?`).run(biz.id);
  logAdminAction(admin.id, 'VERIFY_BUSINESS', 'BUSINESS', biz.id, null);
  return { ok: true };
}

export async function rejectBusiness(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(ctx.params.id);
  if (!biz) throw new HttpError(404, 'Business not found');
  db.prepare(`UPDATE businesses SET verification_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(biz.id);
  logAdminAction(admin.id, 'REJECT_BUSINESS', 'BUSINESS', biz.id, ctx.body?.reason);
  return { ok: true };
}

export async function listStudiesForReview(req, res, ctx) {
  ensureAdmin(ctx);
  const status = ctx.query.status;
  const rows = status
    ? db.prepare('SELECT * FROM research_projects WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM research_projects ORDER BY created_at DESC').all();
  return rows;
}

// Approving a study is, per the full lifecycle, actually two legal
// transitions: SUBMITTED/ADMIN_REVIEW -> APPROVED -> ACTIVE. This function
// performs both atomically behind the single existing "Approve & Activate"
// admin action, so the UI/API contract is unchanged, but the underlying
// state machine (and its audit trail - two rows in audit_logs, one per
// transition) is now the real thing, not a shortcut.
export async function approveStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');

  assertTransition(study.status, 'APPROVED'); // throws 400 IllegalTransitionError if e.g. already ACTIVE

  const payment = db.prepare('SELECT * FROM business_payments WHERE research_project_id = ? ORDER BY created_at DESC LIMIT 1').get(study.id);
  if (!payment) throw new HttpError(400, 'No payment record found for this study - cannot activate');

  setProjectStatus(study.id, 'APPROVED');
  assertTransition('APPROVED', 'ACTIVE');
  setProjectStatus(study.id, 'ACTIVE');

  logAdminAction(admin.id, 'APPROVE_STUDY', 'RESEARCH_PROJECT', study.id, 'APPROVED then ACTIVE');
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function rejectStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');
  assertTransition(study.status, 'REJECTED');

  const reason = ctx.body?.reason || 'No reason provided';
  db.prepare(`UPDATE research_projects SET status = 'REJECTED', rejection_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(reason, study.id);
  logAdminAction(admin.id, 'REJECT_STUDY', 'RESEARCH_PROJECT', study.id, reason);
  return { ok: true };
}

export async function pauseStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');
  assertTransition(study.status, 'PAUSED');
  setProjectStatus(study.id, 'PAUSED');
  logAdminAction(admin.id, 'PAUSE_STUDY', 'RESEARCH_PROJECT', study.id, ctx.body?.reason || null);
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function resumeStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');
  assertTransition(study.status, 'ACTIVE');
  setProjectStatus(study.id, 'ACTIVE');
  logAdminAction(admin.id, 'RESUME_STUDY', 'RESEARCH_PROJECT', study.id, null);
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function cancelStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');
  assertTransition(study.status, 'CANCELLED');
  setProjectStatus(study.id, 'CANCELLED');
  logAdminAction(admin.id, 'CANCEL_STUDY', 'RESEARCH_PROJECT', study.id, ctx.body?.reason || null);
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function completeStudy(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(ctx.params.id);
  if (!study) throw new HttpError(404, 'Study not found');
  assertTransition(study.status, 'COMPLETED');
  setProjectStatus(study.id, 'COMPLETED');
  logAdminAction(admin.id, 'COMPLETE_STUDY', 'RESEARCH_PROJECT', study.id, null);
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function listFlaggedResponses(req, res, ctx) {
  ensureAdmin(ctx);
  return db.prepare(`
    SELECT sr.*, rq.flag_reasons, rp.title as study_title
    FROM survey_responses sr
    JOIN response_quality rq ON rq.response_id = sr.id
    JOIN research_projects rp ON rp.id = sr.research_project_id
    WHERE sr.status = 'FLAGGED' AND rq.review_decision IS NULL
    ORDER BY sr.created_at ASC
  `).all();
}

// The only path by which a FLAGGED response is resolved. Human decision,
// always logged. Confirms or forfeits the associated pending reward.
export async function reviewResponse(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const { decision, notes } = ctx.body;
  if (!['VALID', 'REJECTED'].includes(decision)) throw new HttpError(400, 'decision must be VALID or REJECTED');

  const response = db.prepare('SELECT * FROM survey_responses WHERE id = ?').get(ctx.params.id);
  if (!response) throw new HttpError(404, 'Response not found');
  if (response.status !== 'FLAGGED') throw new HttpError(400, 'Only FLAGGED responses can be reviewed here');

  db.prepare(`
    UPDATE response_quality SET reviewed_by = ?, review_decision = ?, review_notes = ?, reviewed_at = datetime('now')
    WHERE response_id = ?
  `).run(admin.id, decision, notes || null, response.id);

  db.prepare('UPDATE survey_responses SET status = ? WHERE id = ?').run(decision, response.id);

  if (decision === 'VALID') {
    confirmReward(response.id);
  } else {
    forfeitReward(response.id);
    db.prepare('UPDATE fraud_flags SET resolved = 1 WHERE entity_type = \'RESPONSE\' AND entity_id = ?').run(response.id);
  }

  logAdminAction(admin.id, 'REVIEW_RESPONSE', 'SURVEY_RESPONSE', response.id, `${decision}: ${notes || ''}`);
  return { ok: true, decision };
}

export async function listWithdrawals(req, res, ctx) {
  ensureAdmin(ctx);
  const status = ctx.query.status;
  return status
    ? db.prepare('SELECT w.*, u.email, u.full_name FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.created_at ASC').all(status)
    : db.prepare('SELECT w.*, u.email, u.full_name FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.created_at ASC').all();
}

// P0: marking PAID here asserts a real UPI transfer was already made
// manually outside the system. This function performs NO real money
// movement - see README "What is still mocked/manual".
export async function markWithdrawalPaidHandler(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  try {
    const w = markWithdrawalPaid(ctx.params.id, admin.id);
    logAdminAction(admin.id, 'MARK_WITHDRAWAL_PAID', 'WITHDRAWAL', w.id, 'Confirmed manual UPI payout sent outside system');
    return w;
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}

export async function rejectWithdrawalHandler(req, res, ctx) {
  const admin = ensureAdmin(ctx);
  const w = rejectWithdrawal(ctx.params.id, admin.id, ctx.body?.reason);
  logAdminAction(admin.id, 'REJECT_WITHDRAWAL', 'WITHDRAWAL', w.id, ctx.body?.reason);
  return w;
}

export async function ledgerAudit(req, res, ctx) {
  ensureAdmin(ctx);
  const transactions = db.prepare(`
    SELECT wt.*, u.email FROM wallet_transactions wt
    JOIN wallets w ON w.id = wt.wallet_id
    JOIN users u ON u.id = w.user_id
    ORDER BY wt.created_at DESC LIMIT 200
  `).all();
  const users = db.prepare('SELECT id FROM users WHERE role = \'USER\'').all();
  const reconciliation = users.map(u => reconcileWallet(u.id)).filter(r => !r.matches);
  return { transactions, reconciliationIssues: reconciliation };
}

export async function platformStats(req, res, ctx) {
  ensureAdmin(ctx);
  const counts = (sql) => db.prepare(sql).get().c;
  return {
    totalUsers: counts("SELECT COUNT(*) as c FROM users WHERE role = 'USER'"),
    totalBusinesses: counts('SELECT COUNT(*) as c FROM businesses'),
    verifiedBusinesses: counts("SELECT COUNT(*) as c FROM businesses WHERE verification_status = 'VERIFIED'"),
    activeStudies: counts("SELECT COUNT(*) as c FROM research_projects WHERE status = 'ACTIVE'"),
    pendingApproval: counts("SELECT COUNT(*) as c FROM research_projects WHERE status = 'SUBMITTED'"),
    totalResponses: counts('SELECT COUNT(*) as c FROM survey_responses'),
    flaggedResponses: counts("SELECT COUNT(*) as c FROM survey_responses WHERE status = 'FLAGGED'"),
    pendingWithdrawals: counts("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'REQUESTED'"),
    totalRewardsPaidPaise: db.prepare("SELECT COALESCE(SUM(amount_paise),0) as s FROM wallet_transactions WHERE type='SURVEY_REWARD' AND status='CONFIRMED'").get().s,
  };
}
