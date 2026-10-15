import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const body = await req.json();
    const id = String(body.research_project_id || '');
    if (!id) throw new HttpError(400, 'research_project_id is required');

    const { data: project, error: projectError } = await admin
      .from('research_projects').select('id,business_id,status,title')
      .eq('id', id).maybeSingle();
    if (projectError) throw new HttpError(500, projectError.message);
    if (!project) throw new HttpError(404, 'Survey not found');

    const { data: membership } = await admin.from('business_members')
      .select('business_id').eq('user_id', userId).eq('business_id', project.business_id).maybeSingle();
    if (!membership) throw new HttpError(403, 'This survey does not belong to your business');
    if (project.status !== 'DRAFT') throw new HttpError(400, 'Only a draft survey can be published');

    const { count, error: questionError } = await admin.from('survey_questions')
      .select('id', { count: 'exact', head: true }).eq('research_project_id', id);
    if (questionError) throw new HttpError(500, questionError.message);
    if (!count || count < 1 || count > 8) throw new HttpError(400, 'A survey must contain between 1 and 8 questions');

    const { data: businessProfile, error: businessError } = await admin.from('businesses')
      .select('verification_status').eq('id', project.business_id).single();
    if (businessError) throw new HttpError(500, businessError.message);
    if (businessProfile.verification_status !== 'VERIFIED') {
      throw new HttpError(403, 'Your business must be verified before publishing surveys');
    }

    const { data: published, error } = await admin.from('research_projects')
      .update({ status: 'ACTIVE' }).eq('id', id).eq('status', 'DRAFT')
      .select('id,title,status').single();
    if (error) throw new HttpError(500, error.message);
    return json({ success: true, survey: published, paymentSkipped: true, adminApprovalSkipped: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});