import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { getDatabaseLocation } from '../src/lib/database-path.js';

test('uses a writable temporary directory for Vercel deployments', () => {
  const location = getDatabaseLocation({
    env: { VERCEL: '1' },
    moduleDir: '/var/task/src',
  });

  assert.equal(location.dataDir, '/tmp/insightloop');
  assert.equal(location.dbPath, '/tmp/insightloop/insightloop.db');
});

test('respects an explicit database path', () => {
  const location = getDatabaseLocation({
    env: { VERCEL: '1', INSIGHTLOOP_DB_PATH: '/tmp/custom.sqlite' },
    moduleDir: '/var/task/src',
  });

  assert.equal(location.dbPath, '/tmp/custom.sqlite');
});

test('keeps local development data in the repository data directory', () => {
  const location = getDatabaseLocation({
    env: {},
    moduleDir: '/workspace/insightloop/src',
  });

  assert.equal(location.dataDir, path.resolve('/workspace/insightloop/data'));
  assert.equal(location.dbPath, path.resolve('/workspace/insightloop/data/insightloop.db'));
});
