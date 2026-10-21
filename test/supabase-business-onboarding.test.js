import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBusinessCreated } from '../public/js/supabase/business-onboarding.js';

function fakeClient({ membership = null, membershipError = null, invokeResult = { data: { id: 'synthetic-business' }, error: null } } = {}) {
  const calls = { membership: [], invoke: [] };
  return {
    calls,
    from(table) {
      assert.equal(table, 'business_members');
      return { select(columns) {
        assert.equal(columns, 'business_id');
        return { eq(column, value) {
          calls.membership.push({ column, value });
          return { async maybeSingle() { return { data: membership, error: membershipError }; } };
        }};
      }};
    },
    functions: { async invoke(name, options) { calls.invoke.push({ name, options }); return invokeResult; } },
  };
}
test('business setup is idempotent when an owner membership already exists', async () => {
  const client = fakeClient({ membership: { business_id: 'existing-business' } });
  const result = await ensureBusinessCreated(client, { id: 'synthetic-user', user_metadata: { legal_name: 'Example Ltd' } });
  assert.deepEqual(result, { created: false, businessId: 'existing-business' });
  assert.equal(client.calls.invoke.length, 0);
});
test('business setup invokes the authenticated Edge Function using saved signup metadata', async () => {
  const client = fakeClient();
  const result = await ensureBusinessCreated(client, { id: 'synthetic-user', user_metadata: {
    legal_name: ' Example Ltd ', city: 'Anantapur', category: 'services', gstin: 'TEST-GSTIN',
  }});
  assert.deepEqual(result, { created: true, businessId: 'synthetic-business' });
  assert.deepEqual(client.calls.invoke, [{ name: 'create-business', options: { body: {
    legal_name: 'Example Ltd', city: 'Anantapur', category: 'services', gstin: 'TEST-GSTIN',
  }}}]);
});
test('business setup refuses missing metadata without calling the Edge Function', async () => {
  const client = fakeClient();
  await assert.rejects(() => ensureBusinessCreated(client, { id: 'synthetic-user', user_metadata: {} }), /setup is incomplete/i);
  assert.equal(client.calls.invoke.length, 0);
});
test('business setup surfaces membership and Edge Function errors', async () => {
  const membershipFailure = fakeClient({ membershipError: new Error('RLS read failed') });
  await assert.rejects(() => ensureBusinessCreated(membershipFailure, { id: 'synthetic-user', user_metadata: { legal_name: 'Example Ltd' } }), /RLS read failed/);
  const functionFailure = fakeClient({ invokeResult: { data: null, error: new Error('Function unavailable') } });
  await assert.rejects(() => ensureBusinessCreated(functionFailure, { id: 'synthetic-user', user_metadata: { legal_name: 'Example Ltd' } }), /Function unavailable/);
});
