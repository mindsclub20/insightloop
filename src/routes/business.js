import { db } from '../db.js';
import { newId } from '../lib/ids.js';
import { requireRole, requireBusinessMembership, businessIdForUser, HttpError } from '../lib/authz.js';
import { generateReport } from '../lib/report.js';
import { assertTransition } from '../lib/lifecycle.js';
import { PaymentService } from '../lib/payments/PaymentService.js';

const VALID_QUESTION_TYPES = ['single_choice', 'multi_choice', 'yes_no', 'rating_5', 'rating_10', 'short_text', 'long_text'];
const TEMPLATES = ['pricing_test', 'feature_preference', 'purchase_intent', 'satisfaction', 'timing_location', 'custom'];

function ensureBusiness(ctx) {
  requireRole(ctx.user, 'BUSINESS');
  const businessId = businessIdForUser(ctx.user.id);
  if (!businessId) throw new HttpError(403, 'No business associated with this account');
  return businessId;
}

export async function getMyBusiness(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  return db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
}

export async function createStudy(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
  if (biz.verification_status !== 'VERIFIED') {
    throw new HttpError(403, 'Business must be verified by admin before creating research (currently: ' + biz.verification_status + ')');
  }

  const {
    title, template_type, objective, target_city,
    target_min_age, target_max_age, target_gender, target_tags,
    sample_size, reward_per_response_paise, deadline,
  } = ctx.body;

  if (!title) throw new HttpError(400, 'Title is required');
  if (!template_type || !TEMPLATES.includes(template_type)) throw new HttpError(400, `template_type must be one of: ${TEMPLATES.join(', ')}`);
  if (!target_city) throw new HttpError(400, 'target_city is required');
  if (!sample_size || sample_size < 10 || sample_size > 500) throw new HttpError(400, 'sample_size must be between 10 and 500 for P0');
  if (!reward_per_response_paise || reward_per_response_paise < 100) throw new HttpError(400, 'reward_per_response_paise must be at least 100 (₹1)');

  const platformFeePaise = Math.round(sample_size * reward_per_response_paise * 0.3); // configurable margin, illustrative default
  const budgetPaise = sample_size * reward_per_response_paise + platformFeePaise;

  const id = newId();
  db.prepare(`
    INSERT INTO research_projects
      (id, business_id, title, template_type, objective, target_city, target_min_age, target_max_age, target_gender, target_tags, sample_size, budget_paise, reward_per_response_paise, deadline, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
  `).run(
    id, businessId, title, template_type, objective || null, target_city,
    target_min_age || null, target_max_age || null, target_gender || 'any',
    JSON.stringify(target_tags || []), sample_size, budgetPaise, reward_per_response_paise, deadline || null,
  );

  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(id);
}

function loadOwnedStudy(businessId, studyId) {
  const study = db.prepare('SELECT * FROM research_projects WHERE id = ?').get(studyId);
  if (!study) throw new HttpError(404, 'Study not found');
  if (study.business_id !== businessId) throw new HttpError(403, 'This study does not belong to your business');
  return study;
}

