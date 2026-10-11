// supabase/functions/_shared/supabase.ts
//
// WRITTEN, NOT EXECUTED. Standard Supabase Edge Function pattern: two
// clients per request.
//
//   adminClient()  — service role key. Bypasses RLS entirely. This is what
//                    makes an Edge Function "the trusted backend" (the
//                    architecture decision documented in
//                    docs/RLS_ROUTE_AUDIT.md and docs/SUPABASE_SETUP.md):
//                    every write in this app goes through a function using
//                    this client, re-checking authorization in code, NOT
//                    through a client holding this key directly — this key
//                    only ever exists in Supabase's server-side function
//                    runtime, injected via `supabase secrets set`, and is
//                    never present in the web bundle or the Android app.
//
//   callerClient() — anon key + the caller's own JWT forwarded. Respects
//                    RLS as the caller. Used for the handful of operations
//                    where we deliberately want RLS to be the enforcement
//                    (e.g. request-withdrawal calls the request_withdrawal()
//                    RPC through THIS client, not the admin one, so the
//                    database's own auth.uid()-scoped logic is what runs -
//                    exercising the RLS/RPC layer for real on every call,
//                    not just trusting the Edge Function's own check).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new HttpError(500, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured for this function');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export function callerClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export interface AuthedProfile {
  id: string;
  role: 'USER' | 'BUSINESS' | 'ADMIN' | 'SUPER_ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
}

// Verifies the caller's JWT and loads their profile (via the ADMIN client,
// since we need to read role/status regardless of what RLS would allow the
// caller to see about themselves - which is normally everything, but this
// keeps the check independent of RLS policy correctness). Throws 401/403.
export async function requireProfile(req: Request, admin: SupabaseClient): Promise<{ userId: string; profile: AuthedProfile }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new HttpError(401, 'Missing Authorization header');
  const token = authHeader.replace('Bearer ', '');

  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new HttpError(401, 'Invalid or expired session');

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, status')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) throw new HttpError(401, 'No profile found for this user');
  if (profile.status === 'SUSPENDED') throw new HttpError(403, 'This account has been suspended');

  return { userId: user.id, profile: profile as AuthedProfile };
}

export async function requireRole(req: Request, admin: SupabaseClient, ...roles: string[]) {
  const { userId, profile } = await requireProfile(req, admin);
  if (!roles.includes(profile.role)) {
    throw new HttpError(403, `Requires role: ${roles.join(' or ')} (caller has ${profile.role})`);
  }
  return { userId, profile };
}
