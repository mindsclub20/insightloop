import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/020_live_security_hardening.sql', import.meta.url), 'utf8');
const roleClaimMigration = await readFile(new URL('../migrations/021_role_claim_guard_update.sql', import.meta.url), 'utf8');

test('security migration blocks self-service role escalation and records legitimate role changes', () => {
  assert.match(migration, /private\.prevent_profile_role_escalation/);
  assert.match(migration, /private\.current_user_role\(\) is distinct from 'SUPER_ADMIN'/);
  assert.match(migration, /auth\.role\(\).*service_role/s);
  assert.match(migration, /profiles_audit_role_change/);
  assert.match(migration, /insert into public\.audit_logs/);
});

test('security migration denies direct client writes to response and ledger tables', () => {
  for (const table of ['survey_responses', 'answers', 'wallets', 'wallet_transactions', 'withdrawals']) {
    assert.match(
      migration,
      new RegExp('revoke insert, update, delete on public\\.' + table + ' from public, anon, authenticated;'),
      'missing direct-write revoke for ' + table,
    );
  }
});

test('security migration removes participant self-write policies for submitted responses', () => {
  for (const policy of [
    'responses_insert_self',
    'survey_responses_self_insert',
    'responses_update_self_admin',
    'answers_insert_owner',
    'answers_self_insert',
    'answers_update_owner_admin',
  ]) {
    assert.match(migration, new RegExp('drop policy if exists ' + policy));
  }
});

test('follow-up uses the current JWT role claim instead of deprecated auth.role()', () => {
  assert.match(roleClaimMigration, /auth\.jwt\(\)\s*->>\s*'role'/);
  assert.doesNotMatch(roleClaimMigration, /auth\.role\(\)/);
});
