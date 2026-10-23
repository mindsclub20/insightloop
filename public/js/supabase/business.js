// public/js/supabase/business.js
// WRITTEN, NOT EXECUTED. Completes the business side beyond the create/
// submit calls already shown in supabase-integration-example.js.

import { supabase, invoke } from './client.js';

export async function getMyBusiness() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Your session has expired. Please sign in again.');
  const { data: membership, error: membershipError } = await supabase.from('business_members').select('business_id').eq('user_id', user.id).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return null;
  const { data, error } = await supabase.from('businesses').select('*').eq('id', membership.business_id).single();
  if (error) throw error;
  return data;
}

export async function createStudy(params) {
  return invoke('create-research-project', params);
}

export async function generateAiSurvey(params) {
  return invoke('generate-ai-survey', params);
}

export async function addQuestion(researchProjectId, question) {
  return invoke('add-survey-question', { research_project_id: researchProjectId, ...question });
}

export async function submitForApproval(researchProjectId) {
  return invoke('submit-study-for-approval', { research_project_id: researchProjectId });
}

export async function saveSurveyDraft(researchProjectId, survey) {
  return invoke('save-survey-draft', {
    research_project_id: researchProjectId,
    title: survey.title,
    objective: survey.objective,
    questions: survey.questions,
  });
}

export async function publishSurvey(researchProjectId, options = {}) {
  return invoke('publish-survey', { research_project_id: researchProjectId, ...options });
}

// Deliberately a DIRECT client write, not an Edge Function - see
// migrations/004_rls_hardening.sql's tightened "business writes own DRAFT
// or SUBMITTED-cancel projects" policy, which was widened specifically so
// a business can move its own study straight to CANCELLED from DRAFT or
// SUBMITTED. This is the one business-side state change that's safe to let
// RLS + the 003 transition trigger handle directly, since no side effect
// (no payment, no reward, nothing else to keep atomic with it) accompanies
// a cancellation the way approval (payment check) or submission (payment
// creation) do.
export async function deleteDraft(researchProjectId) {
  return invoke('delete-survey-draft', { research_project_id: researchProjectId });
}

export async function cancelStudy(researchProjectId) {
  const { data, error } = await supabase.from('research_projects').update({ status: 'CANCELLED' }).eq('id', researchProjectId).select().single();
  if (error) throw error; // includes the 003 trigger's "Illegal status transition" message verbatim if the study isn't DRAFT/SUBMITTED
  return data;
}

export async function listMyStudies() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Your session has expired. Please sign in again.');
  const { data: membership, error: membershipError } = await supabase.from('business_members').select('business_id').eq('user_id', user.id).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return [];
  const { data, error } = await supabase.from('research_projects').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getStudy(studyId) {
  const { data: study, error } = await supabase.from('research_projects').select('*').eq('id', studyId).single();
  if (error) throw error;
  const { data: questions } = await supabase.from('survey_questions').select('*').eq('research_project_id', studyId).order('order_index');
  const withOptions = await Promise.all((questions ?? []).map(async (q) => {
    const { data: opts } = await supabase.from('question_options').select('*').eq('question_id', q.id).order('order_index');
    return { ...q, options: opts ?? [] };
  }));
  // NOTE: response counts by status (shown in the Node app's getMyStudy)
  // are NOT computed here via a direct read - businesses have no SELECT
  // grant on survey_responses at all (002/004), by design, to guarantee
  // no respondent-identity leak. Use getStudyReport() below instead, which
  // returns pre-aggregated counts with no individual response ever exposed
  // to this client.
  return { study, questions: withOptions };
}

export async function getStudyReport(studyId) {
  return invoke('generate-report', { research_project_id: studyId });
}
