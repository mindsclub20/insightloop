// Shared server-side fair-use reservation for all InsightLoop AI endpoints.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { HttpError } from './supabase.ts';
import type { AIPurpose, AIProvider } from './ai-provider.ts';

const RESERVE_COST_MICROUSD = 25_000; // $0.025 estimate per call; not an exact provider invoice.

function configuredPrimary(): AIProvider {
  return (Deno.env.get('AI_PRIMARY_PROVIDER') || 'gemini').toLowerCase() === 'grok' ? 'grok' : 'gemini';
}

function configuredModel(provider: AIProvider): string {
  if (provider === 'grok') return Deno.env.get('XAI_MODEL') || 'grok-3-mini';
  return Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
}

export async function reserveAIUsage(
  admin: SupabaseClient,
  businessId: string,
  userId: string,
  purpose: AIPurpose,
) {
  const provider = configuredPrimary();
  const keyExists = provider === 'grok'
    ? Boolean(Deno.env.get('XAI_API_KEY'))
    : Boolean(Deno.env.get('GEMINI_API_KEY'));
  const actualProvider: AIProvider = keyExists ? provider : provider === 'gemini' ? 'grok' : 'gemini';
  const actualKeyExists = actualProvider === 'grok'
    ? Boolean(Deno.env.get('XAI_API_KEY'))
    : Boolean(Deno.env.get('GEMINI_API_KEY'));
  if (!actualKeyExists) throw new HttpError(503, 'AI provider is not configured yet.');

  const model = configuredModel(actualProvider);
  const { data, error } = await admin.rpc('reserve_ai_usage', {
    p_business_id: businessId,
    p_user_id: userId,
    p_provider: actualProvider,
    p_purpose: purpose,
    p_model: model,
    p_reserve_cost_microusd: RESERVE_COST_MICROUSD,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    console.error('AI usage reservation failed; provider call blocked.');
    throw new HttpError(503, 'AI usage controls are unavailable. Please try again later.');
  }
  const reservation = data[0];
  if (!reservation.allowed) {
    const reason = reservation.reason;
    if (reason === 'disabled') throw new HttpError(403, 'AI tools are disabled for this business.');
    if (reason === 'request_limit') throw new HttpError(429, 'This business has reached its monthly AI request limit.');
    if (reason === 'budget_limit') throw new HttpError(429, 'This business has reached its monthly AI budget limit.');
    throw new HttpError(400, 'The AI request could not be reserved.');
  }
  return { eventId: reservation.event_id as string, provider: actualProvider, model };
}

export async function finishAIUsage(
  admin: SupabaseClient,
  eventId: string,
  outcome: 'succeeded' | 'failed',
  details: { provider?: AIProvider; model?: string; inputChars?: number; outputChars?: number } = {},
) {
  const patch: Record<string, unknown> = { status: outcome };
  if (details.provider) patch.provider = details.provider;
  if (details.model) patch.model = details.model;
  if (details.inputChars !== undefined) patch.input_chars = details.inputChars;
  if (details.outputChars !== undefined) patch.output_chars = details.outputChars;
  const { error } = await admin.from('ai_usage_events').update(patch).eq('id', eventId);
  if (error) console.error('AI usage event finalization failed; check service logs.');
}
