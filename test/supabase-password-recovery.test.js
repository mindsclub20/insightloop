import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPasswordReset, applyPasswordReset } from '../public/js/supabase/password-recovery.js';

function fakeClient({ resetError = null, updateError = null } = {}) {
  const calls = { reset: [], update: [] };
  return {
    calls,
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.reset.push({ email, options });
        return { error: resetError };
      },
      async updateUser(attributes) {
        calls.update.push(attributes);
        return { data: { user: { id: 'mock-user' } }, error: updateError };
      },
    },
  };
}

test('password reset rejects a blank email before contacting Supabase', async () => {
  const client = fakeClient();
  await assert.rejects(() => requestPasswordReset(client, '   ', 'https://example.test/supabase-login.html'), /email/i);
  assert.equal(client.calls.reset.length, 0);
});

test('password reset sends the trimmed email and the configured redirect URL', async () => {
  const client = fakeClient();
  await requestPasswordReset(client, '  admin@example.test  ', 'https://example.test/supabase-login.html');
  assert.deepEqual(client.calls.reset, [{
    email: 'admin@example.test',
    options: { redirectTo: 'https://example.test/supabase-login.html' },
  }]);
});

test('password reset surfaces Supabase errors instead of claiming success', async () => {
  const client = fakeClient({ resetError: new Error('redirect URL not allowed') });
  await assert.rejects(
    () => requestPasswordReset(client, 'admin@example.test', 'https://example.test/supabase-login.html'),
    /redirect URL not allowed/,
  );
});

test('new password rejects values shorter than eight characters', async () => {
  const client = fakeClient();
  await assert.rejects(() => applyPasswordReset(client, 'short', 'short'), /8 characters/i);
  assert.equal(client.calls.update.length, 0);
});

test('new password rejects mismatched confirmation', async () => {
  const client = fakeClient();
  await assert.rejects(() => applyPasswordReset(client, 'correct-horse-1', 'different-password'), /do not match/i);
  assert.equal(client.calls.update.length, 0);
});

test('new password updates the authenticated recovery session', async () => {
  const client = fakeClient();
  const result = await applyPasswordReset(client, 'correct-horse-1', 'correct-horse-1');
  assert.deepEqual(client.calls.update, [{ password: 'correct-horse-1' }]);
  assert.equal(result.user.id, 'mock-user');
});

test('new password surfaces Supabase update errors', async () => {
  const client = fakeClient({ updateError: new Error('recovery session expired') });
  await assert.rejects(() => applyPasswordReset(client, 'correct-horse-1', 'correct-horse-1'), /recovery session expired/);
});
