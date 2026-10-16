import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': 'https://insightloop-lac.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // This legacy endpoint used to activate a business survey directly,
  // bypassing platform review and reward-funding checks. Keep the route
  // explicitly fail-closed for old clients; the supported path is
  // submit-study-for-approval followed by admin review and confirmed funding.
  return json({
    error: 'Direct activation is disabled. Submit the survey for platform review; activation requires confirmed reward funding.',
  }, 409);
});
