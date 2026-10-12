import path from 'node:path';

/**
 * Select a database location for the SQLite local/demo adapter.
 * The Node HTTP server does not currently implement a persistent PostgreSQL
 * adapter, so serverless deployments must fail closed instead of using
 * ephemeral SQLite or attempting writes to the read-only deployment image.
 */
export function getDatabaseLocation({ env = process.env, moduleDir } = {}) {
  if (!moduleDir) throw new TypeError('moduleDir is required');

  if (env.VERCEL) {
    throw new Error(
      'InsightLoop cannot start on Vercel with the SQLite demo database. ' +
      'The Node server has no configured persistent PostgreSQL adapter. ' +
      'Use local/demo mode or complete and verify the hosted database adapter before deployment.'
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
