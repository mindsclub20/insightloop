// Supabase Auth is the source of truth for credentials and sessions.
import { supabase } from './client.js';
import { normalizeInterests, persistPendingInterests } from './interests.js';

// Confirmation links must land on the page that understands both Supabase
// token-hash links and the normal PKCE/access-token callback.
function getEmailRedirectTo() {
  return new URL('/auth/confirm.html', window.location.origin).toString();
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function registerParticipant({
  email, password, full_name, city, area, age_range, gender,
  occupation_category, date_of_birth, interests,
}) {
  if (!date_of_birth) throw new Error('Date of birth is required.');
  const dob = new Date(date_of_birth + 'T00:00:00Z');
  if (Number.isNaN(dob.getTime())) throw new Error('Enter a valid date of birth.');
  const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age < 18) throw new Error('InsightLoop participants must be 18 or older.');

  const pendingInterests = normalizeInterests(interests);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
      data: {
        full_name, city, area, age_range, gender, occupation_category,
        date_of_birth, account_type: 'participant',
        // Email confirmation may mean there is no session yet. Keep these
        // harmless profile preferences in user metadata until confirmation.
        pending_interests: pendingInterests,
      },
    },
  });
  if (error) throw error;

  // With confirmation enabled, Supabase returns no session. Do not attempt
  // an RLS-protected insert before the user has verified their email.
  if (data.session && pendingInterests.length) {
    await persistPendingInterests(supabase, data.user);
  }
  return { ...data, needsEmailConfirmation: !data.session };
}

export async function registerBusiness({
  email, password, full_name, legal_name, city, category, gstin,
}) {
  if (!legal_name?.trim()) throw new Error('Business legal name is required.');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
      data: {
        full_name,
        account_type: 'business',
        legal_name: legal_name.trim(),
        city: city || null,
        category: category || null,
        gstin: gstin || null,
      },
    },
  });
  if (error) throw error;
  return { ...data, needsEmailConfirmation: !data.session };
}

export async function getCurrentUserAndProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return { user: null, profile: null };
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return { user, profile };
}
