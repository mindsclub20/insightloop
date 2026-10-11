// supabase/functions/create-business/index.ts
//
// WRITTEN, NOT EXECUTED. Closes the exact gap flagged in
// migrations/008_auth_trigger.sql's handle_new_user(): that trigger creates
// the profiles row (role='BUSINESS') at signup, but NOT a businesses row -
// business-specific fields (legal_name, category, GSTIN) aren't collected
// at auth time. This function is the required second step.
//
// Intended client flow (see public/js/supabase/auth.js's registerBusiness):
//   1. supabase.auth.signUp({ email, password, options: { data: { account_type: 'business', full_name } } })
//      -> handle_new_user() trigger creates profiles row with role='BUSINESS'
//   2. immediately after, while still signed in: call this function with
//      { legal_name, city, category, gstin } -> creates businesses +
//      business_members rows for auth.uid() as OWNER.
//
// A profile with role='BUSINESS' but no business_members row (abandoned
// step 2) is a valid, harmless state - every other business route already
// throws "No business associated with this account" for it, exactly
// matching src/lib/authz.js's businessIdForUser() behavior in the Node app.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { adminClient, requireRole, HttpError } from '../_shared/supabase.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const { userId } = await requireRole(req, admin, 'BUSINESS');

    // Abuse/duplicate guard: a BUSINESS-role user calling this twice (double
    // tap, retried request) must not end up owning two businesses or two
    // business_members rows. This is the direct equivalent of a concern
    // that couldn't arise in the Node app (registerBusiness there creates
    // both the user AND the business in one atomic call, so "call it twice"
    // isn't a scenario) - the two-step Supabase Auth flow introduces this
    // as a genuinely new edge case, checked for explicitly here rather than
    // assumed away.
    const { data: existing } = await admin.from('business_members').select('business_id').eq('user_id', userId).maybeSingle();
    if (existing) throw new HttpError(409, 'This account is already linked to a business');

    const body = await req.json();
    const { legal_name, city, category, gstin } = body;
    if (!legal_name) throw new HttpError(400, 'Business legal name is required');

    const { data: business, error: bizErr } = await admin.from('businesses').insert({
      owner_user_id: userId, legal_name, city: city ?? null, category: category ?? null,
      gstin: gstin ?? null, verification_status: 'PENDING',
    }).select().single();
    if (bizErr) throw new HttpError(500, bizErr.message);

    const { error: memberErr } = await admin.from('business_members').insert({
      business_id: business.id, user_id: userId, role: 'OWNER',
    });
    if (memberErr) {
      // Roll back the orphaned business row rather than leaving a
      // businesses row with no member able to reach it through any RLS
      // policy (every business policy in 002/004 goes through
      // business_members - a business with zero members is permanently
      // unreachable, not just inconvenient).
      await admin.from('businesses').delete().eq('id', business.id);
      throw new HttpError(500, memberErr.message);
    }

    return json(business);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, status);
  }
});
