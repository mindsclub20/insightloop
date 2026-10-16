import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInterests, persistPendingInterests } from '../public/js/supabase/interests.js';

test('normalizeInterests trims, lowercases, removes blanks and duplicates', () => {
  assert.deepEqual(
    normalizeInterests([' Food ', 'FOOD', '', 'smartphones', null, ' fashion ']),
    ['food', 'smartphones', 'fashion'],
  );
});

test('persistPendingInterests inserts only interests not already saved', async () => {
  const inserted = [];
  let metadataCleared = false;
  const supabase = {
    from(table) {
      assert.equal(table, 'user_interests');
      return {
        select() {
          return {
            async eq(column, value) {
              assert.equal(column, 'user_id');
              assert.equal(value, 'user-123');
              return { data: [{ tag: 'food' }, { tag: 'fashion' }], error: null };
            },
          };
        },
        async insert(rows) {
          inserted.push(...rows);
          return { error: null };
        },
      };
    },
    auth: {
      async updateUser({ data }) {
        metadataCleared = data.pending_interests === null;
        return { error: null };
      },
    },
  };

  const result = await persistPendingInterests(supabase, {
    id: 'user-123',
    user_metadata: { pending_interests: ['food', 'fashion', 'technology'] },
  });

  assert.equal(result.saved, 1);
  assert.deepEqual(inserted, [{ user_id: 'user-123', tag: 'technology' }]);
  assert.equal(metadataCleared, true);
});

test('persistPendingInterests does not write without a confirmed user session', async () => {
  let called = false;
  const supabase = { from() { called = true; throw new Error('should not access DB'); } };
  assert.deepEqual(await persistPendingInterests(supabase, null), { saved: 0 });
  assert.equal(called, false);
});
