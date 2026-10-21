import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBusinessCreatedForLogin } from '../public/js/supabase/business-onboarding.js';

function client({ membershipError = null, invokeResult = { data: { id: 'synthetic-business' }, error: null } } = {}) {
  return {
    from() { return { select() { return { eq() { return { async maybeSingle() { return { data: null, error: membershipError }; } }; }; }; }; },
    functions: { async invoke() { return invokeResult; } },
  };
}
test('valid business login can continue when provisioning succeeds', async () => {
  const result = await ensureBusinessCreatedForLogin(client(), { id: 'synthetic-user', user_metadata: { legal_name: 'Example Ltd' } });
  assert.deepEqual(result, { ready: true, created: true, businessId: 'synthetic-business' });
});
test('provisioning failure is represented as pending setup, not an auth failure', async () => {
  const result = await ensureBusinessCreatedForLogin(client({ membershipError: new Error('temporary database outage') }), { id: 'synthetic-user', user_metadata: { legal_name: 'Example Ltd' } });
  assert.equal(result.ready, false);
  assert.match(result.error.message, /temporary database outage/);
});
