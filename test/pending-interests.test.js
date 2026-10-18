import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberPendingInterests, syncPendingInterests } from '../public/js/supabase/pending-interests.js';

function makeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('pending interests are normalized and deduplicated per user', () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', [' Food ', 'food', '', 'Books']);
  assert.deepEqual(JSON.parse(storage.getItem('anvesh.pendingInterests:user-a')), {
    userId: 'user-a', tags: ['food', 'books'],
  });
});

test('pending interests for another account are never read or inserted', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['food']);
  let called = false;
  const client = { from() { called = true; throw new Error('must not query'); } };
  assert.equal(await syncPendingInterests(storage, 'user-b', client), false);
  assert.equal(called, false);
  assert.ok(storage.getItem('anvesh.pendingInterests:user-a'));
});

test('sync inserts only missing interests and clears the pending entry', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['food', 'books', 'food']);
  let inserted;
  const client = {
    from(table) {
      assert.equal(table, 'user_interests');
      return {
        select() { return { eq: async (_column, value) => ({ data: value === 'user-a' ? [{ tag: 'food' }] : [], error: null }) }; },
        insert: async (rows) => { inserted = rows; return { error: null }; },
      };
    },
  };
  assert.equal(await syncPendingInterests(storage, 'user-a', client), true);
  assert.deepEqual(inserted, [{ user_id: 'user-a', tag: 'books' }]);
  assert.equal(storage.getItem('anvesh.pendingInterests:user-a'), null);
});

test('sync preserves pending interests when the database rejects an insert', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['food']);
  const client = {
    from() { return {
      select() { return { eq: async () => ({ data: [], error: null }) }; },
      insert: async () => ({ error: new Error('temporary database error') }),
    }; },
  };
  await assert.rejects(syncPendingInterests(storage, 'user-a', client), /temporary database error/);
  assert.ok(storage.getItem('anvesh.pendingInterests:user-a'));
});
