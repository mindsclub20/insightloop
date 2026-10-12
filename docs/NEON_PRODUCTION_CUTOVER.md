# Neon production cutover — safety gate

## Current state

The existing Node MVP uses synchronous `node:sqlite` throughout routes and domain modules. The intended hosted production architecture is PostgreSQL, but the application is **not yet a Neon-backed implementation**. Merely adding a Neon URL or moving SQLite to `/tmp` does not connect the application to Neon and does not provide durable storage.

## Safety change on this branch

`src/lib/database-mode.js` prevents the SQLite demo adapter from starting in Vercel production. Vercel preview can use disposable SQLite only when `INSIGHTLOOP_ALLOW_EPHEMERAL_SQLITE=1` is explicitly set. This opt-in is ignored in production. Local development remains unchanged.

This is a **fail-closed safety gate**, not a completed production database migration. Production will remain unavailable until the PostgreSQL adapter and application data-access layer are migrated and tested.

## Required next implementation

1. Introduce a supported Neon PostgreSQL client and server-only connection configuration.
2. Refactor the current synchronous `db.prepare(...).get/all/run` API and transaction patterns into asynchronous PostgreSQL data-access methods. Do not attempt to emulate synchronous network I/O.
3. Port all routes, auth/session handling, ledger operations, fraud checks, reporting, seed/test setup, and audit logging.
4. Reconcile schema differences against a Neon **non-production branch**. The existing Neon development schema must not be assumed compatible with the SQLite schema or production branch.
5. Add integration tests against an isolated Neon branch and verify constraints, transactions, authorization, and ledger idempotency.
6. Only after review, configure Vercel preview environment variables and deploy a preview. Production variables, production schema, and production deployment remain unchanged until explicit approval.

## Data safety

- Never use SQLite in `/tmp` as durable production storage.
- Never apply migrations to the production Neon branch during development.
- Never copy or migrate user data without a reviewed, tested migration and explicit approval.
- Do not expose connection strings in logs, source, client-side bundles, or test output.
