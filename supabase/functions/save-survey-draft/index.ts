import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

const TYPES = ['single_choice','multi_choice','yes_no','rating_5','rating_10','short_text','long_text'];
serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const body = await req.json();
    const id = String(body.research_project_id || '');
    const title = String(body.title || '').trim();
    const objective = String(body.objective || '').trim();
    const questions = body.questions;
    if (!id || !title || !objective) throw new HttpError(400, 'Survey ID, title, and objective are required');
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 8) throw new HttpError(400, 'A draft must contain 1 to 8 questions');
    const { data: project, error: projectError } = await admin.from('research_projects').select('id,business_id,status').eq('id', id).maybeSingle();
    if (projectError) throw new HttpError(500, projectError.message);
    if (!project) throw new HttpError(404, 'Draft not found');
    const { data: member } = await admin.from('business_members').select('business_id').eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (!member) throw new HttpError(403, 'This draft does not belong to your business');
    if (project.status !== 'DRAFT') throw new HttpError(400, 'Only draft surveys can be edited');
    for (const [i,q] of questions.entries()) {
      if (!String(q.question_text || '').trim() || !TYPES.includes(q.question_type)) throw new HttpError(400, 'Question '+(i+1)+' has invalid text or answer type');
      if (['single_choice','multi_choice'].includes(q.question_type) && (!Array.isArray(q.options) || q.options.filter((x:string)=>String(x).trim()).length<2)) throw new HttpError(400, 'Question '+(i+1)+' needs at least two options');
    }
    const { error: updateError } = await admin.from('research_projects').update({ title, objective }).eq('id',id).eq('status','DRAFT');
    if (updateError) throw new HttpError(500, updateError.message);
    const { data: oldQs, error: oldError } = await admin.from('survey_questions').select('id').eq('research_project_id',id);
    if (oldError) throw new HttpError(500, oldError.message);
    const oldIds = (oldQs || []).map((q:any)=>q.id);
    if (oldIds.length) {
      const { error: optsDeleteError } = await admin.from('question_options').delete().in('question_id',oldIds);
      if (optsDeleteError) throw new HttpError(500, optsDeleteError.message);
      const { error: qDeleteError } = await admin.from('survey_questions').delete().in('id',oldIds);
      if (qDeleteError) throw new HttpError(500, qDeleteError.message);
    }
    for (const [i,q] of questions.entries()) {
      const { data: inserted, error } = await admin.from('survey_questions').insert({
        research_project_id:id, order_index:i, question_text:String(q.question_text).trim(),
        question_type:q.question_type, is_required:q.is_required!==false
      }).select().single();
      if (error) throw new HttpError(500,error.message);
      const options = Array.isArray(q.options) ? q.options.map((x:string)=>String(x).trim()).filter(Boolean) : (q.question_type==='yes_no'?['Yes','No']:[]);
      if (options.length) {
        const { error: optionError } = await admin.from('question_options').insert(options.map((option_text:string, order_index:number)=>({question_id:inserted.id,option_text,order_index})));
        if (optionError) throw new HttpError(500,optionError.message);
      }
    }
    return json({ success:true, research_project_id:id, question_count:questions.length });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});