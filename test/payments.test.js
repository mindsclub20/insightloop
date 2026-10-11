import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.INSIGHTLOOP_DB_PATH = ':memory:';

const { db, resetDatabaseForTests } = await import('../src/db.js');
const { newId } = await import('../src/lib/ids.js');
const { registerUser } = await import('../src/lib/auth.js');
const { PaymentService } = await import('../src/lib/payments/PaymentService.js');
const { ManualPaymentProvider } = await import('../src/lib/payments/ManualPaymentProvider.js');
const { PaymentProvider } = await import('../src/lib/payments/PaymentProvider.js');

beforeEach(() => resetDatabaseForTests());

function makeBusiness() {
  const ownerId = registerUser({ email: `${newId()}@test.dev`, password: 'x', role: 'BUSINESS', full_name: 'Owner' });
  const bizId = newId();
  db.prepare(`INSERT INTO businesses (id, owner_user_id, legal_name, verification_status) VALUES (?, ?, 'Acme', 'VERIFIED')`).run(bizId, ownerId);
  return bizId;
}

test('PAYMENTS: base PaymentProvider is abstract - every method throws if not overridden', async () => {
  const base = new PaymentProvider();
  await assert.rejects(() => base.createPayment({}), /abstract/);
  await assert.rejects(() => base.confirmPayment('x'), /abstract/);
  await assert.rejects(() => base.refundPayment('x'), /abstract/);
  await assert.rejects(() => base.createPayout({}), /abstract/);
});

test('PAYMENTS: ManualPaymentProvider.createPayment never returns SUCCESS', async () => {
  const provider = new ManualPaymentProvider();
  const result = await provider.createPayment({ amountPaise: 5000 });
  assert.equal(result.status, 'MANUAL_PENDING');
  assert.notEqual(result.status, 'SUCCESS');
});

test('PAYMENTS: ManualPaymentProvider.confirmPayment always throws - it must never fake a real confirmation', async () => {
  const provider = new ManualPaymentProvider();
  await assert.rejects(() => provider.confirmPayment('anything'), /no payment gateway is connected/);
});

test('PAYMENTS: ManualPaymentProvider.createPayout always throws - no real payout rail exists', async () => {
  const provider = new ManualPaymentProvider();
  await assert.rejects(() => provider.createPayout({ amountPaise: 100, upiId: 'x@upi' }), /no UPI payout provider is connected/);
});

test('PAYMENTS: PaymentService.createPaymentForStudy writes a MANUAL_PENDING business_payments row, never SUCCESS', () => {
  const bizId = makeBusiness();
  const projectId = newId();
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'DRAFT')
  `).run(projectId, bizId);

  const payment = PaymentService.createPaymentForStudy({ businessId: bizId, researchProjectId: projectId, amountPaise: 5000 });
  assert.equal(payment.status, 'MANUAL_PENDING');
  assert.equal(payment.amount_paise, 5000);
  assert.ok(payment.gateway_reference.startsWith('manual-'), 'reference must be clearly marked as non-real');

  const stored = db.prepare('SELECT * FROM business_payments WHERE id = ?').get(payment.id);
  assert.equal(stored.status, 'MANUAL_PENDING');
});

test('PAYMENTS: PaymentService.confirmPayment rejects because the underlying provider cannot confirm anything real', async () => {
  const bizId = makeBusiness();
  const projectId = newId();
  db.prepare(`
    INSERT INTO research_projects (id, business_id, title, template_type, target_city, sample_size, budget_paise, reward_per_response_paise, status)
    VALUES (?, ?, 'Test', 'custom', 'Visakhapatnam', 10, 5000, 500, 'DRAFT')
  `).run(projectId, bizId);
  const payment = PaymentService.createPaymentForStudy({ businessId: bizId, researchProjectId: projectId, amountPaise: 5000 });

  await assert.rejects(() => PaymentService.confirmPayment(payment.id), /no payment gateway is connected/);

  // and critically: the row in the database must still say MANUAL_PENDING,
  // not SUCCESS, after the rejected confirm attempt.
  const stored = db.prepare('SELECT * FROM business_payments WHERE id = ?').get(payment.id);
  assert.equal(stored.status, 'MANUAL_PENDING');
});
