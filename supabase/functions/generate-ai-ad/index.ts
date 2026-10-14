import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';
import { generateWithAI } from '../_shared/ai-provider.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST to generate an advertisement.');
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const { data: membership, error: membershipError } = await admin
      .from('business_members').select('business_id').eq('user_id', userId).limit(1).maybeSingle();
    if (membershipError || !membership) throw new HttpError(403, 'No business is associated with this account.');

    const { data: businessLimit } = await admin.from('business_ai_limits')
      .select('monthly_request_limit, monthly_budget_microusd, enabled')
      .eq('business_id', membership.business_id).maybeSingle();
    if (businessLimit?.enabled === false) throw new HttpError(429, 'AI tools are currently disabled for this business.');

    const body = await req.json();
    const product = typeof body.product === 'string' ? body.product.trim() : '';
    const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : 'awareness';
    const tone = typeof body.tone === 'string' ? body.tone.trim() : 'clear and friendly';
    if (product.length < 3 || product.length > 800) throw new HttpError(400, 'Describe the product or service in 3–800 characters.');
    if (audience.length > 300) throw new HttpError(400, 'Audience must be 300 characters or fewer.');
    if (!['awareness', 'leads', 'sales', 'visits', 'launch'].includes(goal)) throw new HttpError(400, 'Choose a supported campaign goal.');
    if (tone.length > 80) throw new HttpError(400, 'Tone must be 80 characters or fewer.');

    // The caller's business identity comes from the verified session, never request JSON.
    // The provider receives only this request's fields, not other businesses' records.
    const result = await generateWithAI({
      purpose: 'ad_generation',
      system: 'You are InsightLoop’s advertising assistant. Generate truthful, non-deceptive ad drafts. Do not invent certifications, testimonials, prices, performance claims, or guarantees. Return JSON only with headline, primary_text, call_to_action, variations (array of 3 short alternatives), and review_notes (array). Do not publish ads or claim a campaign is live.',
      prompt: JSON.stringify({
        product_or_service: product,
        intended_audience: audience || 'general audience',
        campaign_goal: goal,
        tone,
        requirements: ['Draft only; business approval required before publication.', 'Avoid sensitive personal targeting.', 'Flag claims the business must verify.'],
      }),
      jsonMode: true,
      maxOutputTokens: 1800,
    });

    const parsed = JSON.parse(result.text);
    if (typeof parsed.headline !== 'string' || typeof parsed.primary_text !== 'string' ||
        typeof parsed.call_to_action !== 'string' || !Array.isArray(parsed.variations) ||
        !Array.isArray(parsed.review_notes)) {
      throw new HttpError(502, 'AI returned an advertisement that failed validation. Please try again.');
    }

    // Usage event write is best-effort only until migration 005 is applied.
    // Once the migration is applied, this records per-business request usage server-side.
    const usageInsert = await admin.from('ai_usage_events').insert({
      business_id: membership.business_id,
      user_id: userId,
      provider: result.provider,
      purpose: 'ad_generation',
      model: result.model,
      input_chars: product.length + audience.length + tone.length,
      output_chars: result.text.length,
      estimated_cost_microusd: 0,
      status: 'succeeded',
    });
    if (usageInsert.error) console.error('AI usage event could not be recorded; check migration 005.');

    return json({ ad: parsed, provider: result.provider, model: result.model, draftOnly: true,
      message: 'Advertisement draft generated. Review all claims and approve it before publishing.' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (!(err instanceof HttpError)) console.error('AI ad generation failed:', err instanceof Error ? err.message : 'unknown error');
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
