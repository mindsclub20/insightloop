// supabase/functions/add-survey-question/index.ts
// WRITTEN, NOT EXECUTED. Ports src/routes/business.js's addQuestion().

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

const VALID_TYPES = ['single_choice', 'multi_choice', 'yes_no', 'rating_5', 'rating_10', 'short_text', 'long_text'];

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const body = await req.json();
    const { research_project_id, question_text, question_type, is_required, options } = body;

    const { data: project } = await admin.from('research_projects').select('*').eq('id', research_project_id).single();
    if (!project) throw new HttpError(404, 'Study not found');

    const { data: membership } = await admin.from('business_members')
      .select('business_id').eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (!membership) throw new HttpError(403, 'This study does not belong to your business');
    if (project.status !== 'DRAFT') throw new HttpError(400, 'Can only add questions to a DRAFT study');

    const { count } = await admin.from('survey_questions').select('id', { count: 'exact', head: true }).eq('research_project_id', research_project_id);
    if ((count ?? 0) >= 8) throw new HttpError(400, 'P0 caps studies at 8 questions to protect completion rates');

    if (!question_text) throw new HttpError(400, 'question_text is required');
    if (!VALID_TYPES.includes(question_type)) throw new HttpError(400, `question_type must be one of: ${VALID_TYPES.join(', ')}`);
    if ((question_type === 'single_choice' || question_type === 'multi_choice') && (!options || options.length < 2)) {
      throw new HttpError(400, 'Choice questions need at least 2 options');
    }

    const { data: question, error } = await admin.from('survey_questions').insert({
      research_project_id, order_index: count ?? 0, question_text, question_type, is_required: is_required !== false,
    }).select().single();
    if (error) throw new HttpError(500, error.message);

    const opts: string[] = options ?? (question_type === 'yes_no' ? ['Yes', 'No'] : []);
    if (opts.length) {
      await admin.from('question_options').insert(opts.map((o, i) => ({ question_id: question.id, option_text: o, order_index: i })));
    }

    return json(question);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
