// Supabase Auth is the source of truth for credentials and sessions.
import { supabase } from './client.js';

// Use the current app origin so production confirmation links do not fall back
// to Supabase's default localhost:3000 URL. This origin must be allowed in
// Supabase Dashboard → Authentication → URL Configuration.
function getEmailRedirectTo() {
  return new URL('/', window.location.origin).toString();
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
  if (age < 18) throw new Error('Anvesh participants must be 18 or older.');

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
      data: {
        full_name, city, area, age_range, gender, occupation_category,
        date_of_birth, account_type: 'participant',
      },
    },
  });
  if (error) throw error;

  if (data.user && interests?.length) {
    const { error: interestsError } = await supabase.from('user_interests').insert(
      interests.map((tag) => ({ user_id: data.user.id, tag })),
    );
    if (interestsError) throw interestsError;
  }
  return { ...data, needsEmailConfirmation: !data.session };
}

export async function registerBusiness({
  email, password, full_name, legal_name, city, category, gstin,
}) {
  if (!legal_name?.trim()) throw new Error('Business legal name is required.');
  // Migration 019 creates the profile, wallet, business, and owner membership
  // transactionally from this server-verified Auth signup event.
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
