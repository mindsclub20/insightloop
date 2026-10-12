# Neon adapter readiness audit

Date: 2026-10-12
Target branch: `fix/neon-production-storage`
Neon project: `shyam` (`crimson-moon-72932416`)
Test branch: `insightloop-dev` (`br-shy-smoke-b5nrh9s1`)

## Scope and safety

This audit was read-only against Neon. It did not run migrations, insert/update/delete data, modify Vercel environment variables, or promote a deployment. The inspected app tables on `insightloop-dev` had zero rows at the time of inspection.

## Findings

- The running MVP in `src/db.js` uses synchronous `node:sqlite` and creates/opens a local database file. This is not a durable serverless database.
- Route handlers, authentication, authorization, ledger operations, matching, fraud checks, reports, and seed logic call `db.prepare(...).get/all/run` synchronously. A PostgreSQL client is network-based and asynchronous; swapping a connection string or replacing the `db` import alone cannot make these paths work.
- The repository's original `migrations/001_postgres_schema.sql` is documented as a Supabase target and uses Supabase-specific `auth.users` references. It cannot be applied unchanged to a plain Neon database.
- The existing Neon `insightloop-dev` branch has a `public` schema with application tables, including `users`, `profiles`, `sessions`, `wallets`, `research_projects`, and `survey_responses`. The inspected key columns broadly resemble the SQLite app schema (for example, `users.password_hash/password_salt`, `profiles.user_id`, and text IDs), but this is not sufficient to certify every table, index, constraint, transaction, or query as compatible.
- The Neon `main` branch previously inspected has Neon Auth objects under `neon_auth` and no app tables under `public`. It must not be used for development migration testing.
- The current branch's database-mode guard intentionally fails closed in Vercel production until a real PostgreSQL adapter is implemented. Preview also fails unless the disposable SQLite opt-in is set. This is a safety gate, not a production fix.

## Required implementation before production can be called fixed

1. Introduce a supported server-side Neon PostgreSQL client and connection handling with `DATABASE_URL` kept server-only.
2. Port all database operations to async PostgreSQL queries; preserve atomicity for multi-step account creation, survey submission, reward/ledger updates, withdrawals, and admin actions.
3. Translate SQLite-specific SQL (placeholders, `datetime('now')`, `INSERT OR IGNORE` / conflict handling, JSON values, and transaction APIs) to PostgreSQL semantics.
4. Review and align the complete application schema and constraints against the app's actual queries. Do not apply the Supabase migrations unchanged.
5. Add isolated Neon integration tests for registration/login/session expiry, role checks, study lifecycle, survey duplicate prevention, fraud review, reward idempotency, withdrawal reservation/payout, and ledger reconciliation.
6. Verify the Vercel serverless entry point and `/api/health` route against a preview configured only with the non-production Neon branch.
7. Keep production Neon `main`, production secrets, and production deployment unchanged until the preview passes review and the user explicitly approves cutover.

## Completion criterion

Do not mark the issue resolved until the deployed preview demonstrably reads and writes through Neon, the critical integration suite passes, and the production cutover has been separately approved. A green unit-test workflow or a successful database connection alone is not sufficient.
