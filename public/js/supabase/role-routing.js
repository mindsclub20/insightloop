// Keep role-to-dashboard navigation and the shared login route in one place.
export const SHARED_LOGIN_PATH = '/supabase-login.html';

export function getDashboardPath(role) {
  if (role === 'USER') return '/supabase-participant/dashboard.html';
  if (role === 'BUSINESS') return '/supabase-business/dashboard.html';
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return '/supabase-admin/dashboard.html';
  return null;
}
