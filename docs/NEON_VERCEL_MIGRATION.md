# Neon + Vercel migration notes

## Progress verified on 2026-10-11

- Created GitHub branch `feat/neon-vercel-mvp` from `main`; `main` remains untouched.
- Created Neon branch `insightloop-dev` from the existing Neon project. The branch is ready.
- Added `migrations/neon/001_schema.sql` on the feature branch.
- Applied the migration to the isolated Neon development branch, not the Neon default branch.
- Verified the development database contains 21 application tables in `public` plus 9 pre-existing `neon_auth` tables.
- Inspected `wallets`, `survey_responses`, and `wallet_transactions`: non-negative wallet balance/pending checks, unique one-response-per-user-per-study, and unique ledger idempotency constraints are present.
- The Neon development branch has no application seed data yet.
- Vercel's project-read request works, but its environment-variable write returned HTTP 403 because the connector is not authorized for the Vercel scope `bvshyam7-4334`. No Vercel environment variable was changed.

## Architecture findings

- The MVP in `src/` uses synchronous `node:sqlite` calls and starts a long-running Node HTTP server.
- Vercel serverless functions do not provide durable local SQLite storage across invocations.
- Existing SQL migrations assume Supabase-specific `auth.users` and `auth.uid()`; they must not be applied directly to Neon.
- Neon project: `crimson-moon-72932416`. Development branch: `insightloop-dev` (`br-shy-smoke-b5nrh9s1`).
- The Neon production/default branch and GitHub `main` have not been changed by this migration.

## Neon schema

`migrations/neon/001_schema.sql` defines the MVP's core tables in plain PostgreSQL without Supabase auth dependencies. It preserves the existing text ID format and paise integer accounting model. It adds non-negative wallet checks and retains unique response and idempotency constraints.

## Remaining implementation work

The schema is installed, but this alone does **not** make the application production-ready. The app data layer and routes currently use synchronous SQLite APIs; they must be converted to asynchronous PostgreSQL queries, and the HTTP server must be adapted to Vercel's function request/response model before deployment can safely use Neon.

- [x] Create isolated GitHub feature branch
- [x] Create isolated Neon development branch
- [x] Add Neon-compatible PostgreSQL schema
- [x] Apply schema to development branch
- [x] Verify expected application tables and key constraints
- [ ] Port DB layer and every route/service to parameterized async Postgres queries
- [ ] Add transaction-safe reward/withdrawal operations and PostgreSQL integration tests
- [ ] Add Vercel serverless adapter and static asset routing
- [ ] Configure encrypted `DATABASE_URL` for Preview after Vercel scope access is restored
- [ ] Verify preview health, auth, survey submission, and wallet reconciliation
- [ ] Review and merge only after evidence passes

Do not point production traffic at this schema until the remaining code migration and integration tests are complete.
