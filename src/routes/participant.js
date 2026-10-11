import { db } from '../db.js';
import { newId } from '../lib/ids.js';
import { requireRole, HttpError } from '../lib/authz.js';
import { findEligibleStudies, isEligible } from '../lib/matching.js';
import { evaluateResponse } from '../lib/fraud.js';
import { createPendingReward, confirmReward, getWallet, getTransactions, requestWithdrawal } from '../lib/ledger.js';
import { rateLimit } from '../lib/http.js';

function ensureParticipant(ctx) {
  return requireRole(ctx.user, 'USER');
}

export async function getProfile(req, res, ctx) {
  const user = ensureParticipant(ctx);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  const tags = db.prepare('SELECT tag FROM user_interests WHERE user_id = ?').all(user.id).map(r => r.tag);
  return { profile, tags };
}

export async function updateProfile(req, res, ctx) {
  const user = ensureParticipant(ctx);
  const { age_range, gender, city, area, occupation_category, interests } = ctx.body;
  db.prepare(`
    UPDATE profiles SET age_range = ?, gender = ?, city = ?, area = ?, occupation_category = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(age_range || null, gender || null, city || null, area || null, occupation_category || null, user.id);

  if (Array.isArray(interests)) {
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(user.id);
    for (const tag of interests) {
      db.prepare('INSERT INTO user_interests (id, user_id, tag) VALUES (?, ?, ?)').run(newId(), user.id, tag);
    }
  }
  return { ok: true };
}

export async function listEligibleStudies(req, res, ctx) {
  const user = ensureParticipant(ctx);
  const studies = findEligibleStudies(user.id);
  return studies.map(s => ({
    id: s.id,
    title: s.title,
    objective: s.objective,
    target_city: s.target_city,
    reward_paise: s.reward_per_response_paise,
    estimated_minutes: estimateMinutes(s.id),
  }));
}

function estimateMinutes(projectId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM survey_questions WHERE research_project_id = ?').get(projectId).c;
  return Math.max(1, Math.round(count * 0.5));
}

export async function getStudyDetails(req, res, ctx) {
  const user = ensureParticipant(ctx);
  const project = db.prepare(`SELECT * FROM research_projects WHERE id = ?`).get(ctx.params.id);
  if (!project) throw new HttpError(404, 'Study not found');

  const alreadyResponded = db.prepare('SELECT * FROM survey_responses WHERE research_project_id = ? AND user_id = ?').get(project.id, user.id);

  // SECURITY FIX (found during the RLS route audit — see docs/RLS_ROUTE_AUDIT.md):
  // a participant with no relationship to this study must not be able to see
  // ANY field of it - title, objective, city, reward - unless it is ACTIVE
  // (the only status participants are meant to browse) or they already have
  // a response tied to it (so they can review something they completed even
  // after it moves to COMPLETED/ARCHIVED). Previously this returned the
  // study object for a DRAFT/SUBMITTED study to anyone who guessed its UUID,
  // before the eligibility check ever ran - eligibility is a matching
  // feature, not an access-control gate, and must not be the only thing
  // standing between a stranger and an unpublished study's contents.
  if (project.status !== 'ACTIVE' && !alreadyResponded) {
    throw new HttpError(404, 'Study not found');
  }

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  const tags = db.prepare('SELECT tag FROM user_interests WHERE user_id = ?').all(user.id).map(r => r.tag);
  const eligibility = isEligible(profile, tags, project);

  const questions = project.status === 'ACTIVE' || alreadyResponded
    ? db.prepare('SELECT id, order_index, question_text, question_type, is_required FROM survey_questions WHERE research_project_id = ? ORDER BY order_index').all(project.id)
        .map(q => ({ ...q, options: db.prepare('SELECT id, option_text, order_index FROM question_options WHERE question_id = ? ORDER BY order_index').all(q.id) }))
    : [];

  return {
    study: { id: project.id, title: project.title, objective: project.objective, target_city: project.target_city, status: project.status, reward_paise: project.reward_per_response_paise },
    eligibility,
    alreadyResponded: !!alreadyResponded,
    responseStatus: alreadyResponded ? alreadyResponded.status : null,
    questions,
  };
}

export async function submitStudy(req, res, ctx) {
  const user = ensureParticipant(ctx);
  if (!rateLimit(`submit:${user.id}`, 30, 60_000)) {
    throw new HttpError(429, 'Too many submissions, please slow down');
  }

  const project = db.prepare(`SELECT * FROM research_projects WHERE id = ?`).get(ctx.params.id);
  if (!project) throw new HttpError(404, 'Study not found');
  if (project.status !== 'ACTIVE') throw new HttpError(400, 'This study is not currently accepting responses');

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id);
  const tags = db.prepare('SELECT tag FROM user_interests WHERE user_id = ?').all(user.id).map(r => r.tag);
  const eligibility = isEligible(profile, tags, project);
  if (!eligibility.eligible) throw new HttpError(403, `Not eligible: ${eligibility.reason}`);

  const { answers, duration_seconds, device_fingerprint } = ctx.body;
  if (!Array.isArray(answers) || answers.length === 0) throw new HttpError(400, 'Answers are required');
  if (!duration_seconds || duration_seconds < 0) throw new HttpError(400, 'duration_seconds is required');

  const questions = db.prepare('SELECT * FROM survey_questions WHERE research_project_id = ?').all(project.id);
  const questionMap = new Map(questions.map(q => [q.id, q]));

  for (const q of questions) {
    if (q.is_required) {
      const a = answers.find(a => a.question_id === q.id);
      const missing = !a || (a.selected_option_ids === undefined && a.text_answer === undefined && a.rating_value === undefined);
      if (missing) throw new HttpError(400, `Required question not answered: ${q.question_text}`);
    }
  }

  // Prevent duplicate submission - the UNIQUE(research_project_id, user_id)
  // constraint on survey_responses is the real enforcement; this check just
  // gives a clean error message instead of a raw constraint failure.
  const existing = db.prepare('SELECT id FROM survey_responses WHERE research_project_id = ? AND user_id = ?').get(project.id, user.id);
  if (existing) throw new HttpError(409, 'You have already responded to this study');

  const ip = req.socket.remoteAddress || null;
  const responseId = newId();

  let insertResult;
  try {
    insertResult = db.prepare(`
      INSERT INTO survey_responses (id, research_project_id, user_id, completed_at, duration_seconds, device_fingerprint, ip_address, status)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, 'PENDING')
    `).run(responseId, project.id, user.id, duration_seconds, device_fingerprint || null, ip);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'You have already responded to this study');
    throw e;
  }

  for (const a of answers) {
    const q = questionMap.get(a.question_id);
    if (!q) continue;
    db.prepare(`
      INSERT INTO answers (id, response_id, question_id, selected_option_ids, text_answer, rating_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId(), responseId, q.id,
      a.selected_option_ids ? JSON.stringify(a.selected_option_ids) : null,
      a.text_answer ?? null,
      a.rating_value ?? null,
    );
  }

  const evalResult = evaluateResponse({
    userId: user.id,
    researchProjectId: project.id,
    durationSeconds: duration_seconds,
    questionCount: questions.length,
    answers,
    deviceFingerprint: device_fingerprint,
  });

  db.prepare('UPDATE survey_responses SET status = ?, quality_score = ? WHERE id = ?').run(evalResult.status, evalResult.qualityScore, responseId);

  if (evalResult.status === 'FLAGGED') {
    db.prepare(`
      INSERT INTO response_quality (id, response_id, flag_reasons) VALUES (?, ?, ?)
    `).run(newId(), responseId, JSON.stringify(evalResult.reasons));
    db.prepare(`
      INSERT INTO fraud_flags (id, entity_type, entity_id, reason, severity) VALUES (?, 'RESPONSE', ?, ?, 'MEDIUM')
    `).run(newId(), responseId, evalResult.reasons.join('; '));
  }

  // Reward is always created as PENDING first. Clean responses are
  // auto-confirmed (no human bottleneck for the common case); flagged
  // responses stay PENDING until an admin reviews them (see routes/admin.js).
  createPendingReward({ userId: user.id, responseId, amountPaise: project.reward_per_response_paise });
  if (evalResult.status === 'VALID') {
    confirmReward(responseId);
  }

  return {
    responseId,
    status: evalResult.status,
    message: evalResult.status === 'FLAGGED'
      ? 'Your response was submitted but flagged for quality review. Your reward is pending admin review.'
      : 'Response submitted. Reward confirmed to your wallet.',
  };
}

export async function getWalletHandler(req, res, ctx) {
  const user = ensureParticipant(ctx);
  return getWallet(user.id);
}

export async function getTransactionsHandler(req, res, ctx) {
  const user = ensureParticipant(ctx);
  return getTransactions(user.id);
}

export async function createWithdrawal(req, res, ctx) {
  const user = ensureParticipant(ctx);
  const { amount_paise, upi_id } = ctx.body;
  if (!amount_paise || amount_paise <= 0) throw new HttpError(400, 'A valid amount is required');
  if (amount_paise < 10000) throw new HttpError(400, 'Minimum withdrawal is ₹100');
  if (!upi_id) throw new HttpError(400, 'UPI ID is required');
  try {
    const w = requestWithdrawal({ userId: user.id, amountPaise: amount_paise, upiId: upi_id });
    return w;
  } catch (e) {
    throw new HttpError(e.status || 400, e.message);
  }
}

export async function listWithdrawals(req, res, ctx) {
  const user = ensureParticipant(ctx);
  return db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
}
