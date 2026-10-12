import path from 'node:path';

/**
 * Select a database location for the SQLite local/demo adapter.
 *
 * This repository does not currently implement a PostgreSQL adapter for the
 * Node HTTP server. Vercel deployments must therefore fail closed instead of
 * opening SQLite under /tmp or the read-only application filesystem.
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
