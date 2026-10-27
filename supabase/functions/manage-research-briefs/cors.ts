// supabase/functions/_shared/cors.ts
//
// WRITTEN, NOT EXECUTED — no Deno/Supabase CLI available in this sandbox
// (no network access at all, confirmed at the start of this phase). This
// follows Supabase's documented Edge Function conventions exactly; it has
// not been deployed or invoked against a real project. See
// docs/SUPABASE_SETUP.md for how to deploy and smoke-test it yourself.

export const corsHeaders = {
  // Tighten this to your actual web app origin(s) before production launch -
  // '*' is fine for local `supabase functions serve` testing only.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
