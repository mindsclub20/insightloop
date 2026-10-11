// supabase/functions/request-withdrawal/index.ts
//
// WRITTEN, NOT EXECUTED. Unlike every other function in this directory,
// this one deliberately uses callerClient() (anon key + the caller's own
// JWT), NOT adminClient(). request_withdrawal() (migrations/004) is a
// SECURITY DEFINER function that internally uses auth.uid() to scope
// itself to the caller - calling it through the caller's own authenticated
// connection means RLS and the function's own auth.uid() check are BOTH
// live for this call, not bypassed by a service role. This is the one
// write in the whole app that goes through the "client calls Postgres
// directly, RLS is the boundary" model (see docs/RLS_ROUTE_AUDIT.md,
// admin.js section) rather than the "Edge Function is the trusted backend"
// model everything else here uses - included specifically to demonstrate
// both patterns exist and are both exercised, not just described.
//
// This function's own job is therefore thin: authenticate the caller
// (mostly so we can return a clean 401 instead of whatever error Postgres
// would give), forward the request to the RPC, and translate errors.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, callerClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    await requireRole(req, admin, 'USER'); // confirms identity + not suspended before we even touch the RPC

    const { amount_paise, upi_id } = await req.json();
    if (!amount_paise || amount_paise <= 0) throw new HttpError(400, 'A valid amount is required');
    if (!upi_id) throw new HttpError(400, 'UPI ID is required');

    const caller = callerClient(req); // <- the caller's own RLS-scoped connection, not admin
    const { data, error } = await caller.rpc('request_withdrawal', { p_amount_paise: amount_paise, p_upi_id: upi_id });
    if (error) {
      // request_withdrawal() raises plain exceptions for validation
      // failures (min amount, insufficient balance) - surface those as 400s.
      throw new HttpError(400, error.message);
    }

    return json(data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
