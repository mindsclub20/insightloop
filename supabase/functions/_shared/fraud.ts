// supabase/functions/_shared/fraud.ts
//
// WRITTEN, NOT EXECUTED. Direct TypeScript port of src/lib/fraud.js's
// logic, kept deliberately identical rule-for-rule so the Node demo and the
// production Edge Function make the same call given the same input. If you
// change a threshold in one, change it in the other - there is no shared
// module between the Node and Deno runtimes here, so this duplication is a
// real maintenance cost, not an oversight. Preserving the existing
// business logic (per the brief) meant porting it faithfully rather than
// redesigning the rules while also changing runtime.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MIN_SECONDS_PER_QUESTION = 3;
const MAX_RESPONSES_PER_USER_PER_DAY = 15;

export interface AnswerInput {
  question_id: string;
  selected_option_ids?: string[];
  text_answer?: string;
  rating_value?: number;
}

export interface FraudResult {
  status: 'VALID' | 'FLAGGED';
  reasons: string[];
  qualityScore: number;
}

export async function evaluateResponse(admin: SupabaseClient, params: {
  userId: string;
  researchProjectId: string;
  durationSeconds: number;
  questionCount: number;
  answers: AnswerInput[];
  deviceFingerprint?: string | null;
}): Promise<FraudResult> {
  const { userId, researchProjectId, durationSeconds, questionCount, answers, deviceFingerprint } = params;
  const reasons: string[] = [];

  const minExpected = questionCount * MIN_SECONDS_PER_QUESTION;
  if (durationSeconds < minExpected) {
    reasons.push(`too_fast: completed in ${durationSeconds}s, expected >= ${minExpected}s for ${questionCount} questions`);
  }

  const ratingValues = answers.filter(a => a.rating_value !== undefined && a.rating_value !== null).map(a => a.rating_value as number);
  if (ratingValues.length >= 3 && new Set(ratingValues).size === 1) {
    reasons.push('straight_lining: identical rating given to every rating question');
  }

  if (deviceFingerprint) {
    const { data: dup } = await admin
      .from('survey_responses')
      .select('user_id')
      .eq('research_project_id', researchProjectId)
      .eq('device_fingerprint', deviceFingerprint)
      .neq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (dup) reasons.push('duplicate_device: another account already responded to this study from the same device');
  }

  const today = new Date().toISOString().slice(0, 10);
  const { count } = await admin
    .from('survey_responses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00Z`);
  if ((count ?? 0) >= MAX_RESPONSES_PER_USER_PER_DAY) {
    reasons.push(`abnormal_frequency: ${count} responses submitted today, exceeds platform cap`);
  }

  const status = reasons.length > 0 ? 'FLAGGED' : 'VALID';
  const qualityScore = Math.max(0, 1 - reasons.length * 0.3);
  return { status, reasons, qualityScore };
}
