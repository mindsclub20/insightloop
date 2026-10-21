// Idempotent client orchestration for the server-authorized create-business Edge Function.
// The Edge Function verifies the caller's JWT and BUSINESS role; this module never writes business rows directly.
export async function ensureBusinessCreated(supabase, user) {
  if (!user?.id) throw new Error('Sign in to finish business setup.');
  const { data: membership, error: membershipError } = await supabase
    .from('business_members').select('business_id').eq('user_id', user.id).maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.business_id) return { created: false, businessId: membership.business_id };

  const metadata = user.user_metadata || {};
  const legal_name = typeof metadata.legal_name === 'string' ? metadata.legal_name.trim() : '';
  if (!legal_name) {
    throw new Error('Business setup is incomplete for this account. Contact Anvesh support before registering again.');
  }
  const { data, error } = await supabase.functions.invoke('create-business', {
    body: {
      legal_name,
      city: typeof metadata.city === 'string' ? metadata.city : null,
      category: typeof metadata.category === 'string' ? metadata.category : null,
      gstin: typeof metadata.gstin === 'string' ? metadata.gstin : null,
    },
  });
  if (error) throw error;
  if (!data?.id) throw new Error('Business setup did not return a valid business record.');
  return { created: true, businessId: data.id };
}
// Login must distinguish valid credentials from a temporarily unavailable business
// provisioning dependency. The caller can keep the authenticated session and retry.
export async function ensureBusinessCreatedForLogin(supabase, user) {
  try {
    const result = await ensureBusinessCreated(supabase, user);
    return { ready: true, ...result };
  } catch (error) {
    return { ready: false, error };
  }
}
