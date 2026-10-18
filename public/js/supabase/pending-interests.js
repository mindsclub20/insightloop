// Keep participant interests until the user has an authenticated session.
// Signup metadata is the durable fallback when email confirmation happens on
// another tab, browser, or Vercel alias where localStorage is not shared.
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

  const existingTags = new Set((existing || []).map((row) => String(row.tag).trim().toLowerCase()));
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

// Merge durable Auth metadata with any local queue before syncing. This
// restores signup interests even if confirmation/login occurred on a
// different origin and the original browser's localStorage is unavailable.
export async function syncUserInterests(storage, user, client) {
  if (!user?.id || !storage || !client) return false;
  const key = storageKey(user.id);
  let localTags = [];
  try {
    const pending = JSON.parse(storage.getItem(key) || 'null');
    if (pending?.userId === user.id && Array.isArray(pending.tags)) localTags = pending.tags;
  } catch { storage.removeItem(key); }

  const metadataTags = Array.isArray(user.user_metadata?.interests) ? user.user_metadata.interests : [];
  const combined = normalizeTags([...metadataTags, ...localTags]);
  if (!combined.length) return false;
  rememberPendingInterests(storage, user.id, combined);
  return syncPendingInterests(storage, user.id, client);
}
