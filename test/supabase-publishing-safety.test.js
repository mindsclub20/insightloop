import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publishEndpoint = await readFile(new URL('../supabase/functions/publish-survey/index.ts', import.meta.url), 'utf8');
const adminAction = await readFile(new URL('../supabase/functions/admin-study-action/index.ts', import.meta.url), 'utf8');

test('legacy publish endpoint cannot directly activate a survey', () => {
  assert.match(publishEndpoint, /Direct activation is disabled/);
  assert.match(publishEndpoint, /return json\([\s\S]*?, 409\)/);
  assert.doesNotMatch(publishEndpoint, /update\(\{\s*status:\s*'ACTIVE'/);
});

test('admin activation requires confirmed funding and checks both status updates', () => {
  assert.match(adminAction, /payment\.status !== 'SUCCESS'/);
  assert.match(adminAction, /Reward funding is not confirmed/);
  assert.match(adminAction, /if \(approveError\) throw/);
  assert.match(adminAction, /if \(activateError\) throw/);
});
