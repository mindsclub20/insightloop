import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Isolated instance: its own port, its own in-memory database. Does not
// touch the persistent data/insightloop.db file or conflict with any
// already-running demo server on the default port.
const TEST_PORT = 3999;
process.env.PORT = String(TEST_PORT);
process.env.INSIGHTLOOP_DB_PATH = ':memory:';

const BASE = `http://localhost:${TEST_PORT}`;

// server.js calls server.listen() as a side effect of being imported - this
// is the actual production entry point, not a mock of it.
const { server } = await import('../src/server.js');
const { db } = await import('../src/db.js');
const { registerUser } = await import('../src/lib/auth.js');
const { newId } = await import('../src/lib/ids.js');

after(() => { server.close(); });

// --- tiny cookie-jar helper: fetch() doesn't persist cookies across calls
// the way a browser does, so each simulated "actor" (admin/business/
// participant) needs its own cookie captured from login and replayed. ---
function makeActor() {
  let cookie = null;
  return {
    async request(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      const sessionCookie = setCookie.find((c) => c.startsWith('il_session='));
      if (sessionCookie) cookie = sessionCookie.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
  };
}

// Admins aren't created through any public route (by design - see
// migrations/008's handle_new_user, which never produces role=ADMIN).
// Bootstrapped directly here exactly like seed.js does for local dev.
function bootstrapAdmin() {
  const id = registerUser({ email: `admin-${newId()}@test.dev`, password: 'AdminPass123!', role: 'ADMIN', full_name: 'Test Admin' });
  return { id, email: db.prepare('SELECT email FROM users WHERE id = ?').get(id).email };
}

let admin, adminEmail, business, participant;
let businessId, studyId, q1Id, q1OptYesId;

before(async () => {
  await new Promise((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve); });
});

test('FULL LOOP: bootstrap admin + register business', async () => {
  const bootstrapped = bootstrapAdmin();
  adminEmail = bootstrapped.email;
  admin = makeActor();
  const login = await admin.request('POST', '/api/auth/login', { email: adminEmail, password: 'AdminPass123!' });
  assert.equal(login.status, 200);

  business = makeActor();
  const reg = await business.request('POST', '/api/auth/register/business', {
    email: `biz-${newId()}@test.dev`, password: 'Password123!', full_name: 'Biz Owner',
    legal_name: 'Test Cafe', city: 'Visakhapatnam', category: 'food_beverage',
  });
  assert.equal(reg.status, 200);
  businessId = reg.data.businessId;
  assert.equal(reg.data.verificationStatus, 'PENDING');
});

test('FULL LOOP: business cannot create a study before verification', async () => {
  const res = await business.request('POST', '/api/business/studies', {
    title: 'Too early', template_type: 'custom', target_city: 'Visakhapatnam', sample_size: 10, reward_per_response_paise: 500,
  });
  assert.equal(res.status, 403);
});

test('FULL LOOP: admin verifies the business', async () => {
  const res = await admin.request('POST', `/api/admin/businesses/${businessId}/verify`);
  assert.equal(res.status, 200);
  const check = await admin.request('GET', '/api/admin/businesses');
  const biz = check.data.find((b) => b.id === businessId);
  assert.equal(biz.verification_status, 'VERIFIED');
});

test('FULL LOOP: business creates a study, adds a question, submits for approval', async () => {
  const create = await business.request('POST', '/api/business/studies', {
    title: 'Lunch combo test', template_type: 'pricing_test', target_city: 'Visakhapatnam',
    target_min_age: 18, target_max_age: 30, sample_size: 50, reward_per_response_paise: 15000,
  });
  assert.equal(create.status, 200);
  studyId = create.data.id;
  assert.equal(create.data.status, 'DRAFT');

  const q = await business.request('POST', `/api/business/studies/${studyId}/questions`, {
    question_text: 'Would you buy this?', question_type: 'yes_no',
  });
  assert.equal(q.status, 200);
  q1Id = q.data.id;

  const submit = await business.request('POST', `/api/business/studies/${studyId}/submit`);
  assert.equal(submit.status, 200);
  assert.equal(submit.data.status, 'SUBMITTED');
  assert.equal(submit.data.paymentStatus, 'MANUAL_PENDING');
});

test('FULL LOOP: admin approves the study (SUBMITTED -> APPROVED -> ACTIVE)', async () => {
  const res = await admin.request('POST', `/api/admin/studies/${studyId}/approve`);
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'ACTIVE');
});

test('FULL LOOP: an eligible participant registers and sees the study', async () => {
  participant = makeActor();
  const reg = await participant.request('POST', '/api/auth/register/participant', {
    email: `p-${newId()}@test.dev`, password: 'Password123!', full_name: 'Test Participant',
    date_of_birth: '2000-01-01', age_range: '18-25', city: 'Visakhapatnam',
  });
  assert.equal(reg.status, 200);

  const list = await participant.request('GET', '/api/participant/studies');
  assert.equal(list.status, 200);
  assert.ok(list.data.some((s) => s.id === studyId), 'eligible participant should see the active study');
});

