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

  // The interests table is intentionally protected by RLS. Only call the
  // trusted endpoint with a valid session for the same user; never weaken RLS
  // to hide an authentication/session mismatch.
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token || session.user?.id !== user.id) {
    throw new Error('Your email is verified, but your session is not ready to save interests. Log in again to finish setting up your profile.');
  }

  const { data, error } = await supabase.functions.invoke('save-user-interests', {
    body: { interests: tags },
  });
  if (error) {
    let message = error.message || 'Could not save interests.';
    try {
      const details = await error.context?.json();
      if (details?.error) message = details.error;
    } catch { /* keep the SDK message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data || { saved: 0 };
}