export async function updateStudy(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  if (study.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT studies can be edited');

  const fields = ['title', 'objective', 'target_city', 'target_min_age', 'target_max_age', 'target_gender', 'sample_size', 'deadline'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (ctx.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(ctx.body[f]); }
  }
  if (ctx.body.target_tags !== undefined) { updates.push('target_tags = ?'); values.push(JSON.stringify(ctx.body.target_tags)); }
  if (updates.length === 0) return study;
  values.push(study.id);
  db.prepare(`UPDATE research_projects SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id);
}

export async function addQuestion(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  if (study.status !== 'DRAFT') throw new HttpError(400, 'Can only add questions to a DRAFT study');

  const existingCount = db.prepare('SELECT COUNT(*) as c FROM survey_questions WHERE research_project_id = ?').get(study.id).c;
  if (existingCount >= 8) throw new HttpError(400, 'P0 caps studies at 8 questions to protect completion rates');

  const { question_text, question_type, is_required, options } = ctx.body;
  if (!question_text) throw new HttpError(400, 'question_text is required');
  if (!VALID_QUESTION_TYPES.includes(question_type)) throw new HttpError(400, `question_type must be one of: ${VALID_QUESTION_TYPES.join(', ')}`);
  if ((question_type === 'single_choice' || question_type === 'multi_choice') && (!options || options.length < 2)) {
    throw new HttpError(400, 'Choice questions need at least 2 options');
  }

  const qid = newId();
  db.prepare(`
    INSERT INTO survey_questions (id, research_project_id, order_index, question_text, question_type, is_required)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(qid, study.id, existingCount, question_text, question_type, is_required === false ? 0 : 1);

  if (options && options.length) {
    options.forEach((opt, idx) => {
      db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, ?)')
        .run(newId(), qid, opt, idx);
    });
  } else if (question_type === 'yes_no') {
    db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, ?)').run(newId(), qid, 'Yes', 0);
    db.prepare('INSERT INTO question_options (id, question_id, option_text, order_index) VALUES (?, ?, ?, ?)').run(newId(), qid, 'No', 1);
  }

  return db.prepare('SELECT * FROM survey_questions WHERE id = ?').get(qid);
}

export async function submitStudyForApproval(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  if (study.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT studies can be submitted');

  const questionCount = db.prepare('SELECT COUNT(*) as c FROM survey_questions WHERE research_project_id = ?').get(study.id).c;
  if (questionCount === 0) throw new HttpError(400, 'Add at least one question before submitting');

  assertTransition(study.status, 'SUBMITTED');

  // Payment creation goes through PaymentService, not a raw INSERT, so the
  // "no real gateway connected" boundary lives in exactly one place (see
  // src/lib/payments/). Admin approval still requires a payment record to
  // exist (checked in routes/admin.js), but that record can never claim
  // SUCCESS on its own - only a real PaymentProvider.confirm() call could
  // do that, and none is wired up in P0.
  const payment = PaymentService.createPaymentForStudy({ businessId, researchProjectId: study.id, amountPaise: study.budget_paise });

  db.prepare(`UPDATE research_projects SET status = 'SUBMITTED', updated_at = datetime('now') WHERE id = ?`).run(study.id);
  return { ...db.prepare('SELECT * FROM research_projects WHERE id = ?').get(study.id), paymentId: payment.id, paymentStatus: payment.status };
}

export async function cancelStudy(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  assertTransition(study.status, 'CANCELLED');
  db.prepare(`UPDATE research_projects SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(study.id);
  return { ok: true };
}

export async function listMyStudies(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  return db.prepare('SELECT * FROM research_projects WHERE business_id = ? ORDER BY created_at DESC').all(businessId);
}

export async function getMyStudy(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  const questions = db.prepare('SELECT * FROM survey_questions WHERE research_project_id = ? ORDER BY order_index').all(study.id)
    .map(q => ({ ...q, options: db.prepare('SELECT * FROM question_options WHERE question_id = ? ORDER BY order_index').all(q.id) }));
  const responseCounts = db.prepare(`
    SELECT status, COUNT(*) as c FROM survey_responses WHERE research_project_id = ? GROUP BY status
  `).all(study.id);
  return { study, questions, responseCounts };
}

// Businesses see only AGGREGATE analytics - never individual respondent
// identity. This mirrors the RLS design: research_projects/answers are
// exposed to a business only through this report view, which strips user_id.
export async function getStudyReport(req, res, ctx) {
  const businessId = ensureBusiness(ctx);
  const study = loadOwnedStudy(businessId, ctx.params.id);
  const report = generateReport(study.id);

  // First time a report is pulled for a COMPLETED study, advance it to
  // REPORT_READY - a real, auditable lifecycle event, not just a UI label.
  // Viewing the report again afterwards (status already REPORT_READY) is a
  // no-op here; assertTransition would throw on COMPLETED->COMPLETED but we
  // only attempt the transition when it's actually legal.
  if (study.status === 'COMPLETED') {
    assertTransition('COMPLETED', 'REPORT_READY');
    db.prepare(`UPDATE research_projects SET status = 'REPORT_READY', updated_at = datetime('now') WHERE id = ?`).run(study.id);
  }
  return report;
}
