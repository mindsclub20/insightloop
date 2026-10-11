// public/js/supabase-integration-example.js
//
// WRITTEN, NOT EXECUTED, NOT WIRED INTO THE RUNNING APP. This file is a
// reference implementation, not a replacement for public/js/api.js — the
// existing SQLite-backed app keeps working exactly as before; nothing here
// is loaded by any current HTML page.
//
// It demonstrates the full intended production pattern on ONE representative
// flow (login → read eligible studies under RLS → submit a response via an
// Edge Function) rather than porting all ~40 API calls in api.js/participant.js
// /business.js/admin.js, which would be a large, mechanical, but genuinely
// separate effort — see README.md "Next step for Option A" for that scope.
// Every other call follows this exact same shape:
//   - simple, RLS-safe reads  -> supabase.from('table').select(...)
//   - anything privileged/complex -> supabase.functions.invoke('function-name', {...})
//
// REQUIRES (not present in this sandbox): `npm install @supabase/supabase-js`,
// then either bundle it or, for a no-build-step vanilla-JS page like this
// one, import it from a CDN as shown below.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Public, safe to ship in a browser bundle - this is the anon key, not the
// service role key. RLS is what makes this safe to expose, not secrecy.
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'; // replace with real value from your Supabase project settings
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY'; // replace with real value

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------
// 1. AUTH — replaces public/js/api.js's calls to /api/auth/login etc.
//    and src/lib/auth.js's custom scrypt+session-cookie system entirely.
// ---------------------------------------------------------------
export async function loginParticipant(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session; // supabase-js persists this in localStorage automatically and attaches it to future calls
}

export async function registerParticipant({ email, password, full_name, city, age_range, date_of_birth }) {
  // Supabase Auth creates the auth.users row. The profiles row (with
  // role='USER' by default - never client-supplied) and the 18+ age gate
  // are both handled by the handle_new_user() database trigger
  // (migrations/008_auth_trigger.sql), not by this client call - that
  // trigger is the actual replacement for src/routes/auth.js's
  // registerParticipant(). date_of_birth is required - the trigger rejects
  // signup outright if it's missing for a participant account.
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, city, age_range, date_of_birth, account_type: 'participant' } },
  });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

// ---------------------------------------------------------------
// 2. READ under RLS — replaces GET /api/participant/studies. No custom
//    route needed at all: RLS policy "participants read active projects"
//    (002) is the entire security boundary here. This is the "client talks
//    to Postgres directly" model from docs/RLS_ROUTE_AUDIT.md.
// ---------------------------------------------------------------
export async function listEligibleStudies() {
  const { data, error } = await supabase
    .from('research_projects')
    .select('id, title, objective, target_city, reward_per_response_paise, target_min_age, target_max_age, target_tags')
    .eq('status', 'ACTIVE');
  if (error) throw error;

  // Eligibility (age/city/tag matching) is a PRODUCT feature, not a
  // security boundary (see RLS_ROUTE_AUDIT.md) - it stays client-side here
  // exactly as it was app-layer-only in the Node demo's matching.js. Port
  // isEligible() from src/lib/matching.js verbatim; omitted here for brevity.
  return data;
}

// ---------------------------------------------------------------
// 3. PRIVILEGED WRITE via Edge Function — replaces
//    POST /api/participant/studies/:id/submit. This is the "Edge Function
//    is the trusted backend" model - fraud evaluation, reward creation, and
//    duplicate-prevention all happen server-side in
//    supabase/functions/submit-survey-response/index.ts, not in this file.
// ---------------------------------------------------------------
export async function submitSurveyResponse({ researchProjectId, answers, durationSeconds, deviceFingerprint }) {
  const { data, error } = await supabase.functions.invoke('submit-survey-response', {
    body: {
      research_project_id: researchProjectId,
      answers,
      duration_seconds: durationSeconds,
      device_fingerprint: deviceFingerprint,
    },
  });
  // supabase.functions.invoke automatically attaches the current session's
  // access token as the Authorization header - this is what
  // requireProfile() in supabase/functions/_shared/supabase.ts verifies.
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------
// The remaining ~35 calls across api.js/participant.js/business.js/admin.js
// are mechanical repeats of pattern 2 or pattern 3 above, one per existing
// route. Listed in docs/RLS_ROUTE_AUDIT.md against which Edge Function or
// RLS policy each one maps to - that table is the spec for finishing this
// port, not re-derived here.
// ---------------------------------------------------------------
