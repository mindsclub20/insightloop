import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.INSIGHTLOOP_DB_PATH = ':memory:';

const { db, resetDatabaseForTests } = await import('../src/db.js');
const { newId } = await import('../src/lib/ids.js');
const { registerUser, hashPassword, verifyPassword } = await import('../src/lib/auth.js');
const { createPendingReward, confirmReward, forfeitReward, requestWithdrawal, markWithdrawalPaid, reconcileWallet, getWallet } = await import('../src/lib/ledger.js');
const { evaluateResponse } = await import('../src/lib/fraud.js');
const { isEligible, findEligibleStudies } = await import('../src/lib/matching.js');
const { requireRole, requireBusinessMembership, HttpError } = await import('../src/lib/authz.js');

beforeEach(() => {
  resetDatabaseForTests();
});

function makeUser(role = 'USER') {
  const id = registerUser({ email: `${newId()}@test.dev`, password: 'Password123!', role, full_name: 'Test User' });
  db.prepare('INSERT INTO wallets (id, user_id) VALUES (?, ?)').run(newId(), id);
  return id;
}

test('password hashing round-trips correctly and rejects wrong password', () => {
  const { hash, salt } = hashPassword('correct-horse-battery-staple');
  assert.equal(verifyPassword('correct-horse-battery-staple', hash, salt), true);
  assert.equal(verifyPassword('wrong-password', hash, salt), false);
});

test('AUTHZ: requireRole throws 403 for wrong role, passes for correct role', () => {
  const user = { id: 'x', role: 'USER' };
  assert.throws(() => requireRole(user, 'ADMIN'), (e) => e instanceof HttpError && e.status === 403);
  assert.doesNotThrow(() => requireRole(user, 'USER', 'BUSINESS'));
});

test('AUTHZ: requireRole throws 401 for unauthenticated', () => {
  assert.throws(() => requireRole(null, 'ADMIN'), (e) => e instanceof HttpError && e.status === 401);
});

test('AUTHZ: business membership check blocks non-members (IDOR protection)', () => {
  const ownerId = makeUser('BUSINESS');
  const strangerId = makeUser('BUSINESS');
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, ownerId);
  db.prepare(`INSERT INTO business_members (id, business_id, user_id, role) VALUES (?, ?, ?, 'OWNER')`).run(newId(), bizId, ownerId);

  assert.doesNotThrow(() => requireBusinessMembership({ id: ownerId, role: 'BUSINESS' }, bizId));
  assert.throws(() => requireBusinessMembership({ id: strangerId, role: 'BUSINESS' }, bizId), (e) => e instanceof HttpError && e.status === 403);
});

test('LEDGER: reward is PENDING then becomes spendable only after confirm', () => {
  const userId = makeUser('USER');
  const responseId = newId();
  createPendingReward({ userId, responseId, amountPaise: 500 });

  let wallet = getWallet(userId);
  assert.equal(wallet.balance_paise, 0);
  assert.equal(wallet.pending_paise, 500);

  confirmReward(responseId);
  wallet = getWallet(userId);
  assert.equal(wallet.balance_paise, 500);
  assert.equal(wallet.pending_paise, 0);
});

test('LEDGER: forfeited reward never reaches spendable balance', () => {
  const userId = makeUser('USER');
  const responseId = newId();
  createPendingReward({ userId, responseId, amountPaise: 500 });
  forfeitReward(responseId);

  const wallet = getWallet(userId);
  assert.equal(wallet.balance_paise, 0);
  assert.equal(wallet.pending_paise, 0);
});

test('LEDGER: createPendingReward is idempotent - calling twice never double-credits', () => {
  const userId = makeUser('USER');
  const responseId = newId();
  createPendingReward({ userId, responseId, amountPaise: 500 });
  createPendingReward({ userId, responseId, amountPaise: 500 }); // simulate a retried request

  const wallet = getWallet(userId);
  assert.equal(wallet.pending_paise, 500, 'pending should still be exactly one reward amount, not doubled');
});

test('LEDGER: confirmReward is idempotent', () => {
  const userId = makeUser('USER');
  const responseId = newId();
  createPendingReward({ userId, responseId, amountPaise: 500 });
  confirmReward(responseId);
  confirmReward(responseId); // idempotent retry

  const wallet = getWallet(userId);
  assert.equal(wallet.balance_paise, 500, 'balance should not double-increment on repeated confirm');
});

test('LEDGER: withdrawal reserves funds and rejects over-withdrawal', () => {
  const userId = makeUser('USER');
  const responseId = newId();
  createPendingReward({ userId, responseId, amountPaise: 1000 });
  confirmReward(responseId);

  assert.throws(() => requestWithdrawal({ userId, amountPaise: 5000, upiId: 'x@upi' }), /Insufficient balance/);

  const w = requestWithdrawal({ userId, amountPaise: 1000, upiId: 'x@upi' });
  const wallet = getWallet(userId);
  assert.equal(wallet.balance_paise, 0, 'funds should be reserved immediately on withdrawal request');

  const adminId = makeUser('ADMIN');
  markWithdrawalPaid(w.id, adminId);
  const paid = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(w.id);
  assert.equal(paid.status, 'PAID');
});

