# InsightLoop — P0 MVP + Option A Production Scaffolding

**Three things live in this repo now, at different levels of verification:**

1. **`src/`, `public/`, `test/`, `seed.js`** — the P0 MVP. Zero dependencies,
   runs today, fully tested (`npm test`), manually walked end-to-end over
   HTTP. This is the only part of the repo that has actually been executed.
2. **`migrations/003`–`008`, `supabase/functions/`** — the Supabase/Postgres
   production backend. Written against Supabase's real documented APIs,
   reviewed for correctness, but **never executed** — no network access was
   available while building it. See `docs/SUPABASE_SETUP.md` for exact
   deployment/verification steps and required credentials.
3. **`mobile/`** — a real Expo/React Native Android app (participant-only;
   see `mobile/README.md` for why). Same status as #2: written, not run.

Sections below describe #1, which is what you can actually try right now.
For #2 and #3, go straight to `docs/SUPABASE_SETUP.md` and `mobile/README.md`.

---


A working P0 build of the InsightLoop research marketplace: participants answer
short surveys for a small reward, businesses buy structured research studies,
admin moderates everything in between. This is a **real, runnable
application**, not a mockup — see "How to run it" below.

## Why this stack

Zero external dependencies, by design: **Node.js built-ins only** (`node:http`,
`node:sqlite`, `node:crypto`, `node:test`) plus plain HTML/CSS/vanilla JS on
the frontend. No `npm install` required. This was a deliberate choice for this
environment (no package registry access), but it also means anyone can clone
this and run it immediately with nothing but Node 22.5+.

The **production target remains Supabase/Postgres with Row Level Security**,
exactly as designed in the original architecture doc. `migrations/` contains
the real Postgres schema and RLS policies. The running demo swaps Postgres for
SQLite and RLS for equivalent application-layer checks (`src/lib/authz.js`) —
this substitution is called out everywhere it matters in the code comments,
and must be re-verified against real RLS before production use.

## How to run it

```bash
node --version   # requires >= 22.5.0 (for node:sqlite)
npm run seed      # creates data/insightloop.db with demo data
npm start          # starts the server at http://localhost:3000
# or: npm run dev  # same, with auto-restart on file changes
```

Open `http://localhost:3000` in a browser. No build step, no bundler.

## Demo credentials (local development only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@insightloop.dev` | `AdminPass123!` |
| Business (verified) | `cafe@business.dev` | `BizPass123!` |
| Business (pending verification) | `retail@business.dev` | `BizPass123!` |
| Participant | `ananya@participant.dev` (+ rahul/sneha/kiran/divya/arjun @participant.dev) | `Password123!` |

Seed data includes: 1 admin, 2 businesses (one verified, one pending), 6
participants with varied city/age/interest profiles, one ACTIVE study with 4
simulated responses (3 valid, 1 auto-flagged for being too fast), one
SUBMITTED study awaiting admin approval, and one pending withdrawal request —
so every screen has something to look at immediately after seeding.

**Try this walkthrough:** log in as the business → View details on the coffee
study → nothing yet. Log in as admin → Studies tab → Approve it. Log in as a
participant in Visakhapatnam aged 18–25 or 26-35 (not divya, wrong city; not
arjun, wrong age) → Available Research → take the survey. Back in admin →
Flagged Responses has kiran's too-fast response waiting for a decision.

## Running tests

```bash
npm test
```

18 automated tests covering: password hashing, RBAC (`requireRole`),
business-membership IDOR protection, ledger idempotency (double-credit and
double-confirm protection), reward confirm/forfeit correctness, withdrawal
balance reservation, full ledger reconciliation, fraud rule triggers
(too-fast, straight-lining, duplicate device), matching/eligibility logic,
and two raw database constraint checks (duplicate response UNIQUE constraint,
role CHECK constraint). All 18 pass as of this build.

