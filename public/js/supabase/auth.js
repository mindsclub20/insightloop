// public/js/supabase/auth.js
// WRITTEN, NOT EXECUTED. Replaces public/js/api.js's auth-related fetch
// calls and the whole custom scrypt+session-cookie system in
// src/lib/auth.js for this track.

import { supabase, invoke } from './client.js';

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function registerParticipant({ email, password, full_name, city, area, age_range, gender, occupation_category, date_of_birth, interests }) {
  // handle_new_user() (migrations/008) creates the profiles row (role='USER')
  // and enforces the 18+ gate server-side from date_of_birth - this call
  // cannot succeed in creating an under-18 account no matter what this
  // client does or doesn't check first.
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, city, area, age_range, gender, occupation_category, date_of_birth, account_type: 'participant' } },
  });
  if (error) throw error;

  if (interests?.length) {
    // "own interests" RLS policy (002) allows this insert for the just-created user.
    await supabase.from('user_interests').insert(interests.map((tag) => ({ user_id: data.user.id, tag })));
  }
  return data;
}

// Two-step by necessity - see supabase/functions/create-business/index.ts's
// header comment for exactly why signUp() alone can't create the
// businesses row.
export async function registerBusiness({ email, password, full_name, legal_name, city, category, gstin }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name, account_type: 'business' } },
  });
  if (error) throw error;

  // Signing up does NOT automatically create a session if your Supabase
  // project has "Confirm email" enabled (Authentication -> Providers) - in
  // that case data.session is null here and this second call will fail
  // with 401 until the user confirms their email and logs in. Decide your
  // project's email-confirmation setting with that in mind; this function
  // does not special-case it.
  const business = await invoke('create-business', { legal_name, city, category, gstin });
  return { user: data.user, business };
}

export async function getCurrentUserAndProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return { user, profile };
}
