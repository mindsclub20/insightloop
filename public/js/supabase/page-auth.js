// public/js/supabase/page-auth.js
// WRITTEN, NOT EXECUTED. Supabase-track equivalent of public/js/api.js's
// requireRole()/logout() - used by business-page.js and admin-page.js so
// neither duplicates the session-check/redirect logic.

import { supabase } from './client.js';
import { getCurrentUserAndProfile } from './auth.js';

export async function requireRoleSupabase(role, loginPath = '/supabase-login.html') {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
    window.location.href = loginPath;
    return null;
  }
  if (profile.role !== role && !(role === 'ADMIN' && profile.role === 'SUPER_ADMIN')) {
    window.location.href = loginPath;
    return null;
  }
  if (profile.status === 'SUSPENDED') {
    window.location.href = loginPath;
    return null;
  }
  return { user, profile };
}

export async function logoutSupabase() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}
window.logoutSupabase = logoutSupabase; // so onclick="logoutSupabase()" in plain HTML can reach it
