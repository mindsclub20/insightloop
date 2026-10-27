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

- [ ] Confirm GitHub Actions passes on the latest commit after the participant token-reward display changes. Run #227 is green for an earlier commit, not the latest commit.
- [ ] Browser-test role-boundary redirects for every role. Source-level `requireRoleSupabase` guards exist; interactive cross-role testing was blocked when Browser Use credits ran out.
- [ ] Fix token-funded participant rewards end to end. Current deployed `publish_token_funded_survey` sets `reward_per_response_paise = 0`; current `submit-survey-response` still calls `create_pending_reward`, which rejects zero cash rewards. A real response may therefore be persisted before reward creation fails.
- [ ] Make response, answers, and token reward creation atomic; verify duplicate submission and retry behavior.
- [ ] Verify unused token refunds when a survey finishes or is cancelled, and reconcile reserved, paid, and refunded token balances.
- [ ] Implement and test a token-ledger reconciliation check/job. The admin UI currently has no full reconciliation sweep.
- [ ] Safely verify the business results report payload. The Results handler invokes the connected Supabase `generate-report` Edge Function; it was not invoked during this read-only pass.
- [ ] Isolate the preview backend before any publish, survey response, token grant, AI call, Firecrawl call, or other state-changing integration test.
- [ ] Integrate and verify Firecrawl-based web discovery in the research agent. Current research-agent backend uses Gemini Search grounding; the local research-preview planner is rule-based and not AI-generated.
- [ ] Run end-to-end tests for draft persistence, publish/token reservation, participant submission/reward, admin review, report generation, and refund lifecycle on the isolated backend.
- [ ] Complete release security, privacy, and data-integrity checks before production approval.

## Backend isolation approval required

Creating a Supabase development branch was not completed because Supabase requires explicit cost approval. Quoted cost: **$0.01344/hour** (about $0.32/day if left running continuously). The branch would apply existing migrations and start without production data. No branch was created in this pass.

## Safety and deployment notes

- All website changes were pushed to `feature/anvesh-frontend-integration-preview`.
- Vercel deployments used `target: null` (preview), not production.
- No production deployment, merge, Edge Function invocation, survey submission, token grant, account suspension, purchase, or destructive data action was performed.
- The latest read-only browser checks were completed against the preview host only.
