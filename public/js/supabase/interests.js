// Persist interests collected before email verification only after a valid session exists.
export function normalizeInterests(interests) {
  if (!Array.isArray(interests)) return [];
  const seen = new Set();
  const normalized = [];
  for (const value of interests) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().toLowerCase().slice(0, 60);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length === 20) break;
  }
  return normalized;
}

export async function persistPendingInterests(supabase, user) {
  const tags = normalizeInterests(user?.user_metadata?.pending_interests);
  if (!user?.id || !tags.length) return { saved: 0 };

  const { data: existingRows, error: readError } = await supabase
    .from('user_interests')
    .select('tag')
    .eq('user_id', user.id);
  if (readError) throw readError;

  const existing = new Set((existingRows || []).map((row) => String(row.tag).toLowerCase()));
  const rows = tags
    .filter((tag) => !existing.has(tag))
    .map((tag) => ({ user_id: user.id, tag }));

  if (rows.length) {
    const { error: insertError } = await supabase.from('user_interests').insert(rows);
    if (insertError) throw insertError;
  }

  const { error: metadataError } = await supabase.auth.updateUser({
    data: { pending_interests: null },
  });
  if (metadataError) throw metadataError;

  return { saved: rows.length };
}
