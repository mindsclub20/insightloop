# Supabase Setup — Option A Deployment Guide

Everything in `migrations/003`–`008` and `supabase/functions/` was written
against Supabase's documented APIs and conventions, but **none of it has
been executed** — this sandbox has no network access at all (confirmed at
the start of this phase: even `npm ping` to the public npm registry was
blocked). This doc is the exact sequence to actually verify it.

## 1. Credentials you need to gather first

From your Supabase project's dashboard (Settings → API, and Settings →
Database):

| Credential | Where it's used | Ever appears client-side? |
|---|---|---|
| Project URL | Everywhere | Yes (public) |
| `anon` public key | Web app, Android app, `callerClient()` in Edge Functions | Yes (public — RLS is the real boundary, not secrecy) |
| `service_role` key | `adminClient()` in every Edge Function, via `supabase secrets set` | **Never.** Not in web bundle, not in the Android app, not in git. |
| Database connection string | Only needed if you run migrations via `psql` instead of the SQL Editor | No |

If you also plan to enable the payment/payout provider later: gateway API
key + webhook secret (see `supabase/functions/payment-webhook/index.ts`'s
header comment for exactly what that needs).

## 2. Create the project and run the migrations, in order

The SQL files are in `/migrations/`, numbered 001–008, and are **not** in
Supabase CLI's native `supabase/migrations/` timestamp-prefixed format —
they were written and reviewed as plain sequential SQL so they can be run
either way. Two options:

**Option 1 — Dashboard SQL Editor (simplest, no CLI needed):**
Open each file in order and paste/run it in your project's SQL Editor:
```
001_postgres_schema.sql
002_rls_policies.sql
003_lifecycle_states.sql
004_rls_hardening.sql
005_audit_triggers.sql
006_reward_functions.sql
007_storage.sql
008_auth_trigger.sql
```
Run them **in this exact order** — later files assume earlier ones exist
(e.g. 004 alters policies 002 created; 006's functions are used by the
`submit-survey-response` Edge Function).

**Option 2 — `psql` (scriptable, good for CI):**
```bash
export DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"
for f in migrations/00{1,2,3,4,5,6,7,8}_*.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f" || { echo "FAILED at $f - stop and inspect before continuing"; break; }
done
```

**Verify before moving on:**
```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
-- every InsightLoop table should show rowsecurity = true
select count(*) from project_status_transitions; -- should be 18
```

## 3. Deploy the Edge Functions

```bash
# Supabase deprecated global npm installs of the CLI - install it as a
# per-project dev dependency instead and invoke it via npx.
npm install --save-dev supabase
npx supabase --version   # confirms it installed correctly before continuing

npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF

# Server-side secrets - these are what let adminClient() in
# supabase/functions/_shared/supabase.ts work. Never pass these as
# --no-verify-jwt or otherwise expose them client-side.
npx supabase secrets set SUPABASE_URL=https://YOUR-PROJECT.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
npx supabase secrets set SUPABASE_ANON_KEY=YOUR-ANON-KEY

npx supabase functions deploy submit-survey-response
npx supabase functions deploy create-research-project
npx supabase functions deploy add-survey-question
npx supabase functions deploy submit-study-for-approval
npx supabase functions deploy admin-study-action
npx supabase functions deploy admin-review-response
npx supabase functions deploy request-withdrawal
npx supabase functions deploy admin-process-withdrawal
npx supabase functions deploy generate-report
npx supabase functions deploy create-business
npx supabase functions deploy admin-manage-user
npx supabase functions deploy admin-manage-business
npx supabase functions deploy payment-webhook   # deploys the 501 stub - intentionally non-functional, see its header comment
```

**Smoke-test each one** before trusting it, e.g.:
```bash
curl -i -X POST https://YOUR-PROJECT.supabase.co/functions/v1/create-research-project \
  -H "Authorization: Bearer <a real business user's access token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","template_type":"custom","target_city":"Visakhapatnam","sample_size":10,"reward_per_response_paise":500}'
```
Get a real access token by signing in via `supabase.auth.signInWithPassword()`
from a quick Node/browser console script, or from the Supabase dashboard's
Auth → Users → (a test user) → "Get access token" if your dashboard version
exposes that.

## 4. Auth configuration

- **Email confirmation:** decide whether to require it (Authentication →
  Providers → Email → "Confirm email"). The Node demo never required this;
  decide based on your actual launch needs, not by default.
- **Password reset / email templates:** Authentication → Email Templates.
  Supabase handles delivery; you only need to customize the templates.
- **JWT expiry / refresh:** defaults are usually fine; only touch
  Authentication → Settings if you have a specific session-length requirement.

## 5. What to test once deployed (maps directly to `docs/RLS_ROUTE_AUDIT.md`)

Re-run the five attack tests from the original P0 security testing, this
time against real Postgres:
1. A participant's JWT calling `create-research-project` → expect 403.
2. Business A's JWT reading Business B's `research_projects` row directly
   via `supabase.from('research_projects').select().eq('id', businessBsStudyId)`
   → expect empty result (RLS silently filters, doesn't error — different
   from the Node demo's explicit 403, worth confirming you're checking for
   an empty array, not an error).
3. A suspended user's JWT calling any Edge Function → expect 403 from
   `requireProfile()`'s `status === 'SUSPENDED'` check.
4. Attempt `supabase.from('profiles').update({ role: 'ADMIN' })` as a
   plain participant → expect the `block_role_escalation` trigger (002) to
   reject it.
5. Attempt a direct `supabase.from('withdrawals').insert(...)` as a
   participant → expect a permission error (004 revoked this grant
   entirely; only `request_withdrawal()` can create a withdrawal row now).

## 6. Wiring up the web UI

`public/js/supabase/client.js` has placeholder values:
```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```
Replace both with your real project URL and **anon** key (never the service
role key — this file ships to every browser that loads the page) from
Settings → API. That one edit is what makes every page under
`/supabase-login.html`, `/supabase-business/`, and `/supabase-admin/`
actually reach your project — same edit covers all of them, since they all
import this one shared client.

## 7. Known gaps to close before real-money launch

- `payment-webhook` is an intentional 501 stub — no real gateway connected.
- `handle_new_user` (008) doesn't yet create the `businesses` +
  `business_members` rows for a business signup in one step — flagged in
  that migration's own comment.
- The three-way duplication of the lifecycle transition graph
  (`src/lib/lifecycle.js`, `supabase/functions/_shared/lifecycle.ts`,
  `project_status_transitions` table) should be collapsed to one source of
  truth — most naturally the database table, with both application layers
  reading it instead of hardcoding a copy — once you're ready to make that
  refactor against a live database.
- Legal/compliance review (RBI payment rules, DPDP Act 2023, GST) is
  **still not done anywhere in this project** — nothing above changes that.
