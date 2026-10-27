// supabase/functions/submit-survey-response/index.ts
//
// WRITTEN, NOT EXECUTED — see docs/SUPABASE_SETUP.md for deployment and
// smoke-test steps. Direct port of src/routes/participant.js's
// submitStudy(), preserving every check in the same order: eligibility
// re-verified server-side (never trusts the client's claim), required-field
// validation, duplicate-response rejection, fraud evaluation, then reward
// creation via the SAME two-step pending→confirm pattern as the Node
// version (ledger.js's createPendingReward + confirmReward), just
// reimplemented against Postgres directly since this function runs with
// the service role and therefore bypasses RLS by design — it re-does the
// authorization checks in code instead, exactly like every other function
// in this directory.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireProfile, HttpError } from '../_shared/supabase.ts';
import { corsHeaders, handleOptions, json } from '../_shared/cors.ts';
import { evaluateResponse, AnswerInput } from '../_shared/fraud.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId, profile } = await requireProfile(req, admin);
    if (profile.role !== 'USER') throw new HttpError(403, 'Only participants can submit survey responses');

    const body = await req.json();
    const { research_project_id, answers, duration_seconds, device_fingerprint } = body as {
      research_project_id: string; answers: AnswerInput[]; duration_seconds: number; device_fingerprint?: string;
    };
    if (!research_project_id) throw new HttpError(400, 'research_project_id is required');
    if (!Array.isArray(answers) || answers.length === 0) throw new HttpError(400, 'Answers are required');
    if (!duration_seconds || duration_seconds < 0) throw new HttpError(400, 'duration_seconds is required');

    const { data: project, error: projectErr } = await admin
      .from('research_projects').select('*').eq('id', research_project_id).single();
    if (projectErr || !project) throw new HttpError(404, 'Study not found');
    if (project.status !== 'ACTIVE') throw new HttpError(400, 'This study is not currently accepting responses');

    // Server-side eligibility re-check - never trust the client's claim of
    // eligibility, exactly per the original brief's matching-engine
    // requirement, preserved unchanged from the Node version's design.
    const { data: profileRow } = await admin.from('profiles').select('*').eq('id', userId).single();
    const { data: tagRows } = await admin.from('user_interests').select('tag').eq('user_id', userId);
    const tags = (tagRows ?? []).map((r: { tag: string }) => r.tag);

    if (profileRow?.city && project.target_city && profileRow.city.toLowerCase() !== project.target_city.toLowerCase()) {
      throw new HttpError(403, `Not eligible: study is for ${project.target_city}`);
    }
    if (project.target_tags?.length) {
      const required = project.target_tags as string[];
      if (!required.some((t) => tags.includes(t))) {
        throw new HttpError(403, `Not eligible: study requires interest in ${required.join(', ')}`);
      }
    }

    const { data: questions } = await admin
      .from('survey_questions').select('*').eq('research_project_id', research_project_id);
    if (!questions) throw new HttpError(500, 'Could not load questions');

    for (const q of questions) {
      if (q.is_required) {
        const a = answers.find((a) => a.question_id === q.id);
        const missing = !a || (a.selected_option_ids === undefined && a.text_answer === undefined && a.rating_value === undefined);
        if (missing) throw new HttpError(400, `Required question not answered: ${q.question_text}`);
      }
    }

    // Duplicate prevention: rely on the UNIQUE(research_project_id, user_id)
    // constraint (001) as the real enforcement, exactly like the Node
    // version - this pre-check just produces a clean 409 instead of a raw
    // Postgres constraint-violation error.
    const { data: existing } = await admin
      .from('survey_responses').select('id')
      .eq('research_project_id', research_project_id).eq('user_id', userId).maybeSingle();
    if (existing) throw new HttpError(409, 'You have already responded to this study');

    const fraud = await evaluateResponse(admin, {
      userId, researchProjectId: research_project_id, durationSeconds: duration_seconds,
      questionCount: questions.length, answers, deviceFingerprint: device_fingerprint,
    });

    // Token-funded submissions must use one database transaction for response,
    // answers, wallet credit, ledger entry, and reserved-budget decrement.
    // This prevents a network failure after a successful reward RPC from leaving
    // a paid token transaction without its corresponding response.
    const tokenMode = project.token_funding_status === 'FUNDED' || project.token_funding_status === 'EXHAUSTED';
    if (tokenMode) {
      if (project.token_funding_status !== 'FUNDED' ||
          Number(project.tokens_reserved) < Number(project.reward_per_response_tokens) ||
          Number(project.token_rewards_paid) >= Number(project.sample_size)) {
        throw new HttpError(403, 'This survey has no funded rewards remaining and is no longer accepting responses');
      }

      const { data: result, error: submitErr } = await admin.rpc('submit_token_funded_survey_response', {
        p_research_project_id: research_project_id,
        p_user_id: userId,
        p_duration_seconds: duration_seconds,
        p_device_fingerprint: device_fingerprint ?? null,
        p_status: fraud.status,
        p_quality_score: fraud.qualityScore,
        p_answers: answers,
        p_flag_reasons: fraud.reasons,
      });
      if (submitErr) {
        if (submitErr.code === '23505') throw new HttpError(409, 'You have already responded to this study');
        throw new HttpError(500, `Survey response and reward were rolled back: ${submitErr.message}`);
      }
      if (!result?.success || !result?.responseId) {
        throw new HttpError(500, 'Survey response could not be confirmed');
      }

      return json({
        responseId: result.responseId,
        status: result.status,
        reward_tokens: result.reward_tokens ?? 0,
        message: result.status === 'FLAGGED'
          ? 'Your response was submitted and flagged for quality review. Token reward is pending review.'
          : `Response submitted. ${result.reward_tokens} tokens have been added to your wallet.`,
      });
    }

    const { data: response, error: insertErr } = await admin.from('survey_responses').insert({
      research_project_id, user_id: userId, completed_at: new Date().toISOString(),
      duration_seconds, device_fingerprint: device_fingerprint ?? null,
      status: fraud.status, quality_score: fraud.qualityScore,
    }).select().single();
    if (insertErr) {
      if (insertErr.code === '23505') throw new HttpError(409, 'You have already responded to this study'); // unique_violation
      throw new HttpError(500, insertErr.message);
    }

    const answerRows = answers.map((a) => ({
      response_id: response.id, question_id: a.question_id,
      selected_option_ids: a.selected_option_ids ?? null,
      text_answer: a.text_answer ?? null, rating_value: a.rating_value ?? null,
    }));
    await admin.from('answers').insert(answerRows);

    if (fraud.status === 'FLAGGED') {
      await admin.from('response_quality').insert({ response_id: response.id, flag_reasons: fraud.reasons });
      await admin.from('fraud_flags').insert({ entity_type: 'RESPONSE', entity_id: response.id, reason: fraud.reasons.join('; '), severity: 'MEDIUM' });
    }

    // Reward: PENDING first, auto-CONFIRMED only for clean responses. Both
    // steps use atomic SQL functions (migrations/006_reward_functions.sql)
    // rather than a client-side read-modify-write, which would be a real
    // race condition under concurrent requests - the earlier draft of this
    // function had exactly that bug; fixed by moving the arithmetic into
    // the database as a single atomic UPDATE.
    const { error: pendingErr } = await admin.rpc('create_pending_reward', {
      p_user_id: userId, p_response_id: response.id, p_amount_paise: project.reward_per_response_paise,
    });
    if (pendingErr) throw new HttpError(500, `Reward creation failed: ${pendingErr.message}`);

    if (fraud.status === 'VALID') {
      const { error: confirmErr } = await admin.rpc('confirm_pending_reward_internal', { p_response_id: response.id });
      if (confirmErr) throw new HttpError(500, `Reward confirmation failed: ${confirmErr.message}`);
    }

    return json({
      responseId: response.id,
      status: fraud.status,
      message: fraud.status === 'FLAGGED'
        ? 'Your response was submitted but flagged for quality review. Your reward is pending admin review.'
        : 'Response submitted. Reward confirmed to your wallet.',
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    console.error('submit-survey-response error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
