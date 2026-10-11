# Neon + Vercel migration notes

## Current state
- The MVP in `src/` uses synchronous `node:sqlite` calls and starts a long-running Node HTTP server.
- Vercel serverless functions do not provide durable local SQLite storage across invocations.
- Existing SQL migrations assume Supabase-specific `auth.users` and `auth.uid()`; they must not be applied directly to Neon.
- Neon project: `crimson-moon-72932416`. Isolated development branch: `insightloop-dev`.
- The production Neon branch and GitHub `main` have not been changed by this migration.

## Neon schema
`migrations/neon/001_schema.sql` defines the MVP's core tables in plain PostgreSQL without Supabase auth dependencies. It preserves the existing text ID format and paise integer accounting model. It adds non-negative wallet checks and retains unique response and idempotency constraints.

## Important limitation
This schema alone does **not** make the application production-ready. The app data layer and routes currently use synchronous SQLite APIs; they must be converted to asynchronous PostgreSQL queries, and the HTTP server must be adapted to Vercel's function request/response model before deployment can safely use Neon. Do not point production traffic at this schema until those changes and integration tests are complete.

## Verification checklist
- [ ] Apply schema only to the isolated Neon development branch
- [ ] Verify expected tables and constraints
- [ ] Port DB layer and every route/service to parameterized async Postgres queries
- [ ] Add transaction-safe reward/withdrawal operations
- [ ] Add Vercel serverless adapter and static asset routing
- [ ] Run existing tests plus PostgreSQL integration tests
- [ ] Configure encrypted `DATABASE_URL` in Vercel Preview only
- [ ] Verify preview health, auth, survey submission, and wallet reconciliation
- [ ] Review and merge only after evidence passes
