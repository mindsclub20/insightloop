# RLS Route Audit

Every route that touches authorization, mapped to the RLS policy (or new
SECURITY DEFINER function) that must be the *actual* enforcement in
production. Two categories of check get conflated easily, so this audit
keeps them separate throughout:

- **Security boundary** — who is allowed to see/change a row at all. Must
  move to RLS (or a grant-restricted function). An app-layer bug here is an
  IDOR/privilege-escalation vulnerability.
- **Business rule** — validation that isn't about access control (e.g. "max
  8 questions per study", "sample size between 10 and 500", "minimum
  withdrawal ₹100"). Fine to keep in the application layer even in
  production; RLS is the wrong tool for these and trying to encode them
  there just makes them harder to change.

One real bug was found doing this audit and is already fixed in this
codebase (not left for later): `participant.getStudyDetails` returned a
DRAFT/SUBMITTED study's title/objective/city/reward to any authenticated
participant who guessed its UUID, before the eligibility check ever ran.
Eligibility is a *matching* feature, not an access gate. Fixed in
`src/routes/participant.js` to 404 unless the study is ACTIVE or the
participant already has a response tied to it.

## src/routes/auth.js

| Function | Current check | Category | Production RLS / mechanism |
|---|---|---|---|
| `registerParticipant` | `role: 'USER'` hardcoded server-side, never read from request body | Security boundary | Supabase Auth `signUp()` + a `handle_new_user()` trigger on `auth.users` that inserts the `profiles` row with `role = 'USER'` by default — the client never gets a `role` parameter to send in the first place |
| `registerBusiness` | `role: 'BUSINESS'` hardcoded | Security boundary | Same trigger pattern, or a second insert path gated the same way |
| `login` / `logout` | Custom scrypt + session table | N/A — replaced entirely | Supabase Auth session/JWT issuance; this whole file is retired in Option A, not "migrated" |
| `me` | `id = auth.uid()` implicitly (session → user) | Security boundary | RLS `"own profile read"` (002) |

## src/routes/participant.js

| Function | Current check | Category | Production RLS / mechanism |
|---|---|---|---|
| `getProfile` / `updateProfile` | `user.id` scoping in every query | Security boundary | `"own profile update"`, `"own interests"` (002) |
| `listEligibleStudies` | `findEligibleStudies()` — SQL filters `status='ACTIVE'`; age/city/tag matching is JS | Row visibility = security boundary; eligibility matching = business rule | `"participants read active projects"` (002) covers the ACTIVE-only visibility. Age/city/tag filtering **stays in application code** even in production — showing an ineligible participant a study's *existence* is a product decision (currently: don't), not a security leak, since ACTIVE studies aren't secret from participants generally |
| `getStudyDetails` | **Was missing** a status/ownership gate before the fix above; now 404s unless ACTIVE or already-responded | Security boundary | Same `"participants read active projects"` policy, plus `"participant reads own responses"` (002) covering the already-responded case |
| `submitStudy` | `project.status !== 'ACTIVE'` check; `UNIQUE(research_project_id, user_id)` constraint; server-recomputed `isEligible()` | Security boundary (status + eligibility must never trust the client) + DB constraint (duplicate prevention) | `"participant inserts own response"` (002) + the UNIQUE constraint from 001, unchanged — this was already correctly server-enforced, nothing to move |
| `getWalletHandler` / `getTransactionsHandler` | `user.id` scoping | Security boundary | `"own wallet read"`, `"own transactions read"` (002) |
| `createWithdrawal` | `user.id` scoping + balance check in `ledger.js` | Security boundary (ownership) + business rule (min amount) | **Changed in 004**: direct client INSERT into `withdrawals` is now revoked; production calls `request_withdrawal(amount, upi_id)` (004), a SECURITY DEFINER function that re-does the exact same balance check server-side regardless of what RLS would have allowed |
| `listWithdrawals` | `user.id` scoping | Security boundary | `"own withdrawals read"` (002) |

## src/routes/business.js

**This file is the largest concentration of app-layer-only security
boundaries in the codebase.** Every function funnels through
`ensureBusiness()` → `businessIdForUser()` and `loadOwnedStudy()`, which are
pure JavaScript. None of this has an RLS equivalent enforcing it today —
migrations/002 defines the policies, but the demo has never run against
real Postgres, so this is the single highest-priority set of checks to
verify against a live database in Option A.

