// supabase/functions/create-research-project/index.ts
// WRITTEN, NOT EXECUTED. Ports src/routes/business.js's createStudy().

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

const TEMPLATES = ['pricing_test', 'feature_preference', 'purchase_intent', 'satisfaction', 'timing_location', 'custom'];

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');

    const { data: membership } = await admin.from('business_members').select('business_id').eq('user_id', userId).limit(1).maybeSingle();
    if (!membership) throw new HttpError(403, 'No business associated with this account');

    const { data: biz } = await admin.from('businesses').select('*').eq('id', membership.business_id).single();
    if (biz.verification_status !== 'VERIFIED') {
      throw new HttpError(403, `Business must be verified by admin before creating research (currently: ${biz.verification_status})`);
    }

    const body = await req.json();
    const { title, template_type, objective, target_city, target_min_age, target_max_age, target_gender, target_tags, sample_size, reward_per_response_paise, deadline } = body;

    if (!title) throw new HttpError(400, 'Title is required');
    if (!template_type || !TEMPLATES.includes(template_type)) throw new HttpError(400, `template_type must be one of: ${TEMPLATES.join(', ')}`);
    if (!target_city) throw new HttpError(400, 'target_city is required');
    if (!sample_size || sample_size < 10 || sample_size > 500) throw new HttpError(400, 'sample_size must be between 10 and 500 for P0');
    if (!reward_per_response_paise || reward_per_response_paise < 100) throw new HttpError(400, 'reward_per_response_paise must be at least 100 (₹1)');

    const platformFeePaise = Math.round(sample_size * reward_per_response_paise * 0.3);
    const budgetPaise = sample_size * reward_per_response_paise + platformFeePaise;

    const { data: project, error } = await admin.from('research_projects').insert({
      business_id: membership.business_id, title, template_type, objective: objective ?? null,
      target_city, target_min_age: target_min_age ?? null, target_max_age: target_max_age ?? null,
      target_gender: target_gender ?? 'any', target_tags: target_tags ?? [],
      sample_size, budget_paise: budgetPaise, reward_per_response_paise, deadline: deadline ?? null,
      status: 'DRAFT',
    }).select().single();
    if (error) throw new HttpError(500, error.message);

    return json(project);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
