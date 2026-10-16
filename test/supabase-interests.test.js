import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInterests, persistPendingInterests } from '../public/js/supabase/interests.js';

test('normalizeInterests trims, lowercases, removes blanks and duplicates', () => {
  assert.deepEqual(
    normalizeInterests([' Food ', 'FOOD', '', 'smartphones', null, ' fashion ']),
    ['food', 'smartphones', 'fashion'],
  );
});

test('persistPendingInterests uses the authenticated server endpoint for the matching user', async () => {
  let calledFunction = null;
  let sentBody = null;
  const supabase = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'test-token', user: { id: 'user-123' } } }, error: null };
      },
    },
    functions: {
      async invoke(name, options) {
        calledFunction = name;
        sentBody = options.body;
        return { data: { saved: 1, total: 3 }, error: null };
      },
    },
  };

  const result = await persistPendingInterests(supabase, {
    id: 'user-123',
    user_metadata: { pending_interests: [' Food ', 'FOOD', 'technology', 'fashion'] },
  });

  assert.equal(calledFunction, 'save-user-interests');
  assert.deepEqual(sentBody, { interests: ['food', 'technology', 'fashion'] });
  assert.deepEqual(result, { saved: 1, total: 3 });
});

test('persistPendingInterests refuses a missing or mismatched session', async () => {
  let invoked = false;
  const supabase = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: 'test-token', user: { id: 'someone-else' } } }, error: null };
      },
    },
    functions: {
      async invoke() { invoked = true; return { data: {}, error: null }; },
    },
  };
  await assert.rejects(
    persistPendingInterests(supabase, {
      id: 'user-123',
      user_metadata: { pending_interests: ['food'] },
    }),
    /session is not ready/,
  );
  assert.equal(invoked, false);
});

test('persistPendingInterests does not write when there is no user or no pending interests', async () => {
  let invoked = false;
  const supabase = {
    auth: { async getSession() { throw new Error('should not be called'); } },
    functions: { async invoke() { invoked = true; } },
  };
  assert.deepEqual(await persistPendingInterests(supabase, null), { saved: 0 });
  assert.deepEqual(await persistPendingInterests(supabase, {
    id: 'user-123',
    user_metadata: { pending_interests: [] },
  }), { saved: 0 });
  assert.equal(invoked, false);
});
