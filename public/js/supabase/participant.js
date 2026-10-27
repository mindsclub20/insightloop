// public/js/supabase/participant.js
// WRITTEN, NOT EXECUTED. Completes the participant side; submitSurveyResponse
// already existed in supabase-integration-example.js and is not duplicated
// here - import it from there, or copy it in if you delete that reference
// file once this track is wired in for real.

import { supabase, invoke } from './client.js';

function ageOverlaps(userAgeRange, min, max) {
  if (!min && !max) return true;
  if (!userAgeRange) return false;
  const [uMin, uMax] = userAgeRange.split('-').map(Number);
  const lo = min ?? 0, hi = max ?? 200;
  return uMax >= lo && uMin <= hi;
}

export async function getProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Please log in to view your profile.');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (profileError) throw profileError;
  const { data: tags, error: tagsError } = await supabase.from('user_interests').select('tag').eq('user_id', user.id);
  if (tagsError) throw tagsError;
  return { profile, tags: (tags ?? []).map((t) => t.tag) };
}

export async function updateProfile({ city, area, age_range, occupation_category, interests }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('profiles').update({ city, area, age_range, occupation_category }).eq('id', user.id);
  if (error) throw error;

  if (Array.isArray(interests)) {
    await supabase.from('user_interests').delete().eq('user_id', user.id);
    if (interests.length) await supabase.from('user_interests').insert(interests.map((tag) => ({ user_id: user.id, tag })));
  }
  return { ok: true };
}

// Eligibility filtering happens CLIENT-SIDE here purely for what to show -
// it is NOT a security boundary (see docs/RLS_ROUTE_AUDIT.md). The
// submit-survey-response Edge Function re-verifies eligibility server-side
// on every submission regardless of what this function returned.
export async function listEligibleStudies() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Please log in to view surveys.');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('city, age_range').eq('id', user.id).single();
  if (profileError) throw profileError;
  const { data: tagRows, error: tagsError } = await supabase.from('user_interests').select('tag').eq('user_id', user.id);
  if (tagsError) throw tagsError;
  const tags = (tagRows ?? []).map((t) => String(t.tag).trim().toLowerCase());

  const { data: active, error } = await supabase.from('research_projects')
    .select('id, title, objective, target_city, reward_per_response_paise, reward_per_response_tokens, target_min_age, target_max_age, target_tags')
    .eq('status', 'ACTIVE');
  if (error) throw error;

  const { data: responded, error: responsesError } = await supabase.from('survey_responses').select('research_project_id').eq('user_id', user.id);
  if (responsesError) throw responsesError;
  const respondedIds = new Set((responded ?? []).map((r) => r.research_project_id));

  return (active ?? []).filter((s) => {
    if (respondedIds.has(s.id)) return false;
    if (s.target_city && profile?.city && s.target_city.toLowerCase() !== profile.city.toLowerCase()) return false;
    if (!ageOverlaps(profile?.age_range, s.target_min_age, s.target_max_age)) return false;
    if (s.target_tags?.length && !s.target_tags.some((t) => tags.includes(String(t).trim().toLowerCase()))) return false;
    return true;
  });
}

// Mirrors the IDOR fix made in src/routes/participant.js's getStudyDetails
// during the RLS route audit: a study is only readable here if ACTIVE (RLS
// policy "participants read active projects", 002) or the participant
// already has a response for it (RLS policy "participant reads own
// responses" governs THAT lookup, and a plain research_projects SELECT for
// a non-ACTIVE study the caller has no other relationship to correctly
// returns zero rows under RLS - there is no separate app-layer check to
// get wrong here, unlike the Node version where the bug lived in a hand
// -written query with no such filter).
export async function getStudyDetail(studyId) {
  const { data: study, error } = await supabase.from('research_projects').select('*').eq('id', studyId).maybeSingle();
  if (error) throw error;
  if (!study) return null; // RLS silently filtered it out - correct "not found" behavior, not an error

  const { data: questions, error: questionsError } = await supabase.from('survey_questions').select('*').eq('research_project_id', studyId).order('order_index');
  if (questionsError) throw questionsError;
  const withOptions = await Promise.all((questions ?? []).map(async (q) => {
    const { data: opts, error: optionsError } = await supabase.from('question_options').select('*').eq('question_id', q.id).order('order_index');
    if (optionsError) throw optionsError;
    return { ...q, options: opts ?? [] };
  }));
  return { study, questions: withOptions };
}

export async function getWallet() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', user.id).single();
  if (error) throw error;
  return data;
}

export async function getTransactions() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', user.id).single();
  const { data, error } = await supabase.from('wallet_transactions').select('*').eq('wallet_id', wallet.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function requestWithdrawal(amountPaise, upiId) {
  return invoke('request-withdrawal', { amount_paise: amountPaise, upi_id: upiId });
}

export async function listWithdrawals() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('withdrawals').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
