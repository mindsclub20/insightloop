# Anvesh MVP Preview QA Checklist

Date: 2026-10-27  
Scope: `feature/anvesh-frontend-integration-preview` and Vercel preview deployments only.  
Production: **not deployed, not merged, and not modified by this QA pass.**

## Verified and completed

- [x] Homepage and preview navigation load.
- [x] Business test account can sign in and reach the business dashboard.
- [x] Fixed the business survey-chat textarea error by assigning `type` only to actual input elements.
- [x] Fixed the Results button wiring to use a delegated `data-view-results` handler.
- [x] Business dashboard and Results tab load; active-study buttons render.
- [x] Participant test account routes to `/supabase-participant/dashboard.html`.
- [x] Participant dashboard and available-surveys list load without observed browser runtime errors.
- [x] Required-question validation blocks an empty answer without submitting.
- [x] Token-funded survey card displays `5 internal tokens`, not `₹0.00`.
- [x] Participant dashboard distinguishes the legacy cash wallet from the internal-token wallet.
- [x] Admin test account can open the admin dashboard and token control page in read-only mode.
- [x] Participant names are masked in the admin Users list and token account/transaction labels.
- [x] Research-preview local modal, local planning suggestion, browser-only draft save, filters, detail drawer and mobile navigation were browser-tested.
- [x] Regression tests added for participant routing, research-preview script parsing, business page module parsing, Results event wiring, privacy masking, and token reward labels.
- [x] GitHub Actions run #227 passed `npm test` for commit `95cd20b5c47c4e3df62c2444c42d625486f31cc5`.

## Open blockers — do not mark MVP-ready until closed

- [x] Confirmed GitHub Actions passes on the latest commit, including `npm test` and the isolated PostgreSQL integration job. Run #242: https://github.com/mindsclub20/insightloop/actions/runs/40486429835.
- [ ] Browser-test role-boundary redirects for every role. Source-level `requireRoleSupabase` guards exist; interactive cross-role testing was blocked when Browser Use credits ran out.
- [x] Added `026_atomic_token_survey_submission.sql` and ran it against a free, ephemeral PostgreSQL 17 database in GitHub Actions using a schema fixture.
- [x] PostgreSQL integration tests passed for successful token award, duplicate-response rejection, rollback after reward-budget failure, and flagged responses not receiving automatic rewards. Run #242: https://github.com/mindsclub20/insightloop/actions/runs/40486429835
- [ ] Verify the migration against the complete connected Supabase schema and validate the deployed Edge Function end to end. The isolated fixture is deliberately minimal and does not prove full-project compatibility; no production database writes have been made.
- [ ] Verify unused token refunds when a survey finishes or is cancelled, and reconcile reserved, paid, and refunded token balances.
- [ ] Implement and test a token-ledger reconciliation check/job. The admin UI currently has no full reconciliation sweep.
- [ ] Safely verify the business results report payload. The Results handler invokes the connected Supabase `generate-report` Edge Function; it was not invoked during this read-only pass.
- [ ] Keep the connected Supabase project read-only for this work. A Supabase development branch costs money, and the user has explicitly set a zero-payment limit; use a local/CI-only database for integration tests instead.
- [ ] Integrate and verify Firecrawl-based web discovery in the research agent. Current research-agent backend uses Gemini Search grounding; the local research-preview planner is rule-based and not AI-generated.
- [ ] Run end-to-end tests for draft persistence, publish/token reservation, participant submission/reward, admin review, report generation, and refund lifecycle on the isolated backend.
- [ ] Complete release security, privacy, and data-integrity checks before production approval.

## Backend isolation approval required

Creating a Supabase development branch was not completed because Supabase requires explicit cost approval. Quoted cost: **$0.01344/hour** (about $0.32/day if left running continuously). The branch would apply existing migrations and start without production data. No branch was created in this pass.

## Safety and deployment notes

- Website and backend-source changes were pushed to `feature/anvesh-frontend-integration-preview`.
- Added `migrations/026_atomic_token_survey_submission.sql`, which groups token-funded response insertion, answer insertion, reward wallet/ledger changes, and reserved-budget decrement in one database transaction.
- Updated `supabase/functions/submit-survey-response/index.ts` on the branch to route token-funded submissions through the atomic RPC; legacy cash-funded submissions keep their existing path.
- Added static regression checks and a PostgreSQL 17 integration job for the atomic RPC. The ephemeral database tests the transaction behavior without using live project data.
- Vercel deployments used `target: null` (preview), not production.
- No production deployment, merge, Edge Function deployment/invocation, database migration, survey submission, token grant, account suspension, purchase, or destructive data action was performed.
- The latest read-only browser checks were completed against the preview host only.
