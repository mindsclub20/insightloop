import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonBody, sendJson, parseCookies } from './lib/http.js';
import { getUserFromToken } from './lib/auth.js';
import { HttpError } from './lib/authz.js';
import { setCurrentActor } from './db.js';

import * as authRoutes from './routes/auth.js';
import * as participantRoutes from './routes/participant.js';
import * as businessRoutes from './routes/business.js';
import * as adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Route table: [method, pathPattern, handler]. Patterns use :param segments.
const ROUTES = [
  ['POST', '/api/auth/register/participant', authRoutes.registerParticipant],
  ['POST', '/api/auth/register/business', authRoutes.registerBusiness],
  ['POST', '/api/auth/login', authRoutes.login],
  ['POST', '/api/auth/logout', authRoutes.logout],
  ['GET', '/api/auth/me', authRoutes.me],

  ['GET', '/api/participant/profile', participantRoutes.getProfile],
  ['PATCH', '/api/participant/profile', participantRoutes.updateProfile],
  ['GET', '/api/participant/studies', participantRoutes.listEligibleStudies],
  ['GET', '/api/participant/studies/:id', participantRoutes.getStudyDetails],
  ['POST', '/api/participant/studies/:id/submit', participantRoutes.submitStudy],
  ['GET', '/api/participant/wallet', participantRoutes.getWalletHandler],
  ['GET', '/api/participant/transactions', participantRoutes.getTransactionsHandler],
  ['POST', '/api/participant/withdrawals', participantRoutes.createWithdrawal],
  ['GET', '/api/participant/withdrawals', participantRoutes.listWithdrawals],

  ['GET', '/api/business/mine', businessRoutes.getMyBusiness],
  ['POST', '/api/business/studies', businessRoutes.createStudy],
  ['GET', '/api/business/studies', businessRoutes.listMyStudies],
  ['GET', '/api/business/studies/:id', businessRoutes.getMyStudy],
  ['PATCH', '/api/business/studies/:id', businessRoutes.updateStudy],
  ['POST', '/api/business/studies/:id/questions', businessRoutes.addQuestion],
  ['POST', '/api/business/studies/:id/submit', businessRoutes.submitStudyForApproval],
  ['POST', '/api/business/studies/:id/cancel', businessRoutes.cancelStudy],
  ['GET', '/api/business/studies/:id/report', businessRoutes.getStudyReport],

  ['GET', '/api/admin/users', adminRoutes.listUsers],
  ['POST', '/api/admin/users/:id/suspend', adminRoutes.suspendUser],
  ['POST', '/api/admin/users/:id/reactivate', adminRoutes.reactivateUser],
  ['GET', '/api/admin/businesses', adminRoutes.listBusinesses],
  ['POST', '/api/admin/businesses/:id/verify', adminRoutes.verifyBusiness],
  ['POST', '/api/admin/businesses/:id/reject', adminRoutes.rejectBusiness],
  ['GET', '/api/admin/studies', adminRoutes.listStudiesForReview],
  ['POST', '/api/admin/studies/:id/approve', adminRoutes.approveStudy],
  ['POST', '/api/admin/studies/:id/reject', adminRoutes.rejectStudy],
  ['POST', '/api/admin/studies/:id/pause', adminRoutes.pauseStudy],
  ['POST', '/api/admin/studies/:id/resume', adminRoutes.resumeStudy],
  ['POST', '/api/admin/studies/:id/cancel', adminRoutes.cancelStudy],
  ['POST', '/api/admin/studies/:id/complete', adminRoutes.completeStudy],
  ['GET', '/api/admin/responses/flagged', adminRoutes.listFlaggedResponses],
  ['POST', '/api/admin/responses/:id/review', adminRoutes.reviewResponse],
  ['GET', '/api/admin/withdrawals', adminRoutes.listWithdrawals],
  ['POST', '/api/admin/withdrawals/:id/mark-paid', adminRoutes.markWithdrawalPaidHandler],
  ['POST', '/api/admin/withdrawals/:id/reject', adminRoutes.rejectWithdrawalHandler],
  ['GET', '/api/admin/ledger', adminRoutes.ledgerAudit],
  ['GET', '/api/admin/stats', adminRoutes.platformStats],
];

function compilePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map(seg => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

const COMPILED_ROUTES = ROUTES.map(([method, pattern, handler]) => ({
  method, handler, ...compilePattern(pattern),
}));

function matchRoute(method, pathname) {
  for (const route of COMPILED_ROUTES) {
    if (route.method !== method) continue;
    const m = route.regex.exec(pathname);
    if (m) {
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
  // Basic path-traversal guard.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    // SPA-ish fallback for role portals so /participant/dashboard etc. work.
    const fallback = path.join(PUBLIC_DIR, '404.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      fs.createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Minimal security headers appropriate for a local/dev MVP.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
  }

  const match = matchRoute(req.method, pathname);
  if (!match) return sendJson(res, 404, { error: 'Not found' });

  try {
    const cookies = parseCookies(req);
    const user = getUserFromToken(cookies.il_session);
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};
    const query = Object.fromEntries(url.searchParams);

    // Sets the actor the audit-log triggers in src/db.js will attribute any
    // resulting row to (see setCurrentActor's concurrency caveat in db.js).
    // Set AFTER body parsing (an await point) and immediately before the
    // synchronous chain of DB calls in the handler, to keep the window
    // between "set actor" and "use actor" as short as possible.
    setCurrentActor(user ? user.id : null);

    const result = await match.handler(req, res, { user, params: match.params, query, body, cookies });
    if (!res.writableEnded) sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError || err.status) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('Unhandled error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }
});

// Vercel invokes the exported server for each request. Local development
// still listens on PORT; don't bind a port while running as a serverless function.
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`InsightLoop MVP server running at http://localhost:${PORT}`);
  });
}

export { server };
export default server;
