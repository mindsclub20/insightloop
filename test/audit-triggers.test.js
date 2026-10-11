import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.INSIGHTLOOP_DB_PATH = ':memory:';

const { db, resetDatabaseForTests, setCurrentActor } = await import('../src/db.js');
const { newId } = await import('../src/lib/ids.js');
const { registerUser } = await import('../src/lib/auth.js');

beforeEach(() => resetDatabaseForTests());

function auditRowsFor(tableName, recordId) {
  return db.prepare('SELECT * FROM audit_logs WHERE table_name = ? AND record_id = ? ORDER BY created_at').all(tableName, recordId);
}

test('AUDIT TRIGGER: role change on users is captured WITHOUT any application code calling a logging function', () => {
  const adminId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'ADMIN', full_name: 'A' });
  const targetId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'USER', full_name: 'B' });

  setCurrentActor(adminId);
  // Deliberately a raw UPDATE, not a call through src/lib/auth.js's
  // adminPromote() - the whole point is that the trigger fires regardless
  // of which code path made the change.
  db.prepare(`UPDATE users SET role = 'BUSINESS' WHERE id = ?`).run(targetId);

  const rows = auditRowsFor('users', targetId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'role_CHANGED');
  assert.equal(rows[0].actor_id, adminId);
  assert.deepEqual(JSON.parse(rows[0].old_values), { role: 'USER' });
  assert.deepEqual(JSON.parse(rows[0].new_values), { role: 'BUSINESS' });
});

test('AUDIT TRIGGER: does not fire when an unrelated column changes', () => {
  const userId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'USER', full_name: 'B' });
  db.prepare(`UPDATE users SET full_name = 'New Name' WHERE id = ?`).run(userId);
  assert.equal(auditRowsFor('users', userId).length, 0);
});

test('AUDIT TRIGGER: business verification_status change is captured', () => {
  const ownerId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'BUSINESS', full_name: 'Owner' });
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'PENDING')`).run(bizId, ownerId);

  const adminId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'ADMIN', full_name: 'A' });
  setCurrentActor(adminId);
  db.prepare(`UPDATE businesses SET verification_status = 'VERIFIED' WHERE id = ?`).run(bizId);

  const rows = auditRowsFor('businesses', bizId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'verification_status_CHANGED');
  assert.equal(rows[0].actor_id, adminId);
});

test('AUDIT TRIGGER: research_projects.status change is captured for every transition, not just the first', () => {
  const ownerId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'BUSINESS', full_name: 'Owner' });
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, ownerId);
  const projectId = newId();
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'DRAFT')
  `).run(projectId, bizId);

  db.prepare(`UPDATE research_projects SET status = 'SUBMITTED' WHERE id = ?`).run(projectId);
  db.prepare(`UPDATE research_projects SET status = 'APPROVED' WHERE id = ?`).run(projectId);
  db.prepare(`UPDATE research_projects SET status = 'ACTIVE' WHERE id = ?`).run(projectId);

  const rows = auditRowsFor('research_projects', projectId);
  assert.equal(rows.length, 3, 'one audit row per transition');
  assert.deepEqual(rows.map(r => JSON.parse(r.new_values).status), ['SUBMITTED', 'APPROVED', 'ACTIVE']);
});

test('AUDIT TRIGGER: audit_logs itself rejects UPDATE and DELETE (append-only)', () => {
  const userId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'USER', full_name: 'B' });
  db.prepare(`UPDATE users SET role = 'BUSINESS' WHERE id = ?`).run(userId);
  const row = auditRowsFor('users', userId)[0];

  assert.throws(() => {
    db.prepare(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ?`).run(row.id);
  }, /append-only/);

  assert.throws(() => {
    db.prepare(`DELETE FROM audit_logs WHERE id = ?`).run(row.id);
  }, /append-only/);

  // Confirm the row is actually untouched after the rejected UPDATE attempt.
  const stillThere = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(row.id);
  assert.equal(stillThere.action, 'role_CHANGED');
});

test('AUDIT TRIGGER: withdrawal status changes are captured', async () => {
  const userId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'USER', full_name: 'P' });
  db.prepare('INSERT INTO wallets (id, user_id, balance_paise) VALUES (?, ?, 100000)').run(newId(), userId);
  const { requestWithdrawal } = await import('../src/lib/ledger.js');
  const w = requestWithdrawal({ userId, amountPaise: 10000, upiId: 'x@upi' });

  const adminId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'ADMIN', full_name: 'A' });
  setCurrentActor(adminId);
  const { markWithdrawalPaid } = await import('../src/lib/ledger.js');
  markWithdrawalPaid(w.id, adminId);

  const rows = auditRowsFor('withdrawals', w.id);
  assert.ok(rows.some(r => JSON.parse(r.new_values).status === 'PAID'));
  assert.equal(rows[rows.length - 1].actor_id, adminId);
});
