// Keep participant interests until the user has an authenticated session.
// Supabase rejects user_interests inserts before email confirmation because RLS
// correctly requires auth.uid() to match user_id.
const STORAGE_PREFIX = 'anvesh.pendingInterests:';

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))];
}

function storageKey(userId) {
  return STORAGE_PREFIX + userId;
}

export function rememberPendingInterests(storage, userId, tags) {
  if (!storage || !userId) return;
  const normalized = normalizeTags(tags);
  const key = storageKey(userId);
  if (!normalized.length) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ userId, tags: normalized }));
}

export async function syncPendingInterests(storage, userId, client) {
  if (!storage || !userId || !client) return false;
  const key = storageKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return false;

  let pending;
  try { pending = JSON.parse(raw); }
  catch { storage.removeItem(key); return false; }
  if (pending?.userId !== userId || !Array.isArray(pending.tags)) return false;

  const tags = normalizeTags(pending.tags);
  const { data: existing, error: readError } = await client
    .from('user_interests').select('tag').eq('user_id', userId);
  if (readError) throw readError;

  const existingTags = new Set((existing || []).map((row) => String(row.tag).toLowerCase()));
  const missing = tags.filter((tag) => !existingTags.has(tag));
  if (missing.length) {
    const { error: insertError } = await client.from('user_interests').insert(
      missing.map((tag) => ({ user_id: userId, tag })),
    );
    if (insertError) throw insertError;
  }

  storage.removeItem(key);
  return true;
}