| Function | Current check | Production RLS |
|---|---|---|
| `getMyBusiness` | `business_id from business_members where user_id = auth.uid()` (JS) | `"member reads own business"` (002) |
| `createStudy` | `businessIdForUser()` + `verification_status === 'VERIFIED'` | `"business creates projects for own business"` (002); the VERIFIED check is a **business rule**, not access control — an unverified business isn't a security risk, just not allowed to spend money yet — stays in application code (or a `CHECK`/trigger if you want DB-level enforcement of that specific rule too) |
| `updateStudy` | `loadOwnedStudy()` + `status === 'DRAFT'` | `"business writes own DRAFT or SUBMITTED-cancel projects"` (**tightened in 004** — see below) |
| `addQuestion` | `loadOwnedStudy()` + `status === 'DRAFT'` + 8-question cap | Row ownership → RLS via `survey_questions` policy (002); the 8-question cap is a **business rule**, stays in app code |
| `submitStudyForApproval` | `loadOwnedStudy()` + `assertTransition(status, 'SUBMITTED')` (new) | RLS update policy (004) + the transition-shape trigger (003) |
| `cancelStudy` (new) | `loadOwnedStudy()` + `assertTransition(status, 'CANCELLED')` | Same as above — this is exactly why 004 widened the business UPDATE policy to include `SUBMITTED` (a business can now legally cancel a submitted-but-not-yet-approved study) while still excluding `ADMIN_REVIEW`/`APPROVED`/`ACTIVE` |
| `listMyStudies` / `getMyStudy` | `loadOwnedStudy()` | `"business reads own projects"` (002) |
| `getStudyReport` | `loadOwnedStudy()`; report itself strips `user_id` from every row (see `lib/report.js`) | Row ownership via RLS; **the "no respondent identity leaks to a business" guarantee should ALSO be enforced by RLS directly denying businesses any SELECT grant on `survey_responses`/`answers` at all** (002 already does this — businesses have no policy on those tables, only admins and the owning participant do), not solely by `report.js` remembering to strip the field. This is a case where the app-layer version and the RLS version are both real defenses, not a stopgap and a replacement — keep both |

## src/routes/admin.js

Every function starts with `ensureAdmin()` → `requireRole(ADMIN, SUPER_ADMIN)`.
In production this maps to `current_user_role() in ('ADMIN','SUPER_ADMIN')`
policies on every admin-touched table (002) — but there's an architectural
choice to make explicit, not gloss over:

**Two valid ways to run this file in production, not one:**
1. **As a trusted backend** (this demo's model): the process holds elevated
   database credentials and RLS doesn't restrict it at all; `requireRole()`
   is the *only* boundary, exactly as today. This is fine **only if** the
   admin API is never reachable except through server-side session auth —
   i.e. exactly the architecture this repo already has.
2. **As a client calling Postgres directly** with the admin's own JWT
   (`authenticated` role, not service role): in this model, `requireRole()`
   in JS is redundant defense-in-depth, and the *actual* boundary is the RLS
   policies plus the four new SECURITY DEFINER functions in 004
   (`admin_confirm_reward`, `admin_forfeit_reward`,
   `admin_mark_withdrawal_paid`, `admin_reject_withdrawal`) — direct
   `wallet_transactions`/`withdrawals` writes are revoked from `authenticated`
   entirely (004), so an admin operating as a plain authenticated user
   **cannot** bypass those functions even with valid admin credentials.

This repo currently follows model 1. Moving to Supabase in Option A should
explicitly decide which model the Admin dashboard uses — mixing them (some
admin actions via trusted backend, others via direct client+RLS) is where
real vulnerabilities tend to hide, so pick one and audit it.

| Function | Maps to |
|---|---|
| `suspendUser` / `reactivateUser` | `profiles.status` write — needs an explicit admin UPDATE policy on `profiles.status` in 002/004 (currently 002's "admin updates any profile" already covers this since it's an unrestricted admin UPDATE policy on the whole row — sufficient, but worth being explicit that this is intentionally broad) |
| `verifyBusiness` / `rejectBusiness` | `"admin full access businesses"` (002) |
| `approveStudy` / `rejectStudy` / `pauseStudy` / `resumeStudy` / `cancelStudy` / `completeStudy` (new) | `"admin full access projects"` (002) for the *who*; the transition-shape trigger (003) for the *what* — both must hold simultaneously, which is exactly why they're separate mechanisms |
| `listFlaggedResponses` / `reviewResponse` | `"admin full access responses"` + `"admin full access response_quality"` (002) for reads; **reward confirm/forfeit as a side effect of review MUST go through `admin_confirm_reward`/`admin_forfeit_reward`** (004) in a client-direct model, since those tables have no direct admin UPDATE grant left after the 004 revokes |
| `listWithdrawals` / `markWithdrawalPaidHandler` / `rejectWithdrawalHandler` | Reads via `"admin full access withdrawals"` (002); writes **must** go through `admin_mark_withdrawal_paid` / `admin_reject_withdrawal` (004) under a client-direct model |
| `ledgerAudit` / `platformStats` | Admin-only reads, no writes — straightforward `current_user_role()` policies |

## Summary: what actually has to move, in priority order

1. **`src/routes/business.js` ownership checks** — highest priority, largest
   surface area, zero RLS coverage verified yet.
2. **Wallet/withdrawal writes** — 004 already writes the SECURITY DEFINER
   functions; Option A's job is verifying they behave identically to
   `src/lib/ledger.js` against a real database, then deciding (see admin.js
   section above) whether `routes/admin.js` and `routes/participant.js` call
   them via RPC or continue as a trusted backend.
3. **`question_options` visibility** — fixed in 004, needs verification.
4. **Everything else** — was already either correctly scoped in the original
   002 policies or is a business rule that correctly stays in application
   code.

---

## Coverage completion pass (offline session, no live Supabase)

Every route from `src/server.js`'s table, final disposition. "No function
needed" means the architecture decision itself (simple RLS-safe reads/writes
stay client-direct) — not a gap, the intended design confirmed per-route.