Beyond the automated suite, the full HTTP flow was manually verified end-to-end
against a running server instance: registration → business verification →
study creation → question building → submission for approval → admin approval
→ participant survey submission → duplicate-submission rejection (409) →
fraud flag → admin review → reward confirm/forfeit → withdrawal request →
admin payout marking → ledger reconciliation, plus 5 explicit cross-role
security probes (participant hitting admin routes, business hitting admin
routes, unauthenticated wallet access, client-side role-injection attempt on
registration, and one business reading another business's study by ID) — all
blocked with the correct 401/403 as designed.

## Deployment

**Verified scope: local/demo SQLite only.** The Node HTTP server does not yet
use a persistent PostgreSQL adapter. Vercel startup therefore fails closed
with an actionable error instead of creating SQLite under `/tmp` or trying to
write into the read-only deployment filesystem. Do not deploy this Node server
as a production data service until a durable database adapter is implemented
and tested against a real hosted database.

- **Build command:** none (no bundler/transpiler).
- **Local start command:** `npm start` (or `node src/server.js`) on a supported
  Node.js version.
- **Local environment variables:** `PORT` and optional `INSIGHTLOOP_DB_PATH`.
  The SQLite path must be absolute or `:memory:`; unset uses `data/insightloop.db`.
- **Production database variables:** none are currently consumed by the Node
  server. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and
  `DATABASE_URL` in `.env.example` are documentation placeholders only; setting
  them does not connect this server to Postgres.
- **Durable production storage:** implement and validate a PostgreSQL/Supabase
  adapter that matches the current repository's schema and query conventions.
  Do not use SQLite in `/tmp` or the deployment filesystem as durable storage.
- **Static assets:** served directly by the Node process from `public/` in
  local/demo mode.

## Project structure

```
insightloop/
├── src/
│   ├── db.js              # SQLite schema + connection (demo substitute for Postgres)
│   ├── server.js           # HTTP router + static file server (no framework)
│   ├── lib/
│   │   ├── auth.js         # password hashing, session tokens, role-change gate
│   │   ├── authz.js        # RBAC checks (app-layer stand-in for RLS)
│   │   ├── ledger.js       # append-only wallet transaction ledger
│   │   ├── fraud.js        # rule-based response quality checks
│   │   ├── matching.js     # participant <-> study eligibility engine
│   │   ├── report.js       # 3-tier business report generation
│   │   ├── http.js         # body parsing, cookies, rate limiting
│   │   └── ids.js
│   └── routes/
│       ├── auth.js
│       ├── participant.js
│       ├── business.js
│       └── admin.js
├── public/                 # vanilla HTML/CSS/JS frontend, 3 portals
│   ├── participant/  business/  admin/
│   └── js/ css/
├── migrations/              # PRODUCTION Postgres schema + RLS (reference)
├── test/flows.test.js        # automated test suite (node:test)
├── seed.js                    # demo data generator
└── data/                        # local SQLite file lives here (gitignored in a real repo)
```

## What is still mocked/manual (read this before showing this to anyone)

- **No real payment gateway.** Business payments are recorded as
  `business_payments.status = 'MANUAL_PENDING'` and never actually charged.
  Admin approving a study only checks that *a payment record exists* — it does
  not verify real money moved.
- **No real payout rail.** Withdrawals reach `PAID` status only when an admin
  manually clicks "Mark paid" after sending a real UPI transfer *themselves,
  outside this system*. The app performs zero real money movement anywhere.
- **No identity/age verification beyond a self-reported date-of-birth field.**
  The 18+ gate is a form field check, not KYC.
- **No automated ML fraud detection** — by design, per the P0 brief. Rules are
  simple and explicitly described as heuristics, not proof of authenticity.
- **No real Supabase/Postgres connection** — the demo runs on local SQLite.
  `migrations/001-008` now has the full intended production schema, RLS,
  lifecycle triggers, audit triggers, and reward functions, and
  `supabase/functions/` has the Edge Functions to go with them — all written
  and reviewed, still unapplied/unexecuted. See `docs/SUPABASE_SETUP.md`.
- **No email/SMS/OTP delivery** — registration takes email+password directly;
  there's no verification email or phone OTP flow.
- **No file/image uploads** (e.g. GSTIN proof documents) — verification is a
  single admin button click against self-reported text fields.
- **Business report "recommendations"** are simple, transparent rule-based
  sentences (e.g. "sample size is small, treat as directional") — not an
  LLM. This was intentional (per spec: must work with zero AI-API
  dependency) but is also a legitimate place an LLM call could be added later
  to phrase (not generate) the numbers more naturally.

## Critical security notes (read this too)

- **RLS is emulated, not real, in this demo.** Every authorization check in
  `src/lib/authz.js` and each route file was written to mirror the intended
  Postgres RLS policies 1:1, and was exercised with 5 explicit cross-role
  attack tests (see "Running tests" above) — all passed. But SQLite has no
  database-level RLS, so authorization currently depends entirely on every
  route handler calling the right check correctly. **Before production use,
  apply the real RLS policies in `migrations/002_rls_policies.sql` and treat
  them, not the application code, as the actual security boundary.**
- **Role elevation is locked down** at both layers: no route anywhere accepts
  a client-supplied `role` field on an existing user; the only path to change
  a role is `adminPromote()` in `src/lib/auth.js`, callable only from a
  SUPER_ADMIN-gated admin route (not currently exposed via any UI in this P0,
  intentionally — there's no self-serve admin creation).
- **Sessions** are random 40+ byte tokens stored server-side (`sessions`
  table) with 7-day expiry, delivered via an `HttpOnly`, `SameSite=Lax`
  cookie. No JWT, no client-readable session data.
- **Passwords** are hashed with `scrypt` (Node's built-in, N/r/p defaults) and
  a random 16-byte salt per user; compared with a timing-safe comparison.
- **Rate limiting** is a basic in-memory per-key limiter (login attempts,
  survey submissions) — resets on process restart and does not survive
  multiple server instances. Fine for a single-process MVP; **not sufficient
  for a real deployment**, which should add rate limiting at the edge
  (Cloudflare or similar) as originally specified in the architecture doc.
- **No CSRF token.** Cookie is `SameSite=Lax`, which blocks cross-site
  `POST` form submissions from triggering state changes, but a real
  deployment should add an explicit CSRF token on state-changing requests
  before going further, especially once this serves real money.
- **Legal/compliance is explicitly NOT handled here** and must not be assumed
  from this codebase: RBI payment/payout regulations, DPDP Act 2023 consent
  and data-deletion obligations, GST on the platform fee, and real age
  verification all need professional legal review before any real-money
  launch, exactly as flagged in the original architecture document.

## Where the Option B/A hardening work lives

- `docs/RLS_ROUTE_AUDIT.md` — every route mapped to the RLS policy or
  SECURITY DEFINER function meant to enforce it in production, including one
  real IDOR bug found and fixed during that audit (`getStudyDetails` was
  leaking unpublished study metadata).
- `src/lib/lifecycle.js` + `migrations/003` — the full study state machine
  (adds PAUSED/CANCELLED/REPORT_READY), enforced both in the Node app and
  (written, unexecuted) as a Postgres trigger.
- `src/db.js`'s audit triggers — SQLite triggers that record sensitive
  changes (role, verification status, study status, withdrawal status)
  automatically, independent of any route remembering to log them; the
  Postgres equivalent is `migrations/005`.
- `src/lib/payments/` — the `PaymentProvider`/`PaymentService` abstraction;
  `ManualPaymentProvider` is the only implementation and deliberately throws
  on `confirmPayment`/`createPayout` rather than ever faking success.
- `supabase/functions/` — Edge Functions implementing the same operations
  against real Postgres, using the service role as a trusted backend for
  privileged writes and the caller's own RLS-scoped client for
  `request-withdrawal` specifically (see that function's header comment for
  why it's the one exception).
- `public/js/supabase/` + `public/supabase-login.html`,
  `public/supabase-register-business.html`, `public/supabase-business/`,
  `public/supabase-admin/` — a full second copy of the business/admin web
  UI, wired to the Supabase track instead of the local SQLite API. Same
  markup and UX as `/business/dashboard.html` and `/admin/dashboard.html`
  on purpose; open either pair side by side to see exactly what changed
  underneath and what didn't. Participants don't get a Supabase-track web
  UI — the Android app is the participant surface for that track, per the
  decision in `mobile/README.md`.
- `mobile/` — the Android app. See `mobile/README.md`.
