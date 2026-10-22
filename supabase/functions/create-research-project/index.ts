// Token-first survey draft creation. Drafts are free; funding happens only in publish-survey.
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
    if (!token) return json({ error: 'Sign in to create a survey' }, 401);

    const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401);
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,role,status').eq('id', user.id).single();
    if (profileError || !profile) return json({ error: 'Account profile not found' }, 401);
    if (profile.status === 'SUSPENDED') return json({ error: 'This account has been suspended' }, 403);
    if (profile.role !== 'BUSINESS') return json({ error: 'Only business accounts can create surveys' }, 403);

    const body = await req.json();
    const allowedTemplates = ['pricing_test', 'feature_preference', 'purchase_intent', 'satisfaction', 'timing_location', 'custom'];
    const title = String(body.title || '').trim();
    const template_type = body.template_type;
    const target_city = String(body.target_city || '').trim();
    const sample_size = Number(body.sample_size);
    const tokenReward = body.reward_per_response_tokens === undefined ? null : Number(body.reward_per_response_tokens);
    const legacyRewardPaise = Number(body.reward_per_response_paise || 0);
    const tokenMode = tokenReward !== null;

    if (!title) return json({ error: 'Title is required' }, 400);
    if (!allowedTemplates.includes(template_type)) return json({ error: 'Invalid survey template' }, 400);
    if (!target_city) return json({ error: 'Target city is required' }, 400);
    if (!Number.isInteger(sample_size) || sample_size < 10 || sample_size > 500) {
      return json({ error: 'Participant count must be between 10 and 500' }, 400);
    }
    const minAge = body.target_min_age == null || body.target_min_age === '' ? null : Number(body.target_min_age);
    const maxAge = body.target_max_age == null || body.target_max_age === '' ? null : Number(body.target_max_age);
    if (minAge !== null && (!Number.isInteger(minAge) || minAge < 18 || minAge > 120)) {
      return json({ error: 'Minimum participant age must be between 18 and 120' }, 400);
    }
    if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < 18 || maxAge > 120)) {
      return json({ error: 'Maximum participant age must be between 18 and 120' }, 400);
    }
    if (minAge !== null && maxAge !== null && maxAge < minAge) {
      return json({ error: 'Maximum age must be greater than or equal to minimum age' }, 400);
    }
    if (tokenMode && (!Number.isSafeInteger(tokenReward) || tokenReward < 5 || tokenReward > 1000000)) {
      return json({ error: 'Reward must be at least 5 tokens per participant' }, 400);
    }
    if (!tokenMode && (!Number.isInteger(legacyRewardPaise) || legacyRewardPaise < 100)) {
      return json({ error: 'Legacy cash reward must be at least ₹1 per response' }, 400);
    }

    const { data: membership, error: memberError } = await admin.from('business_members')
      .select('business_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (memberError) throw memberError;
    if (!membership) return json({ error: 'No business is associated with this account' }, 403);

    const targetAreas = Array.isArray(body.target_areas)
      ? body.target_areas.map((v: unknown) => String(v).trim()).filter(Boolean).slice(0, 30)
      : [];
    const targetProfessions = Array.isArray(body.target_professions)
      ? body.target_professions.map((v: unknown) => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 30)
      : [];
    const targetTags = Array.isArray(body.target_tags)
      ? [...new Set(body.target_tags.map((v: unknown) => String(v).trim().toLowerCase()).filter(Boolean))].slice(0, 30)
      : [];
    const budget_paise = tokenMode ? 0 : sample_size * legacyRewardPaise + Math.round(sample_size * legacyRewardPaise * 0.3);
    const { data: project, error } = await admin.from('research_projects').insert({
      business_id: membership.business_id,
      title,
      template_type,
      objective: body.objective ? String(body.objective).trim().slice(0, 2000) : null,
      target_city,
      target_min_age: minAge,
      target_max_age: maxAge,
      target_gender: body.target_gender ?? 'any',
      target_tags: targetTags,
      target_areas: targetAreas,
      target_professions: targetProfessions,
      sample_size,
      budget_paise,
      reward_per_response_paise: tokenMode ? 0 : legacyRewardPaise,
      reward_per_response_tokens: tokenMode ? tokenReward : null,
      reward_budget_tokens: tokenMode ? sample_size * tokenReward : null,
      token_funding_status: tokenMode ? 'UNFUNDED' : 'UNFUNDED',
      deadline: body.deadline ?? null,
      status: 'DRAFT',
    }).select().single();
    if (error) throw error;
    return json(project, 201);
  } catch (err) {
    console.error('create-research-project error:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});