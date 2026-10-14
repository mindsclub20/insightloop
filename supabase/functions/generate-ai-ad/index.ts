import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';
import { generateWithAI } from '../_shared/ai-provider.ts';
import { finishAIUsage, reserveAIUsage } from '../_shared/ai-usage.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  let admin: ReturnType<typeof adminClient> | null = null;
  let usageEventId: string | null = null;
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST to generate an advertisement.');
    admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');
    const { data: membership, error: membershipError } = await admin
      .from('business_members').select('business_id').eq('user_id', userId).limit(1).maybeSingle();
    if (membershipError || !membership) throw new HttpError(403, 'No business is associated with this account.');

    const body = await req.json();
    const product = typeof body.product === 'string' ? body.product.trim() : '';
    const audience = typeof body.audience === 'string' ? body.audience.trim() : '';
    const goal = typeof body.goal === 'string' ? body.goal.trim() : 'awareness';
    const tone = typeof body.tone === 'string' ? body.tone.trim() : 'clear and friendly';
    if (product.length < 3 || product.length > 800) throw new HttpError(400, 'Describe the product or service in 3–800 characters.');
    if (audience.length > 300) throw new HttpError(400, 'Audience must be 300 characters or fewer.');
    if (!['awareness', 'leads', 'sales', 'visits', 'launch'].includes(goal)) throw new HttpError(400, 'Choose a supported campaign goal.');
    if (tone.length > 80) throw new HttpError(400, 'Tone must be 80 characters or fewer.');

    const reservation = await reserveAIUsage(admin, membership.business_id, userId, 'ad_generation');
    usageEventId = reservation.eventId;
    const prompt = JSON.stringify({
      product_or_service: product,
      intended_audience: audience || 'general audience',
      campaign_goal: goal,
      tone,
      requirements: ['Draft only; business approval required before publication.', 'Avoid sensitive personal targeting.', 'Flag claims the business must verify.'],
    });
    const result = await generateWithAI({
      purpose: 'ad_generation',
      system: 'You are InsightLoop’s advertising assistant. Generate truthful, non-deceptive ad drafts. Do not invent certifications, testimonials, prices, performance claims, or guarantees. Return JSON only with headline, primary_text, call_to_action, variations (array of 3 short alternatives), and review_notes (array). Do not publish ads or claim a campaign is live.',
      prompt,
      jsonMode: true,
      maxOutputTokens: 1800,
    });

    const parsed = JSON.parse(result.text);
    if (typeof parsed.headline !== 'string' || typeof parsed.primary_text !== 'string' ||
        typeof parsed.call_to_action !== 'string' || !Array.isArray(parsed.variations) ||
        !Array.isArray(parsed.review_notes) || parsed.variations.length > 5 || parsed.review_notes.length > 10) {
      throw new HttpError(502, 'AI returned an advertisement that failed validation. Please try again.');
    }

    await finishAIUsage(admin, usageEventId, 'succeeded', {
      provider: result.provider, model: result.model,
      inputChars: product.length + audience.length + tone.length + goal.length,
      outputChars: result.text.length,
    });
    return json({ ad: parsed, provider: result.provider, model: result.model, draftOnly: true,
      message: 'Advertisement draft generated. Review all claims and approve it before publishing.' });
  } catch (err) {
    if (admin && usageEventId) await finishAIUsage(admin, usageEventId, 'failed');
    const status = err instanceof HttpError ? err.status : 500;
    if (!(err instanceof HttpError)) console.error('AI ad generation failed:', err instanceof Error ? err.message : 'unknown error');
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
