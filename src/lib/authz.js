import { db } from '../db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireAuth(user) {
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

export function requireRole(user, ...roles) {
  requireAuth(user);
  if (!roles.includes(user.role)) {
    throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
  }
  return user;
}

// A business user may only act on a business they are a member of.
// This is the app-layer equivalent of the RLS policy on research_projects
// / business_payments in migrations/002_rls_policies.sql.
export function requireBusinessMembership(user, businessId) {
  requireAuth(user);
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true;
  const row = db.prepare(
    'SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?'
  ).get(businessId, user.id);
  if (!row) throw new HttpError(403, 'Not a member of this business');
  return true;
}

export function businessIdForUser(userId) {
  const row = db.prepare(
    'SELECT business_id FROM business_members WHERE user_id = ? LIMIT 1'
  ).get(userId);
  return row ? row.business_id : null;
}
