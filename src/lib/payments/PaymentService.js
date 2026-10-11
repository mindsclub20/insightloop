// src/lib/payments/PaymentService.js
//
// The only module that writes to business_payments. routes/business.js
// calls PaymentService instead of doing a raw INSERT, so "which provider is
// active" and "what a payment record is allowed to claim" both live in one
// place. Swapping ManualPaymentProvider for a real gateway later means
// changing the `provider` line below (and adding a webhook route that calls
// PaymentService.confirmPayment from verified gateway events) - nothing
// else in the codebase needs to change.

import { db } from '../../db.js';
import { newId } from '../ids.js';
import { ManualPaymentProvider } from './ManualPaymentProvider.js';

// Single active provider for this deployment. In a production build this
// would be selected by an environment variable (e.g. PAYMENT_PROVIDER=razorpay)
// once a real provider class exists - there is only one option today.
const provider = new ManualPaymentProvider();

export const PaymentService = {
  // Synchronous: ManualPaymentProvider.createPayment never actually awaits
  // anything (no real network call exists behind it), so routes that are
  // not async-aware can call this directly today. A future real provider
  // WILL need to await a real HTTP call, at which point this becomes async
  // and every call site must be updated - that forced change is intentional,
  // not an oversight, so nobody can add a real gateway without touching
  // every place money gets created.
  createPaymentForStudy({ businessId, researchProjectId, amountPaise }) {
    const id = newId();
    const providerReference = `manual-${newId()}`;
    db.prepare(`
      INSERT INTO business_payments (id, business_id, research_project_id, amount_paise, gateway_reference, status)
      VALUES (?, ?, ?, ?, ?, 'MANUAL_PENDING')
    `).run(id, businessId, researchProjectId, amountPaise, providerReference);
    return db.prepare('SELECT * FROM business_payments WHERE id = ?').get(id);
  },

  // Deliberately throws - see ManualPaymentProvider.confirmPayment. Exists
  // so "confirm a payment" has one clearly-labeled call site to wire a real
  // webhook handler to later, instead of that decision being made ad hoc
  // wherever someone next needs it.
  async confirmPayment(paymentId) {
    const payment = db.prepare('SELECT * FROM business_payments WHERE id = ?').get(paymentId);
    if (!payment) throw new Error('Payment not found');
    await provider.confirmPayment(payment.gateway_reference); // always throws under ManualPaymentProvider
  },
};
