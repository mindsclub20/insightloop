import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/022_atomic_reward_functions.sql', import.meta.url), 'utf8');
const submitFunction = await readFile(new URL('../supabase/functions/submit-survey-response/index.ts', import.meta.url), 'utf8');

test('reward creation validates ownership, amount, idempotency, and confirmed funding', () => {
  assert.match(migration, /p_amount_paise is null or p_amount_paise <= 0/);
  assert.match(migration, /v_response\.user_id <> p_user_id/);
  assert.match(migration, /idempotency_key = v_key/);
  assert.match(migration, /bp\.status = 'SUCCESS'/);
  assert.match(migration, /pending_paise = pending_paise \+ p_amount_paise/);
});

test('reward confirmation is atomic, idempotent, and only confirms pending valid rewards', () => {
  assert.match(migration, /Only a valid response can have its reward confirmed/);
  assert.match(migration, /Only a pending reward can be confirmed/);
  assert.match(migration, /balance_paise = balance_paise \+ v_tx\.amount_paise/);
  assert.match(migration, /pending_paise = pending_paise - v_tx\.amount_paise/);
  assert.match(migration, /grant execute on function public\.confirm_pending_reward_internal\(uuid\) to service_role/);
});

test('reward mutation functions are not executable by browser roles', () => {
  for (const name of [
    'create_pending_reward(uuid, uuid, bigint)',
    'confirm_pending_reward_internal(uuid)',
    'admin_confirm_reward(uuid)',
    'admin_forfeit_reward(uuid)',
  ]) {
    assert.match(migration, new RegExp('revoke all on function public\\.' + name.replace(/[()]/g, '\\$&') + ' from public, anon, authenticated;'));
  }
});

test('survey submission rejects unfunded studies before inserting a response', () => {
  const guardIndex = submitFunction.indexOf('This study is paused because reward funding is not confirmed.');
  const insertIndex = submitFunction.indexOf(".from('survey_responses').insert({");
  assert.ok(guardIndex >= 0, 'funding guard must exist');
  assert.ok(insertIndex >= 0, 'response insert must exist');
  assert.ok(guardIndex < insertIndex, 'funding must be checked before a response is created');
});
