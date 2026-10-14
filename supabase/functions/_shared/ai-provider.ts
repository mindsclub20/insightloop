// Server-only provider adapter for Supabase Edge Functions (Deno).
// Keep provider credentials in Supabase Edge Function secrets; never expose to browsers.
export type AIProvider = 'gemini' | 'grok';
export type AIPurpose = 'survey_generation' | 'ad_generation' | 'market_research' | 'report_analysis';

export type AIRequest = {
  purpose: AIPurpose;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  jsonMode?: boolean;
};

export type AIResult = {
  text: string;
  provider: AIProvider;
  model: string;
};

function enabledProviders(): AIProvider[] {
  const preferred = (Deno.env.get('AI_PRIMARY_PROVIDER') || 'gemini').toLowerCase();
  const primary: AIProvider = preferred === 'grok' ? 'grok' : 'gemini';
  const secondary: AIProvider = primary === 'gemini' ? 'grok' : 'gemini';
  return [primary, secondary].filter((p) =>
    p === 'gemini' ? Boolean(Deno.env.get('GEMINI_API_KEY')) : Boolean(Deno.env.get('XAI_API_KEY'))
  );
}

async function callGemini(request: AIRequest): Promise<AIResult> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('Gemini provider is not configured.');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: request.maxOutputTokens ?? 2500,
        ...(request.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: {text?: string}) => part.text || '').join('');
  if (!text) throw new Error('Gemini returned an empty response.');
  return { text, provider: 'gemini', model };
}

async function callGrok(request: AIRequest): Promise<AIResult> {
  const key = Deno.env.get('XAI_API_KEY');
  if (!key) throw new Error('Grok provider is not configured.');
  const model = Deno.env.get('XAI_MODEL') || 'grok-3-mini';
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      temperature: 0.3,
      max_tokens: request.maxOutputTokens ?? 2500,
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Grok request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Grok returned an empty response.');
  return { text, provider: 'grok', model };
}

// Tries configured providers in order. We fail closed if none is configured.
// Fallback is intended for transient provider failures; usage/cost must still be
// logged by the calling Edge Function after the successful provider is known.
export async function generateWithAI(request: AIRequest): Promise<AIResult> {
  const providers = enabledProviders();
  if (!providers.length) throw new Error('No AI provider is configured. Add GEMINI_API_KEY or XAI_API_KEY to server-side secrets.');
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return provider === 'gemini' ? await callGemini(request) : await callGrok(request);
    } catch (error) {
      lastError = error;
      // Never log request content or credentials. Continue to the next configured provider.
      console.error(`AI provider ${provider} failed; attempting configured fallback.`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All configured AI providers failed.');
}
