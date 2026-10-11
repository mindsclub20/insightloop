// src/lib/fraud.js
//
// IMPORTANT: these are practical, rule-based heuristics for P0. They reduce
// obviously bad-faith activity; they do NOT constitute reliable fraud
// detection and must never be described to users or businesses as
// guaranteeing authentic responses. Anything these rules flag goes to a
// human admin review queue (see routes/admin.js reviewResponse) — the
// automated system only ever FLAGS, it never auto-rejects and auto-forfeits
// a reward without a human decision recorded in response_quality.

import { db } from '../db.js';

const MIN_SECONDS_PER_QUESTION = 3; // below this, treat as "too fast to have read the question"
const MAX_RESPONSES_PER_USER_PER_DAY = 15;

export function evaluateResponse({ userId, researchProjectId, durationSeconds, questionCount, answers, deviceFingerprint }) {
  const reasons = [];

  // 1. Completion speed check
  const minExpected = questionCount * MIN_SECONDS_PER_QUESTION;
  if (durationSeconds < minExpected) {
    reasons.push(`too_fast: completed in ${durationSeconds}s, expected >= ${minExpected}s for ${questionCount} questions`);
  }

  // 2. Straight-lining check on rating questions
  const ratingValues = answers.filter(a => a.rating_value !== undefined && a.rating_value !== null).map(a => a.rating_value);
  if (ratingValues.length >= 3 && new Set(ratingValues).size === 1) {
    reasons.push('straight_lining: identical rating given to every rating question');
  }

  // 3. Empty/near-empty text answers on long_text/short_text required questions handled by
  //    the route's own required-field validation before this runs (not a fraud signal by itself).

  // 4. Duplicate device fingerprint on this same study (different account, same device)
  if (deviceFingerprint) {
    const dup = db.prepare(`
      SELECT user_id FROM survey_responses
      WHERE research_project_id = ? AND device_fingerprint = ? AND user_id != ?
    `).get(researchProjectId, deviceFingerprint, userId);
    if (dup) {
      reasons.push(`duplicate_device: another account already responded to this study from the same device`);
    }
  }

  // 5. Abnormal frequency: too many responses across the platform in one day
  const todayCount = db.prepare(`
    SELECT COUNT(*) as c FROM survey_responses
    WHERE user_id = ? AND date(created_at) = date('now')
  `).get(userId).c;
  if (todayCount >= MAX_RESPONSES_PER_USER_PER_DAY) {
    reasons.push(`abnormal_frequency: ${todayCount} responses submitted today, exceeds platform cap`);
  }

  const status = reasons.length > 0 ? 'FLAGGED' : 'VALID';
  // Simple 0-1 quality score: 1.0 minus a penalty per triggered rule, floor 0.
  const qualityScore = Math.max(0, 1 - reasons.length * 0.3);

  return { status, reasons, qualityScore };
}
