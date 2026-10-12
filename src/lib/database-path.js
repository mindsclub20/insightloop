import path from 'node:path';

/**
 * Select a database location for the SQLite local/demo adapter.
 *
 * Vercel's filesystem is not persistent. A preview can opt into an isolated
 * in-memory demo database with INSIGHTLOOP_ALLOW_EPHEMERAL_DEMO=1, so the
 * UI/API can be smoke-tested without pretending records will persist.
 * Production must not enable this flag: implement and verify the hosted
 * PostgreSQL adapter before handling real users or survey responses.
 */
export function getDatabaseLocation({ env = process.env, moduleDir } = {}) {
  if (!moduleDir) throw new TypeError('moduleDir is required');

  if (env.VERCEL) {
    if (env.INSIGHTLOOP_ALLOW_EPHEMERAL_DEMO === '1' && env.VERCEL_ENV !== 'production') {
      return { dataDir: null, dbPath: ':memory:' };
    }

    throw new Error(
      'InsightLoop cannot start on Vercel with the SQLite demo database. ' +
      'For preview-only smoke tests, set INSIGHTLOOP_ALLOW_EPHEMERAL_DEMO=1. ' +
      'Production requires a persistent PostgreSQL adapter.'
    );
  }

  const projectDir = path.resolve(moduleDir, '..');
  const defaultDataDir = path.join(projectDir, 'data');
  const dbPath = env.INSIGHTLOOP_DB_PATH || path.join(defaultDataDir, 'insightloop.db');

  if (dbPath !== ':memory:' && !path.isAbsolute(dbPath)) {
    throw new Error('INSIGHTLOOP_DB_PATH must be an absolute path or ":memory:".');
  }

  return {
    dataDir: dbPath === ':memory:' ? null : path.dirname(dbPath),
    dbPath,
  };
}
