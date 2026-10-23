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
    if (!token) return json({ error: 'Sign in to delete a draft' }, 401);

    const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401);

    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,role,status').eq('id', user.id).single();
    if (profileError || !profile) return json({ error: 'Account profile not found' }, 401);
    if (profile.status === 'SUSPENDED') return json({ error: 'This account has been suspended' }, 403);
    if (profile.role !== 'BUSINESS') return json({ error: 'Only business accounts can delete drafts' }, 403);

    const body = await req.json();
    const projectId = String(body.research_project_id || '');
    if (!projectId) return json({ error: 'Draft ID is required' }, 400);

    const { data: member, error: memberError } = await admin.from('business_members')
      .select('business_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return json({ error: 'No business is associated with this account' }, 403);

    const { data: project, error: projectError } = await admin.from('research_projects')
      .select('id,business_id,status').eq('id', projectId).maybeSingle();
    if (projectError) throw projectError;
    if (!project || project.business_id !== member.business_id) {
      return json({ error: 'Draft not found for this business' }, 404);
    }
    if (String(project.status).toUpperCase() !== 'DRAFT') {
      return json({ error: 'Only unpublished drafts can be deleted. Submitted or published surveys are protected.' }, 409);
    }

    const { data: questions, error: questionsError } = await admin.from('survey_questions')
      .select('id').eq('research_project_id', projectId);
    if (questionsError) throw questionsError;
    const questionIds = (questions || []).map((q: { id: string }) => q.id);
    if (questionIds.length) {
      const { error: optionsError } = await admin.from('question_options').delete().in('question_id', questionIds);
      if (optionsError) throw optionsError;
      const { error: deleteQuestionsError } = await admin.from('survey_questions').delete().in('id', questionIds);
      if (deleteQuestionsError) throw deleteQuestionsError;
    }

    const { data: deleted, error: deleteProjectError } = await admin.from('research_projects')
      .delete().eq('id', projectId).eq('business_id', member.business_id).eq('status', 'DRAFT').select('id').maybeSingle();
    if (deleteProjectError) throw deleteProjectError;
    if (!deleted) return json({ error: 'Draft was not deleted. Refresh and try again.' }, 409);
    return json({ success: true, deleted_id: deleted.id });
  } catch (err) {
    console.error('delete-survey-draft error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});