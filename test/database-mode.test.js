import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertDatabaseMode } from '../src/lib/database-mode.js';

test('allows SQLite for local development', () => {
  assert.doesNotThrow(() => assertDatabaseMode({}));
});

test('always rejects SQLite in Vercel production, even if preview opt-in is set', () => {
  assert.throws(
    () => assertDatabaseMode({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      INSIGHTLOOP_ALLOW_EPHEMERAL_SQLITE: '1',
    }),
    /production requires the Neon PostgreSQL adapter/
  );
});

test('requires explicit opt-in for disposable preview SQLite', () => {
  assert.throws(
    () => assertDatabaseMode({ VERCEL: '1', VERCEL_ENV: 'preview' }),
    /SQLite demo adapter/
  );
  assert.doesNotThrow(() => assertDatabaseMode({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    INSIGHTLOOP_ALLOW_EPHEMERAL_SQLITE: '1',
  }));
});
