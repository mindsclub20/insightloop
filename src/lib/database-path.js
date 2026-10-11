import path from 'node:path';

/**
 * Select a database location for local development or Vercel's writable
 * temporary filesystem. Vercel's deployed source tree (/var/task) is read-only.
 *
 * SQLite under /tmp is ephemeral on serverless platforms; it is suitable only
 * for a demo/preview. Production data must use a persistent hosted database.
 */
export function getDatabaseLocation({ env = process.env, moduleDir } = {}) {
  if (!moduleDir) throw new TypeError('moduleDir is required');

  const projectDir = path.resolve(moduleDir, '..');
  const defaultDataDir = env.VERCEL
    ? path.join('/tmp', 'insightloop')
    : path.join(projectDir, 'data');
  const dbPath = env.INSIGHTLOOP_DB_PATH || path.join(defaultDataDir, 'insightloop.db');

  return {
    dataDir: dbPath === ':memory:' ? null : path.dirname(dbPath),
    dbPath,
  };
}
