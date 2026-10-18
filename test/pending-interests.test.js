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


test('sync restores interests from durable Auth metadata when local pending storage is empty', async () => {
  const storage = makeStorage();
  let inserted;
  const client = {
    from(table) {
      assert.equal(table, 'user_interests');
      return {
        select() { return { eq: async () => ({ data: [], error: null }) }; },
        insert: async (rows) => { inserted = rows; return { error: null }; },
      };
    },
  };
  const { syncUserInterests } = await import('../public/js/supabase/pending-interests.js');
  assert.equal(await syncUserInterests(storage, {
    id: 'user-a', user_metadata: { interests: [' Food ', 'books', 'food'] },
  }, client), true);
  assert.deepEqual(inserted, [
    { user_id: 'user-a', tag: 'food' },
    { user_id: 'user-a', tag: 'books' },
  ]);
  assert.equal(storage.getItem('anvesh.pendingInterests:user-a'), null);
});

test('sync merges Auth metadata and local pending interests without duplicates', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['books', 'music']);
  let inserted;
  const client = {
    from() {
      return {
        select() { return { eq: async () => ({ data: [{ tag: 'books' }], error: null }) }; },
        insert: async (rows) => { inserted = rows; return { error: null }; },
      };
    },
  };
  const { syncUserInterests } = await import('../public/js/supabase/pending-interests.js');
  await syncUserInterests(storage, { id: 'user-a', user_metadata: { interests: ['food', 'books'] } }, client);
  assert.deepEqual(inserted, [
    { user_id: 'user-a', tag: 'food' },
    { user_id: 'user-a', tag: 'music' },
  ]);
});


test('production sync uses the authenticated save-user-interests Edge Function', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['Food', 'books']);
  let invocation;
  const client = {
    functions: {
      invoke: async (name, options) => {
        invocation = { name, options };
        return { data: { saved: 2, total: 2 }, error: null };
      },
    },
    from() { throw new Error('production sync should use the Edge Function'); },
  };
  assert.equal(await syncPendingInterests(storage, 'user-a', client), true);
  assert.deepEqual(invocation, {
    name: 'save-user-interests',
    options: { body: { interests: ['food', 'books'] } },
  });
  assert.equal(storage.getItem('anvesh.pendingInterests:user-a'), null);
});

test('production sync retains queued interests if the Edge Function rejects the save', async () => {
  const storage = makeStorage();
  rememberPendingInterests(storage, 'user-a', ['food']);
  const client = {
    functions: {
      invoke: async () => ({ data: null, error: new Error('Could not save interests.') }),
    },
  };
  await assert.rejects(syncPendingInterests(storage, 'user-a', client), /Could not save interests/);
  assert.ok(storage.getItem('anvesh.pendingInterests:user-a'));
});
