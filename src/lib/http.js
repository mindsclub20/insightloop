export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const MAX = 1_000_000; // 1MB cap - basic abuse prevention
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

export function setSessionCookie(res, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  res.setHeader('Set-Cookie', `il_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'il_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// Very simple per-IP+route rate limiter (in-memory, resets on process restart).
// P0-appropriate abuse prevention; a production deployment behind Cloudflare
// would layer real rate limiting / bot mitigation on top of this, not instead of it.
const buckets = new Map();
export function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  buckets.set(key, entry);
  return entry.count <= maxRequests;
}
