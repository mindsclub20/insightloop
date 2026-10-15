import { supabase, invoke } from './client.js';

export async function getMyBusiness() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from('business_members').select('business_id').eq('user_id', user.id).maybeSingle();
  if (!membership) return null;
  const { data, error } = await supabase.from('businesses').select('*').eq('id', membership.business_id).single();
  if (error) throw error;
  return data;
}
export async function createStudy(params) { return invoke('create-research-project', params); }
export async function generateAiSurvey(params) { return invoke('generate-ai-survey', params); }
export async function addQuestion(researchProjectId, question) { return invoke('add-survey-question', { research_project_id: researchProjectId, ...question }); }
export async function submitForApproval(researchProjectId) { return invoke('submit-study-for-approval', { research_project_id: researchProjectId }); }
export async function saveDraft(researchProjectId, payload) { return invoke('save-survey-draft', { research_project_id: researchProjectId, ...payload }); }
export async function publishSurvey(researchProjectId) { return invoke('publish-survey', { research_project_id: researchProjectId }); }
export async function cancelStudy(researchProjectId) {
  const { data, error } = await supabase.from('research_projects').update({ status: 'CANCELLED' }).eq('id', researchProjectId).select().single();
  if (error) throw error;
  return data;
}
export async function listMyStudies() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: membership } = await supabase.from('business_members').select('business_id').eq('user_id', user.id).maybeSingle();
  if (!membership) return [];
  const { data, error } = await supabase.from('research_projects').select('*').eq('business_id', membership.business_id).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function getStudy(studyId) {
  const { data: study, error } = await supabase.from('research_projects').select('*').eq('id', studyId).single();
  if (error) throw error;
  const { data: questions, error: questionError } = await supabase.from('survey_questions').select('*').eq('research_project_id', studyId).order('order_index');
  if (questionError) throw questionError;
  const withOptions = await Promise.all((questions ?? []).map(async (q) => {
    const { data: opts, error: optionsError } = await supabase.from('question_options').select('*').eq('question_id', q.id).order('order_index');
    if (optionsError) throw optionsError;
    return { ...q, options: opts ?? [] };
  }));
  return { study, questions: withOptions };
}
export async function getStudyReport(studyId) { return invoke('generate-report', { research_project_id: studyId }); }
