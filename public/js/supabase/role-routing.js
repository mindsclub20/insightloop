// Keep role-to-dashboard navigation in one small, testable mapping.
export function getDashboardPath(role) {
  if (role === 'USER') return '/supabase-participant/dashboard.html';
  if (role === 'BUSINESS') return '/supabase-business/dashboard.html';
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return '/supabase-admin/dashboard.html';
  return null;
}
