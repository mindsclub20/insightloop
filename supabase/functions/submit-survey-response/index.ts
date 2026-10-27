import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': 'https://insightloop-lac.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!URL || !SERVICE_KEY) return json({ error: 'Server authentication is not configured' }, 500);
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json({ error: 'Sign in to submit a survey' }, 401);
    const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401);
    const { data: profile, error: profileError } = await admin.from('profiles').select('*').eq('id', user.id).single();
    if (profileError || !profile) return json({ error: 'Account profile not found' }, 401);
    if (profile.status === 'SUSPENDED') return json({ error: 'This account has been suspended' }, 403);
    if (profile.role !== 'USER') return json({ error: 'Only participant accounts can submit survey responses' }, 403);

    const body = await req.json();
    const projectId = String(body.research_project_id || '');
    const answers = body.answers;
    const durationSeconds = Number(body.duration_seconds);
    const deviceFingerprint = body.device_fingerprint ? String(body.device_fingerprint) : null;
    if (!projectId) return json({ error: 'research_project_id is required' }, 400);
    if (!Array.isArray(answers) || answers.length === 0) return json({ error: 'Answers are required' }, 400);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return json({ error: 'duration_seconds is required' }, 400);

    const { data: project, error: projectError } = await admin.from('research_projects').select('*').eq('id', projectId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return json({ error: 'Survey not found' }, 404);
    if (project.status !== 'ACTIVE') return json({ error: 'This survey is not currently accepting responses' }, 400);

    const tokenMode = project.token_funding_status === 'FUNDED' || project.token_funding_status === 'EXHAUSTED';
    if (tokenMode) {
      if (project.token_funding_status !== 'FUNDED' || Number(project.tokens_reserved) < Number(project.reward_per_response_tokens) ||
          Number(project.token_rewards_paid) >= Number(project.sample_size)) {
        return json({ error: 'This survey has no funded rewards remaining and is no longer accepting responses.' }, 403);
      }
    } else {
      const { data: funding, error: fundingError } = await admin.from('business_payments')
        .select('id').eq('research_project_id', projectId).eq('status', 'SUCCESS').limit(1).maybeSingle();
      if (fundingError) throw fundingError;
      if (!funding) return json({ error: 'This study is paused because reward funding is not confirmed.' }, 403);
    }

    const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();
    if (project.target_city && lower(profile.city) !== lower(project.target_city)) {
      return json({ error: `Not eligible: this survey is for ${project.target_city}` }, 403);
    }
    const targetAreas = Array.isArray(project.target_areas) ? project.target_areas : [];
    if (targetAreas.length) {
      const participantArea = lower(profile.area);
      if (!participantArea || !targetAreas.some((area: unknown) => lower(area) === participantArea)) {
        return json({ error: 'Not eligible: your area does not match this survey.' }, 403);
      }
    }
    const professions = Array.isArray(project.target_professions) ? project.target_professions : [];
    if (professions.length && !professions.some((profession: unknown) => lower(profession) === lower(profile.occupation_category))) {
      return json({ error: 'Not eligible: your profession does not match this survey.' }, 403);
    }
    if (project.target_min_age !== null || project.target_max_age !== null) {
      const ageParts = String(profile.age_range ?? '').match(/\d+/g)?.map(Number) ?? [];
      if (!ageParts.length) return json({ error: 'Complete your age group in your profile to check survey eligibility.' }, 403);
      const ageMin = Math.min(...ageParts);
      const ageMax = Math.max(...ageParts);
      const targetMin = project.target_min_age === null ? 0 : Number(project.target_min_age);
      const targetMax = project.target_max_age === null ? 150 : Number(project.target_max_age);
      if (ageMin < targetMin || ageMax > targetMax) return json({ error: 'Not eligible: your age group does not match this survey.' }, 403);
    }
    if (project.target_tags?.length) {
      const { data: tagRows, error: tagsError } = await admin.from('user_interests').select('tag').eq('user_id', user.id);
      if (tagsError) throw tagsError;
      const tags = (tagRows ?? []).map((row: {tag:string}) => lower(row.tag));
      if (!(project.target_tags as string[]).some((tag: string) => tags.includes(lower(tag)))) {
        return json({ error: `Not eligible: this survey requires interests in ${project.target_tags.join(', ')}` }, 403);
      }
    }

    const { data: questions, error: questionsError } = await admin.from('survey_questions')
      .select('*').eq('research_project_id', projectId).order('order_index');
    if (questionsError) throw questionsError;
    if (!questions?.length) return json({ error: 'This survey has no questions' }, 500);
    for (const question of questions) {
      if (question.is_required) {
        const answer = answers.find((a: any) => a.question_id === question.id);
        const missing = !answer || (answer.selected_option_ids === undefined && answer.text_answer === undefined && answer.rating_value === undefined);
        if (missing) return json({ error: `Required question not answered: ${question.question_text}` }, 400);
      }
    }
    const { data: existing, error: existingError } = await admin.from('survey_responses').select('id')
      .eq('research_project_id', projectId).eq('user_id', user.id).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return json({ error: 'You have already responded to this study' }, 409);

    const reasons: string[] = [];
    if (durationSeconds < questions.length * 3) reasons.push('too_fast');
    const ratings = answers.filter((a: any) => a.rating_value !== undefined && a.rating_value !== null).map((a: any) => a.rating_value);
    if (ratings.length >= 3 && new Set(ratings).size === 1) reasons.push('straight_lining');
    if (deviceFingerprint) {
      const { data: dup, error: dupError } = await admin.from('survey_responses').select('user_id')
        .eq('research_project_id', projectId).eq('device_fingerprint', deviceFingerprint).neq('user_id', user.id).limit(1).maybeSingle();
      if (dupError) throw dupError;
      if (dup) reasons.push('duplicate_device');
    }
    const today = new Date().toISOString().slice(0, 10);
    const { count, error: countError } = await admin.from('survey_responses').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).gte('created_at', `${today}T00:00:00Z`);
    if (countError) throw countError;
    if ((count ?? 0) >= 15) reasons.push('abnormal_frequency');
    const status = reasons.length ? 'FLAGGED' : 'VALID';
    const qualityScore = Math.max(0, 1 - reasons.length * 0.3);

    // Token-funded responses use one database transaction for response, answers,
    // reward wallet/ledger entries, and reserved-budget accounting.
    if (tokenMode) {
      if (project.token_funding_status !== 'FUNDED' ||
          Number(project.tokens_reserved) < Number(project.reward_per_response_tokens) ||
          Number(project.token_rewards_paid) >= Number(project.sample_size)) {
        return json({ error: 'This survey has no funded rewards remaining and is no longer accepting responses.' }, 403);
      }

      const { data: result, error: submitError } = await admin.rpc('submit_token_funded_survey_response', {
        p_research_project_id: projectId,
        p_user_id: user.id,
        p_duration_seconds: durationSeconds,
        p_device_fingerprint: deviceFingerprint,
        p_status: status,
        p_quality_score: qualityScore,
        p_answers: answers,
        p_flag_reasons: reasons,
      });
      if (submitError) {
        if (submitError.code === '23505') return json({ error: 'You have already responded to this study' }, 409);
        throw new Error('Survey response and reward were rolled back: ' + submitError.message);
      }
      if (!result?.success || !result?.responseId) {
        throw new Error('Survey response could not be confirmed.');
      }
      return json({
        responseId: result.responseId,
        status: result.status,
        reward_tokens: result.reward_tokens ?? 0,
        message: result.status === 'FLAGGED'
          ? 'Response submitted and flagged for quality review. Token reward is pending review.'
          : 'Response submitted. ' + result.reward_tokens + ' tokens have been added to your wallet.',
      });
    }

    const { data: response, error: insertError } = await admin.from('survey_responses').insert({
      research_project_id: projectId, user_id: user.id, completed_at: new Date().toISOString(),
      duration_seconds: durationSeconds, device_fingerprint: deviceFingerprint, status, quality_score: qualityScore,
    }).select().single();
    if (insertError) {
      if (insertError.code === '23505') return json({ error: 'You have already responded to this study' }, 409);
      throw insertError;
    }
    const answerRows = answers.map((answer: any) => ({
      response_id: response.id, question_id: answer.question_id,
      selected_option_ids: answer.selected_option_ids ?? null,
      text_answer: answer.text_answer ?? null, rating_value: answer.rating_value ?? null,
    }));
    const { error: answerError } = await admin.from('answers').insert(answerRows);
    if (answerError) {
      await admin.from('survey_responses').delete().eq('id', response.id);
      throw answerError;
    }
    if (status === 'FLAGGED') {
      await admin.from('response_quality').insert({ response_id: response.id, flag_reasons: reasons });
      await admin.from('fraud_flags').insert({
        entity_type: 'RESPONSE', entity_id: response.id, reason: reasons.join('; '), severity: 'MEDIUM',
      });
    }

    if (tokenMode) {
      if (status === 'VALID') {
        const { data: reward, error: rewardError } = await admin.rpc('award_survey_token_reward', { p_response_id: response.id });
        if (rewardError || !reward?.paid) {
          await admin.from('answers').delete().eq('response_id', response.id);
          await admin.from('survey_responses').delete().eq('id', response.id);
          throw new Error(rewardError?.message || 'Token reward could not be confirmed. No response was recorded; please try again.');
        }
      }
      return json({
        responseId: response.id, status,
        message: status === 'FLAGGED'
          ? 'Response submitted and flagged for quality review. Token reward is pending review.'
          : `Response submitted. ${project.reward_per_response_tokens} tokens have been added to your wallet.`,
        reward_tokens: status === 'VALID' ? project.reward_per_response_tokens : 0,
      });
    }

    const { error: pendingError } = await admin.rpc('create_pending_reward', {
      p_user_id: user.id, p_response_id: response.id, p_amount_paise: project.reward_per_response_paise,
    });
    if (pendingError) throw new Error(`Reward creation failed: ${pendingError.message}`);
    if (status === 'VALID') {
      const { error: confirmError } = await admin.rpc('confirm_pending_reward_internal', { p_response_id: response.id });
      if (confirmError) throw new Error(`Reward confirmation failed: ${confirmError.message}`);
    }
    return json({
      responseId: response.id, status,
      message: status === 'FLAGGED'
        ? 'Response submitted but flagged for quality review. Cash reward is pending admin review.'
        : 'Response submitted. Cash reward confirmed to your wallet.',
    });
  } catch (err) {
    console.error('submit-survey-response error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});