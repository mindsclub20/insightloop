import { db } from '../db.js';
import { newId } from '../lib/ids.js';
import { registerUser, verifyPassword, createSession, destroySession } from '../lib/auth.js';
import { HttpError } from '../lib/authz.js';
import { setSessionCookie, clearSessionCookie, rateLimit } from '../lib/http.js';
import { timingSafeEqual } from 'node:crypto';

const MIN_AGE = 18;

function assertAdult(dateOfBirth) {
  if (!dateOfBirth) throw new HttpError(400, 'Date of birth is required (platform is 18+)');
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) throw new HttpError(400, 'Invalid date of birth');
  const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (age < MIN_AGE) {
    throw new HttpError(403, 'InsightLoop is currently restricted to participants aged 18 and over');
  }
}

export async function registerParticipant(req, res, ctx) {
  const { email, phone, password, full_name, date_of_birth, age_range, gender, city, area, occupation_category, interests } = ctx.body;
  if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!email && !phone) throw new HttpError(400, 'Email or phone is required');
  assertAdult(date_of_birth);

  const existing = email ? db.prepare('SELECT id FROM users WHERE email = ?').get(email) : null;
  if (existing) throw new HttpError(409, 'An account with this email already exists');

  const userId = registerUser({ email, phone, password, role: 'USER', full_name });
  db.prepare(`
    INSERT INTO profiles (user_id, age_range, gender, city, area, occupation_category)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, age_range || null, gender || null, city || null, area || null, occupation_category || null);

  for (const tag of (interests || [])) {
    db.prepare('INSERT INTO user_interests (id, user_id, tag) VALUES (?, ?, ?)').run(newId(), userId, tag);
  }
  db.prepare('INSERT INTO wallets (id, user_id) VALUES (?, ?)').run(newId(), userId);

  const { token, expiresAt } = createSession(userId);
  setSessionCookie(res, token, expiresAt);
  return { userId, role: 'USER' };
}

export async function registerBusiness(req, res, ctx) {
  const { email, password, full_name, legal_name, city, category, gstin } = ctx.body;
  if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!email) throw new HttpError(400, 'Email is required');
  if (!legal_name) throw new HttpError(400, 'Business legal name is required');

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw new HttpError(409, 'An account with this email already exists');

  const userId = registerUser({ email, password, role: 'BUSINESS', full_name });
  const businessId = newId();
  db.prepare(`
    INSERT INTO businesses (id, owner_user_id, legal_name, gstin, city, category, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(businessId, userId, legal_name, gstin || null, city || null, category || null);
  db.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES (?, ?, ?, 'OWNER')`)
    .run(newId(), businessId, userId);

  const { token, expiresAt } = createSession(userId);
  setSessionCookie(res, token, expiresAt);
  return { userId, businessId, role: 'BUSINESS', verificationStatus: 'PENDING' };
}

export async function login(req, res, ctx) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(`login:${ip}`, 20, 60_000)) {
    throw new HttpError(429, 'Too many login attempts, please wait a minute and try again');
  }
  const { email, password } = ctx.body;
  if (!email || !password) throw new HttpError(400, 'Email and password are required');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.status === 'SUSPENDED') throw new HttpError(403, 'This account has been suspended. Contact support.');

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  return { userId: user.id, role: user.role, full_name: user.full_name };
}

export async function logout(req, res, ctx) {
  const token = ctx.cookies.il_session;
  if (token) destroySession(token);
  clearSessionCookie(res);
  return { ok: true };
}

export async function me(req, res, ctx) {
  if (!ctx.user) throw new HttpError(401, 'Not authenticated');
  const extra = {};
  if (ctx.user.role === 'BUSINESS') {
    const biz = db.prepare(`
      SELECT b.* FROM businesses b
      JOIN business_members bm ON bm.business_id = b.id
      WHERE bm.user_id = ? LIMIT 1
    `).get(ctx.user.id);
    extra.business = biz || null;
  }
  return { user: ctx.user, ...extra };
}


// Password-only admin entry. The shared secret lives only in server environment settings.
export async function adminLogin(req, res, ctx) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(`admin-login:${ip}`, 8, 60_000)) throw new HttpError(429, 'Too many admin attempts. Wait a minute and try again.');
  const configured = process.env.INSIGHTLOOP_ADMIN_PASSWORD;
  const supplied = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!configured || configured.length < 16) throw new HttpError(503, 'Admin access is not configured. Set a strong INSIGHTLOOP_ADMIN_PASSWORD on the server.');
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Incorrect admin password.');
  const admin = db.prepare("SELECT id, role, full_name FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') AND status = 'ACTIVE' ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END LIMIT 1").get();
  if (!admin) throw new HttpError(503, 'No active admin account exists in the database yet.');
  const { token, expiresAt } = createSession(admin.id);
  setSessionCookie(res, token, expiresAt);
  return { userId: admin.id, role: admin.role, full_name: admin.full_name };
}
