/**
 * Guard the current SQLite demo adapter from accidental Vercel production use.
 *
 * SQLite files in a serverless function's deployment filesystem are not
 * writable/persistent. /tmp is ephemeral too. Until the application has been
 * migrated to its Neon PostgreSQL adapter, production must fail explicitly
 * instead of silently serving a fresh, non-persistent database.
 */
export function assertDatabaseMode(env = process.env) {
  const onVercel = Boolean(env.VERCEL);
  if (!onVercel) return;

  if (env.VERCEL_ENV === 'production') {
    throw new Error(
      'InsightLoop production requires the Neon PostgreSQL adapter. ' +
      'The current SQLite adapter is demo-only; refusing to start with ' +
      'non-persistent serverless storage.'
    );
  }

  if (env.INSIGHTLOOP_ALLOW_EPHEMERAL_SQLITE !== '1') {
    throw new Error(
      'InsightLoop Vercel preview is using the SQLite demo adapter. ' +
      'Set INSIGHTLOOP_ALLOW_EPHEMERAL_SQLITE=1 only for disposable preview ' +
      'testing; use Neon PostgreSQL for persistent data.'
    );
  }
}
