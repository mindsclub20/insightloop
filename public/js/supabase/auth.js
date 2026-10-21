// Supabase Auth is the source of truth for credentials and sessions.
import { supabase } from './client.js';
import { rememberPendingInterests, syncPendingInterests } from './pending-interests.js';
import { ensureBusinessCreated } from './business-onboarding.js';
import {
  requestPasswordReset as requestPasswordResetWithClient,
  applyPasswordReset as applyPasswordResetWithClient,
  getPasswordRecoveryRedirectTo,
  isMissingAuthSessionError,
} from './password-recovery.js';

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

export async function requestPasswordReset(email) {
  return requestPasswordResetWithClient(supabase, email, getPasswordRecoveryRedirectTo(window.location.origin));
}

export async function applyPasswordReset(password, confirmPassword) {
  return applyPasswordResetWithClient(supabase, password, confirmPassword);
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

  const normalizedInterests = [...new Set((Array.isArray(interests) ? interests : [])
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))];

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
      data: {
        full_name, city, area, age_range, gender, occupation_category,
        date_of_birth, account_type: 'participant',
        // Auth metadata survives email confirmation across tabs/origins. The
        // client syncs these tags into user_interests after a valid session.
        interests: normalizedInterests,
      },
    },
  });
  if (error) throw error;

  if (data.user && normalizedInterests.length) {
    rememberPendingInterests(window.localStorage, data.user.id, normalizedInterests);
    if (data.session) {
      try {
        await syncPendingInterests(window.localStorage, data.user.id, supabase);
      } catch {
        // Preserve the pending entry; login/dashboard will retry.
      }
    }
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
  let businessSetupPending = false;
  // Email-confirmation projects return no session. Login will finish this
  // second step after confirmation; when a session exists, try immediately.
  if (data.session && data.user) {
    try { await ensureBusinessCreated(supabase, data.user); }
    catch { businessSetupPending = true; }
  }
  return { ...data, needsEmailConfirmation: !data.session, businessSetupPending };
}

export async function getCurrentUserAndProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) {
    if (isMissingAuthSessionError(userError)) return { user: null, profile: null };
    throw userError;
  }
  if (!user) return { user: null, profile: null };
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return { user, profile };
}
