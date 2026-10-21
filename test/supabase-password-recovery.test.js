import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestPasswordReset, applyPasswordReset, isMissingAuthSessionError,
  getPasswordRecoveryRedirectTo, isPasswordRecoveryLink,
} from '../public/js/supabase/password-recovery.js';

function fakeClient({ resetError = null, updateError = null } = {}) {
  const calls = { reset: [], update: [] };
  return { calls, auth: {
    async resetPasswordForEmail(email, options) { calls.reset.push({ email, options }); return { error: resetError }; },
    async updateUser(attributes) { calls.update.push(attributes); return { data: { user: { id: 'synthetic-user' } }, error: updateError }; },
  }};
}
test('password reset rejects blank email before contacting Supabase', async () => {
  const client = fakeClient();
  await assert.rejects(() => requestPasswordReset(client, '  ', 'https://example.test/'), /email/i);
  assert.equal(client.calls.reset.length, 0);
});
test('password reset trims email and uses the existing site root callback', async () => {
  const client = fakeClient();
  await requestPasswordReset(client, ' owner@example.test ', 'https://example.test/');
  assert.deepEqual(client.calls.reset, [{ email: 'owner@example.test', options: { redirectTo: 'https://example.test/' } }]);
});
test('password reset reports provider errors rather than false success', async () => {
  const client = fakeClient({ resetError: new Error('redirect URL not allowed') });
  await assert.rejects(() => requestPasswordReset(client, 'owner@example.test', 'https://example.test/'), /redirect URL not allowed/);
});
test('password update validates length and confirmation before provider calls', async () => {
  const client = fakeClient();
  await assert.rejects(() => applyPasswordReset(client, 'short', 'short'), /8 characters/i);
  await assert.rejects(() => applyPasswordReset(client, 'correct-password', 'different-password'), /do not match/i);
  assert.equal(client.calls.update.length, 0);
});
test('password update calls Supabase and surfaces provider errors', async () => {
  const client = fakeClient();
  const result = await applyPasswordReset(client, 'correct-password', 'correct-password');
  assert.equal(result.user.id, 'synthetic-user');
  assert.deepEqual(client.calls.update, [{ password: 'correct-password' }]);
  const failing = fakeClient({ updateError: new Error('recovery session expired') });
  await assert.rejects(() => applyPasswordReset(failing, 'correct-password', 'correct-password'), /session expired/);
});
test('recovery callback detection accepts hash and query variants only', () => {
  assert.equal(isPasswordRecoveryLink('#type=recovery', ''), true);
  assert.equal(isPasswordRecoveryLink('', '?recovery=1'), true);
  assert.equal(isPasswordRecoveryLink('#type=signup', ''), false);
  assert.equal(isPasswordRecoveryLink('', ''), false);
});
test('missing auth session is identified without swallowing unrelated errors', () => {
  assert.equal(isMissingAuthSessionError({ name: 'AuthSessionMissingError', message: 'Auth session missing' }), true);
  assert.equal(isMissingAuthSessionError(new Error('Network request failed')), false);
});
test('password recovery redirect is rooted at the current site', () => {
  assert.equal(getPasswordRecoveryRedirectTo('https://example.test'), 'https://example.test/');
});
