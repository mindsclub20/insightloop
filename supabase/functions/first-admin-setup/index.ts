import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const productionOrigin = "https://insightloop-lac.vercel.app";
const previewOrigin = "https://insightloop-ew9b8nsgc-bvshyam7-4334.vercel.app";

function corsHeadersFor(req: Request) {
  const requestOrigin = req.headers.get("Origin") ?? "";
  const configuredOrigin = Deno.env.get("ANVESH_ALLOWED_ORIGIN")?.trim();
  const allowedOrigins = new Set([productionOrigin, previewOrigin]);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);
  const allowedOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : productionOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function response(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(req) });
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aa = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(req, 405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ownerEmail = Deno.env.get("ANVESH_ADMIN_EMAIL")?.trim().toLowerCase();
  const bootstrapSecret = Deno.env.get("ANVESH_ADMIN_BOOTSTRAP_SECRET");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !ownerEmail || !bootstrapSecret || bootstrapSecret.length < 32) {
    return response(req, 503, { error: "First-time admin setup is not configured on the server. No changes were made." });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return response(req, 401, { error: "Please sign in with your Anvesh account." });

  let body: { bootstrapSecret?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 4096) return response(req, 413, { error: "Request is too large." });
    body = JSON.parse(raw);
  } catch {
    return response(req, 400, { error: "Invalid request." });
  }

  if (typeof body.bootstrapSecret !== "string" || !constantTimeEqual(body.bootstrapSecret, bootstrapSecret)) {
    return response(req, 403, { error: "The one-time setup key is invalid." });
  }

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  const user = authData?.user;
  if (authError || !user) return response(req, 401, { error: "Your sign-in session is invalid. Please log in again." });
  if (!user.email_confirmed_at) return response(req, 403, { error: "Confirm your email before admin verification." });
  if ((user.email ?? "").trim().toLowerCase() !== ownerEmail) {
    return response(req, 403, { error: "This verified account is not the designated owner account." });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existingAdmins, error: listError } = await adminClient
    .from("token_admin_allowlist").select("user_id").eq("enabled", true).limit(1);
  if (listError) return response(req, 503, { error: "Could not safely check existing admin access. No changes were made." });
  if (existingAdmins?.length) return response(req, 409, { error: "An administrator is already configured. First-time setup is closed." });

  const { data: profile, error: profileError } = await adminClient
    .from("profiles").select("id, role, status").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return response(req, 403, { error: "A valid Anvesh profile is required before admin setup." });
  if (profile.status !== "ACTIVE") return response(req, 403, { error: "Your Anvesh account must be active before admin setup." });

  const { error: claimError } = await adminClient.rpc("bootstrap_first_token_admin", { p_user_id: user.id });
  if (claimError) {
    const message = claimError.message || "";
    if (/already configured|already exists|unique/i.test(message)) {
      return response(req, 409, { error: "First-time setup has already been claimed. No additional administrator was added." });
    }
    return response(req, 500, { error: "Admin activation failed safely. No success was recorded." });
  }

  return response(req, 200, { ok: true });
});
