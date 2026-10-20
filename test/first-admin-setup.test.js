import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../supabase/functions/first-admin-setup/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/023_first_time_admin_bootstrap.sql', import.meta.url), 'utf8');
const page = await readFile(new URL('../public/supabase-admin/first-time-setup.html', import.meta.url), 'utf8');

test('first-admin setup fails closed unless server-side owner and bootstrap secrets are configured', () => {
  assert.match(edge, /ANVESH_ADMIN_EMAIL/);
  assert.match(edge, /ANVESH_ADMIN_BOOTSTRAP_SECRET/);
  assert.match(edge, /bootstrapSecret\.length < 32/);
  assert.match(edge, /First-time admin setup is not configured on the server/);
});

test('first-admin setup requires a confirmed authenticated owner and rejects an existing administrator', () => {
  assert.match(edge, /auth\.getUser\(match\[1\]\)/);
  assert.match(edge, /user\.email_confirmed_at/);
  assert.match(edge, /!== ownerEmail/);
  assert.match(edge, /token_admin_allowlist/);
  assert.match(edge, /First-time setup is closed/);
});

test('database bootstrap is service-role-only and refuses to run after an admin exists', () => {
  assert.match(migration, /auth\.role\(\).*service_role/s);
  assert.match(migration, /token_admin_allowlist where enabled = true/);
  assert.match(migration, /role in \('ADMIN', 'SUPER_ADMIN'\)/);
  assert.match(migration, /grant execute on function public\.bootstrap_first_token_admin\(uuid\) to service_role/i);
  assert.match(migration, /revoke all on function public\.bootstrap_first_token_admin\(uuid\) from public, anon, authenticated/i);
});

test('setup UI never asks for the account password or email verification code', () => {
  assert.match(page, /One-time setup key/);
  assert.doesNotMatch(page, /type="password"[^>]*id="password"/);
  assert.match(page, /functions\.invoke\('first-admin-setup'/);
});
