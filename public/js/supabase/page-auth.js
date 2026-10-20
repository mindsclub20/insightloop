// Supabase-track equivalent of public/js/api.js's requireRole()/logout().
// Used by business-page.js and admin-page.js so both share one session guard.
import { supabase } from './client.js';
import { getCurrentUserAndProfile } from './auth.js';
import { isMissingAuthSessionError } from './password-recovery.js';

export async function requireRoleSupabase(role, loginPath = '/supabase-login.html') {
  let identity;
  try {
    identity = await getCurrentUserAndProfile();
  } catch (error) {
    // A protected dashboard opened in a fresh browser has no session. Treat
    // that as logged out instead of leaving a broken dashboard shell visible.
    if (isMissingAuthSessionError(error)) {
      window.location.replace(loginPath);
      return null;
    }
    throw error;
  }

  const { user, profile } = identity;
  if (!user || !profile) {
    window.location.replace(loginPath);
    return null;
  }
  if (profile.role !== role && !(role === 'ADMIN' && profile.role === 'SUPER_ADMIN')) {
    window.location.replace(loginPath);
    return null;
  }
  if (profile.status === 'SUSPENDED') {
    window.location.replace(loginPath);
    return null;
  }
  return { user, profile };
}

export async function logoutSupabase() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}
window.logoutSupabase = logoutSupabase;