| Node route | Web/mobile equivalent | Status |
|---|---|---|
| POST /api/auth/register/participant | `supabase.auth.signUp()` + `handle_new_user` trigger (008) | IMPLEMENTED — not live-tested |
| POST /api/auth/register/business | `supabase.auth.signUp()` + `create-business` Edge Function | IMPLEMENTED — not live-tested |
| POST /api/auth/login, logout | `supabase.auth.signInWithPassword/signOut` | IMPLEMENTED — not live-tested (Supabase's own SDK, not our code, but the integration call sites are new) |
| GET /api/auth/me | Direct read via `supabase.auth.getUser()` + profiles select | IMPLEMENTED — not live-tested |
| participant profile GET/PATCH | Direct RLS read/write (`public/js/supabase/participant.js`) | IMPLEMENTED — not live-tested |
| participant studies GET / GET :id | Direct RLS read, `.maybeSingle()` fix applied (mobile + web) | IMPLEMENTED — not live-tested |
| participant studies/:id/submit | `submit-survey-response` Edge Function | IMPLEMENTED — not live-tested |
| participant wallet/transactions GET | Direct RLS read | IMPLEMENTED — not live-tested |
| participant withdrawals POST/GET | `request-withdrawal` function (POST) / direct RLS read (GET) | IMPLEMENTED — not live-tested |
| business mine GET | Direct RLS read via `business_members` join | IMPLEMENTED — not live-tested |
| business studies POST/GET, :id GET/PATCH | `create-research-project` function / direct RLS reads | IMPLEMENTED — not live-tested |
| business studies/:id/questions POST | `add-survey-question` function | IMPLEMENTED — not live-tested |
| business studies/:id/submit POST | `submit-study-for-approval` function | IMPLEMENTED — not live-tested |
| business studies/:id/cancel POST | Direct RLS write (004's widened business UPDATE policy) | IMPLEMENTED — not live-tested |
| business studies/:id/report GET | `generate-report` function | IMPLEMENTED — not live-tested |
| admin users GET | Direct RLS read (admin full-access policy) | IMPLEMENTED — not live-tested |
| admin users/:id/suspend, reactivate | `admin-manage-user` function (new this pass) | IMPLEMENTED — not live-tested |
| admin businesses GET | Direct RLS read | IMPLEMENTED — not live-tested |
| admin businesses/:id/verify, reject | `admin-manage-business` function (new this pass) | IMPLEMENTED — not live-tested |
| admin studies GET | Direct RLS read | IMPLEMENTED — not live-tested |
| admin studies/:id/{approve,reject,pause,resume,cancel,complete} | `admin-study-action` function | IMPLEMENTED — not live-tested |
| admin responses/flagged GET, :id/review | Direct RLS read / `admin-review-response` function | IMPLEMENTED — not live-tested |
| admin withdrawals GET, mark-paid, reject | Direct RLS read / `admin-process-withdrawal` function | IMPLEMENTED — not live-tested |
| admin ledger GET | Direct RLS read (reconciliation job NOT ported — see below) | IMPLEMENTED (partial) — not live-tested |
| admin stats GET | Direct RLS reads + client-side aggregation | IMPLEMENTED — not live-tested |

**Every P0 route now has a real, written implementation on the Supabase
track.** Nothing is a stub except the deliberately-stubbed payment webhook.

**One deliberate gap, not fixed this pass:** the Node app's `ledgerAudit()`
runs a full `reconcileWallet()` pass over every user, comparing
`wallets.balance_paise` against what the transaction history implies.
`public/js/supabase/admin.js`'s `ledgerAudit()` does not — it relies on
006's atomic SQL functions making a mismatch structurally hard to produce,
rather than periodically checking for one. A real production deployment
should add a scheduled reconciliation job (e.g. `pg_cron` + a SQL function).
Flagged, not built — out of scope for "do not add unnecessary features."

---

## Security audit (offline pass)

Every item requested, checked against what's actually written. "TESTED
LOCALLY" means covered by the 38 SQLite/Node tests or the earlier manual
HTTP walkthrough. "REQUIRES LIVE SUPABASE" means the mechanism is written
correctly by inspection but has zero live verification.

**RLS.** All 19 tables have `enable row level security` (002). The one
placeholder policy found in the original pass (`question_options`) was
fixed in 004. — REQUIRES LIVE SUPABASE (RLS cannot be verified without a
real Postgres instance; SQLite has no RLS to test against).

**Authorization / role escalation.** `profiles.role` has no UPDATE grant to
any client role (002's policy) plus an explicit trigger rejecting any
change unless the actor is SUPER_ADMIN (`block_role_escalation`, 002).
`handle_new_user` (008) hardcodes the role at signup from a fixed decision
tree, never from a client-supplied field. — TESTED LOCALLY for the
equivalent Node/SQLite path (role-injection attack test passed); the
Postgres trigger itself is REQUIRES LIVE SUPABASE.

**Participant isolation.** Every wallet/transaction/response table scopes
to `user_id = auth.uid()` (002). — TESTED LOCALLY (Node version, unauth
wallet access blocked, cross-user IDOR probes passed); REQUIRES LIVE
SUPABASE for the Postgres policies themselves.

**Business isolation.** `business_members` join gates every study/payment
policy (002/004). — TESTED LOCALLY (business-A-reads-business-B probe
passed on the Node version). One minor observation, not fixed this pass:
`business_members` has no `UNIQUE(user_id)` constraint, so nothing at the
DB level stops a user from ending up linked to two businesses if
`create-business` were ever called twice in a genuine race (the function's
own check-then-insert has a small race window). Not a cross-tenant data
leak — each business's data stays scoped to its own members either way —
just a data-integrity edge case worth knowing about. Not fixed, per "do not
add unnecessary features / do not change architecture" for this pass.

**Duplicate submissions.** `UNIQUE(research_project_id, user_id)` on
`survey_responses` (001) is the real enforcement; `submit-survey-response`
catches the resulting `23505` error and returns a clean 409. — TESTED
LOCALLY on Node/SQLite (explicit duplicate-submission test in
`test/flows.test.js` and a live 409 over HTTP); the Postgres constraint
itself is REQUIRES LIVE SUPABASE.

**Reward double-crediting.** Fixed a real bug during the previous pass
(client-side read-then-write race) by moving to atomic SQL functions
(`create_pending_reward`/`confirm_pending_reward_internal`, 006). Both are
idempotent by `idempotency_key` UNIQUE constraint. — TESTED LOCALLY for the
equivalent SQLite ledger logic (idempotency tests in `test/flows.test.js`);
the Postgres functions themselves are REQUIRES LIVE SUPABASE.

**Withdrawal abuse.** Direct client INSERT into `withdrawals` is revoked
(004); `request_withdrawal()` re-checks balance server-side inside the same
atomic function that reserves it, using `for update` row locking to close
the double-withdrawal race window a naive read-then-write would have. —
TESTED LOCALLY for the SQLite equivalent (insufficient-balance test,
min-withdrawal test); the Postgres `for update` locking is REQUIRES LIVE
SUPABASE — this is the single mechanism in the whole codebase I'd most want
verified under real concurrent load before trusting it with real money.

**Server-side 18+ enforcement.** `handle_new_user` (008) computes age from
`date_of_birth` and raises an exception (blocking signup entirely) if under
18 — this cannot be bypassed by a modified client the way the mobile app's
own `isAdult()` check (UX-only) can. — REQUIRES LIVE SUPABASE (never
executed; this is exactly the kind of check that's easy to get subtly wrong
— e.g. a timezone or date-parsing edge case — without running it against
real signup attempts near the boundary).

**Sensitive data exposure.** Businesses have no SELECT grant on
`survey_responses`/`answers` at all (002/004) — not even filtered, not
present. `getStudyReport`/`generate-report` return only aggregates. Audit
logs are append-only with no UPDATE/DELETE policy for any role, reinforced
by a trigger (005) that rejects those operations outright. — TESTED LOCALLY
for the SQLite audit-trigger append-only guarantee (`test/audit-triggers.test.js`
explicitly tries and fails to UPDATE/DELETE a row); the Postgres RLS
absence-of-grant and trigger are REQUIRES LIVE SUPABASE.

**Bottom line:** nothing found this pass changes the picture from the last
report — the architecture is sound by inspection and everything with a
local equivalent (SQLite/Node) is genuinely tested and passing. The entire
Postgres/RLS layer remains unverified by definition until it runs against
real Supabase, which is exactly what Option A's remaining next step is for.
