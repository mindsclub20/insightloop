import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDatabaseLocation } from '../src/lib/database-path.js';

test('rejects Vercel startup instead of selecting ephemeral SQLite storage', () => {
  assert.throws(
    () => getDatabaseLocation({ env: { VERCEL: '1' }, moduleDir: '/var/task/src' }),
    /cannot start on Vercel.*SQLite demo database/i,
  );
});

test('rejects an explicit SQLite path on Vercel as well', () => {
  assert.throws(
    () => getDatabaseLocation({
      env: { VERCEL: '1', INSIGHTLOOP_DB_PATH: '/tmp/custom.sqlite' },
      moduleDir: '/var/task/src',
    }),
    /persistent PostgreSQL adapter/i,
  );
});

test('keeps local development data in the repository data directory', () => {
  const location = getDatabaseLocation({ env: {}, moduleDir: '/workspace/insightloop/src' });
  assert.equal(location.dataDir, path.resolve('/workspace/insightloop/data'));
  assert.equal(location.dbPath, path.resolve('/workspace/insightloop/data/insightloop.db'));
});

test('supports an explicit absolute SQLite path for local/demo use', () => {
  const location = getDatabaseLocation({
    env: { INSIGHTLOOP_DB_PATH: '/tmp/insightloop-test.sqlite' },
    moduleDir: '/workspace/insightloop/src',
  });
  assert.equal(location.dbPath, '/tmp/insightloop-test.sqlite');
  assert.equal(location.dataDir, '/tmp');
});

test('supports in-memory SQLite for isolated tests without creating a directory', () => {
  const location = getDatabaseLocation({
    env: { INSIGHTLOOP_DB_PATH: ':memory:' },
    moduleDir: '/workspace/insightloop/src',
  });
  assert.equal(location.dbPath, ':memory:');
  assert.equal(location.dataDir, null);
});

test('rejects a relative explicit SQLite path to avoid ambiguous storage locations', () => {
  assert.throws(
    () => getDatabaseLocation({
      env: { INSIGHTLOOP_DB_PATH: 'data/custom.sqlite' },
      moduleDir: '/workspace/insightloop/src',
    }),
    /must be an absolute path or ":memory:"/,
  );
});

test('database module fails at startup on Vercel before opening SQLite', () => {
  const dbModule = new URL('../src/db.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(dbModule)})`], {
    encoding: 'utf8',
    env: { ...process.env, VERCEL: '1', INSIGHTLOOP_DB_PATH: '' },
  });

  assert.notEqual(result.status, 0, 'database module must refuse unsupported Vercel startup');
  assert.match(result.stderr, /cannot start on Vercel.*SQLite demo database/i);
});