test('LEDGER: wallet always reconciles against the transaction ledger after mixed operations', () => {
  const userId = makeUser('USER');
  for (let i = 0; i < 5; i++) {
    const responseId = newId();
    createPendingReward({ userId, responseId, amountPaise: 500 });
    if (i % 2 === 0) confirmReward(responseId); else forfeitReward(responseId);
  }
  const result = reconcileWallet(userId);
  assert.equal(result.matches, true, 'wallet balance/pending must always match what the ledger implies');
});

test('FRAUD: flags a response completed far too fast', () => {
  const result = evaluateResponse({
    userId: 'u1', researchProjectId: 'p1', durationSeconds: 2, questionCount: 5,
    answers: [], deviceFingerprint: 'fp1',
  });
  assert.equal(result.status, 'FLAGGED');
  assert.ok(result.reasons.some(r => r.startsWith('too_fast')));
});

test('FRAUD: flags straight-lining on rating questions', () => {
  const result = evaluateResponse({
    userId: 'u1', researchProjectId: 'p1', durationSeconds: 60, questionCount: 5,
    answers: [{ rating_value: 3 }, { rating_value: 3 }, { rating_value: 3 }], deviceFingerprint: 'fp2',
  });
  assert.equal(result.status, 'FLAGGED');
  assert.ok(result.reasons.some(r => r.startsWith('straight_lining')));
});

test('FRAUD: does not flag a normal, well-paced, varied response', () => {
  const result = evaluateResponse({
    userId: 'u1', researchProjectId: 'p1', durationSeconds: 60, questionCount: 5,
    answers: [{ rating_value: 3 }, { rating_value: 5 }, { rating_value: 2 }], deviceFingerprint: 'fp3',
  });
  assert.equal(result.status, 'VALID');
  assert.equal(result.reasons.length, 0);
});

test('FRAUD: flags duplicate device fingerprint across different accounts on the same study', () => {
  const bizOwner = makeUser('BUSINESS');
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, bizOwner);
  const projectId = newId();
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'ACTIVE')
  `).run(projectId, bizId);
  const userA = makeUser('USER');
  db.prepare(`INSERT INTO survey_responses (id, research_project_id, user_id, device_fingerprint, status) VALUES (?, ?, ?, 'device-x', 'VALID')`)
    .run(newId(), projectId, userA);

  const result = evaluateResponse({
    userId: 'someone-else', researchProjectId: projectId, durationSeconds: 60, questionCount: 3,
    answers: [], deviceFingerprint: 'device-x',
  });
  assert.equal(result.status, 'FLAGGED');
  assert.ok(result.reasons.some(r => r.startsWith('duplicate_device')));
});

test('MATCHING: eligibility respects city, age range and required tags', () => {
  const project = { target_city: 'Visakhapatnam', target_min_age: 18, target_max_age: 30, target_gender: 'any', target_tags: JSON.stringify(['food']) };

  assert.equal(isEligible({ city: 'Visakhapatnam', age_range: '18-25' }, ['food'], project).eligible, true);
  assert.equal(isEligible({ city: 'Hyderabad', age_range: '18-25' }, ['food'], project).eligible, false, 'wrong city should be ineligible');
  assert.equal(isEligible({ city: 'Visakhapatnam', age_range: '46-60' }, ['food'], project).eligible, false, 'out of age range should be ineligible');
  assert.equal(isEligible({ city: 'Visakhapatnam', age_range: '18-25' }, ['gadgets'], project).eligible, false, 'missing required tag should be ineligible');
});

test('MATCHING: findEligibleStudies excludes studies the user already responded to', () => {
  const userId = makeUser('USER');
  db.prepare(`INSERT INTO profiles (user_id, age_range, city) VALUES (?, '18-25', 'Visakhapatnam')`).run(userId);

  const bizOwner = makeUser('BUSINESS');
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, bizOwner);

  const projectId = newId();
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'ACTIVE')
  `).run(projectId, bizId);

  let eligible = findEligibleStudies(userId);
  assert.equal(eligible.length, 1);

  db.prepare(`INSERT INTO survey_responses (id, research_project_id, user_id, status) VALUES (?, ?, ?, 'VALID')`).run(newId(), projectId, userId);
  eligible = findEligibleStudies(userId);
  assert.equal(eligible.length, 0, 'already-answered studies must not be shown again');
});

test('DB CONSTRAINT: unique(research_project_id, user_id) prevents a duplicate response row at the database level', () => {
  const userId = makeUser('USER');
  const projectId = newId();
  const bizOwner = makeUser('BUSINESS');
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, bizOwner);
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'ACTIVE')
  `).run(projectId, bizId);

  db.prepare(`INSERT INTO survey_responses (id, research_project_id, user_id, status) VALUES (?, ?, ?, 'VALID')`).run(newId(), projectId, userId);
  assert.throws(() => {
    db.prepare(`INSERT INTO survey_responses (id, research_project_id, user_id, status) VALUES (?, ?, ?, 'VALID')`).run(newId(), projectId, userId);
  }, /UNIQUE/);
});

test('DB CONSTRAINT: role column only accepts the four defined roles', () => {
  assert.throws(() => {
    db.prepare(`INSERT INTO users (id, email, password_hash, password_salt, role) VALUES (?, ?, 'h', 's', 'HACKER')`).run(newId(), `${newId()}@test.dev`);
  }, /CHECK/);
});
