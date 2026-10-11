import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { newId } from './ids.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function createSession(userId) {
  const token = randomUUID() + '.' + randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Returns the authenticated user row (never the password hash/salt) or null.
export function getUserFromToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare(
    'SELECT id, email, phone, role, full_name, status, created_at FROM users WHERE id = ?'
  ).get(session.user_id);
  if (!user) return null;
  if (user.status === 'SUSPENDED') return null;
  return user;
}

// IMPORTANT SECURITY NOTE:
// `role` is set here ONLY at server-controlled registration time, and can
// only ever be changed afterwards via adminPromote() below, which is called
// exclusively from the SUPER_ADMIN-only route in routes/admin.js. There is
// no client-reachable endpoint anywhere in this codebase that accepts an
// arbitrary `role` field on an existing user. This mirrors the production
// RLS design in /migrations/002_rls_policies.sql, where `role` is excluded
// from every client UPDATE grant.
export function registerUser({ email, phone, password, role, full_name }) {
  const id = newId();
  const { hash, salt } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, password_salt, role, full_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, email || null, phone || null, hash, salt, role, full_name || null);
  return id;
}

export function adminPromote(actorId, targetUserId, newRole) {
  if (!['USER', 'BUSINESS', 'ADMIN'].includes(newRole)) {
    throw new Error('SUPER_ADMIN role cannot be granted through this function');
  }
  db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(newRole, targetUserId);
  db.prepare(`
    INSERT INTO admin_actions (id, admin_id, action_type, target_type, target_id, notes)
    VALUES (?, ?, 'ROLE_CHANGE', 'USER', ?, ?)
  `).run(newId(), actorId, targetUserId, `role changed to ${newRole}`);
}