test('FULL LOOP: an ineligible participant (wrong city) does NOT see the study', async () => {
  const other = makeActor();
  await other.request('POST', '/api/auth/register/participant', {
    email: `p-${newId()}@test.dev`, password: 'Password123!', full_name: 'Elsewhere Participant',
    date_of_birth: '2000-01-01', age_range: '18-25', city: 'Hyderabad',
  });
  const list = await other.request('GET', '/api/participant/studies');
  assert.equal(list.data.some((s) => s.id === studyId), false);
});

test('FULL LOOP: participant fetches study details and gets the question/options', async () => {
  const detail = await participant.request('GET', `/api/participant/studies/${studyId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.eligibility.eligible, true);
  const q = detail.data.questions.find((q) => q.id === q1Id);
  q1OptYesId = q.options.find((o) => o.option_text === 'Yes').id;
});

test('FULL LOOP: participant submits a clean response - auto-confirmed reward', async () => {
  const res = await participant.request('POST', `/api/participant/studies/${studyId}/submit`, {
    answers: [{ question_id: q1Id, selected_option_ids: [q1OptYesId] }],
    duration_seconds: 30,
    device_fingerprint: 'integration-test-device',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'VALID');

  const wallet = await participant.request('GET', '/api/participant/wallet');
  assert.equal(wallet.data.balance_paise, 15000);
  assert.equal(wallet.data.pending_paise, 0);
});

test('FULL LOOP: duplicate submission to the same study is rejected with 409', async () => {
  const res = await participant.request('POST', `/api/participant/studies/${studyId}/submit`, {
    answers: [{ question_id: q1Id, selected_option_ids: [q1OptYesId] }],
    duration_seconds: 30,
    device_fingerprint: 'integration-test-device',
  });
  assert.equal(res.status, 409);
});

test('FULL LOOP: withdrawal below the ₹100 minimum is rejected', async () => {
  const res = await participant.request('POST', '/api/participant/withdrawals', { amount_paise: 500, upi_id: 'test@upi' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /Minimum withdrawal/);
});

test('FULL LOOP: withdrawal request, admin marks paid, ledger reconciles', async () => {
  const withdraw = await participant.request('POST', '/api/participant/withdrawals', { amount_paise: 15000, upi_id: 'test@upi' });
  assert.equal(withdraw.status, 200);
  const withdrawalId = withdraw.data.id;

  const afterRequest = await participant.request('GET', '/api/participant/wallet');
  assert.equal(afterRequest.data.balance_paise, 0, 'funds should be reserved immediately on withdrawal request');

  const markPaid = await admin.request('POST', `/api/admin/withdrawals/${withdrawalId}/mark-paid`);
  assert.equal(markPaid.status, 200);
  assert.equal(markPaid.data.status, 'PAID');

  const ledger = await admin.request('GET', '/api/admin/ledger');
  assert.equal(ledger.data.reconciliationIssues.length, 0);
});

test('FULL LOOP: study lifecycle - pause rejects an illegal transition, resume, complete, report auto-flips to REPORT_READY', async () => {
  const pause = await admin.request('POST', `/api/admin/studies/${studyId}/pause`);
  assert.equal(pause.status, 200);
  assert.equal(pause.data.status, 'PAUSED');

  const illegalApprove = await admin.request('POST', `/api/admin/studies/${studyId}/approve`);
  assert.equal(illegalApprove.status, 400);

  const resume = await admin.request('POST', `/api/admin/studies/${studyId}/resume`);
  assert.equal(resume.data.status, 'ACTIVE');

  const complete = await admin.request('POST', `/api/admin/studies/${studyId}/complete`);
  assert.equal(complete.data.status, 'COMPLETED');

  const report = await business.request('GET', `/api/business/studies/${studyId}/report`);
  assert.equal(report.status, 200);
  assert.equal(report.data.observedResults.totalResponses, 1);

  const afterReport = await business.request('GET', `/api/business/studies/${studyId}`);
  assert.equal(afterReport.data.study.status, 'REPORT_READY', 'viewing the report should auto-advance a COMPLETED study');
});

test('SECURITY: participant hitting an admin-only endpoint gets 403', async () => {
  const res = await participant.request('GET', '/api/admin/stats');
  assert.equal(res.status, 403);
});

test('SECURITY: unauthenticated request to a wallet endpoint gets 401', async () => {
  const res = await fetch(`${BASE}/api/participant/wallet`);
  assert.equal(res.status, 401);
});

test('SECURITY: business cannot read another business\'s study by ID', async () => {
  const otherBusiness = makeActor();
  await otherBusiness.request('POST', '/api/auth/register/business', {
    email: `biz2-${newId()}@test.dev`, password: 'Password123!', full_name: 'Other Owner',
    legal_name: 'Other Biz', city: 'Visakhapatnam', category: 'retail',
  });
  const res = await otherBusiness.request('GET', `/api/business/studies/${studyId}`);
  assert.equal(res.status, 403);
});

test('SECURITY: client-supplied role during registration is ignored, not honored', async () => {
  const attacker = makeActor();
  const res = await attacker.request('POST', '/api/auth/register/participant', {
    email: `hacker-${newId()}@test.dev`, password: 'Password123!', full_name: 'Hacker',
    date_of_birth: '2000-01-01', role: 'ADMIN',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.role, 'USER');
});
