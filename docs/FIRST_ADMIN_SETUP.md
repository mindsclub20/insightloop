# First-time Anvesh admin verification

This flow deliberately fails closed until its server-side secrets are configured. Never put these values in HTML, browser JavaScript, GitHub, or a public Vercel variable.

In Supabase Dashboard → Edge Functions → Secrets, configure:

- `ANVESH_ADMIN_EMAIL`: the exact email of the intended owner account. It must match the signed-in Supabase user and be email-confirmed.
- `ANVESH_ADMIN_BOOTSTRAP_SECRET`: a fresh random secret of at least 32 characters. Generate it in a password manager or secure random generator; do not reuse an account password.
- Optional `ANVESH_ALLOWED_ORIGIN`: the production site origin, for example `https://insightloop-lac.vercel.app`.

The standard Supabase Edge Function values `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required; Supabase provides them to Edge Functions. Never expose the service-role key.

Deployment sequence:
1. Review and merge the feature branch/PR.
2. Apply migration `023_first_time_admin_bootstrap.sql`.
3. Deploy the `first-admin-setup` Edge Function with JWT verification enabled.
4. Add the two required secrets in Supabase, then redeploy the function if your dashboard requires it.
5. Sign in at `/supabase-login.html` with the confirmed owner account and visit `/supabase-admin/first-time-setup.html`.
6. Enter the one-time setup secret. The server verifies the session, confirmed email, exact owner email, secret, and that no admin already exists. The database operation is atomic and single-use.

Do not manually create an admin through browser SQL or disable the allowlist check. If first-time setup returns an error, it has not reported success.
