// src/lib/payments/ManualPaymentProvider.js
//
// This is the ONLY PaymentProvider wired up in this codebase right now. It
// does not call any external gateway - there is no network integration
// here at all. Its entire purpose is to make the "no real payment
// provider is connected" boundary a single, explicit, impossible-to-miss
// class, instead of a scattered assumption across multiple routes.
//
// CRITICAL BEHAVIOR: confirmPayment() and createPayout() both THROW. They
// do not simulate success, they do not return a fake "SUCCESS" status, and
// nothing in this codebase calls them expecting a result - that's
// deliberate. Per the brief: "Do not mark a business payment as successful
// simply because an admin clicked a button" and "Never claim money was
// transferred unless the payment system confirms it." There is currently no
// system that can confirm it, so nothing in this codebase claims it.
//
// business_payments therefore sits at MANUAL_PENDING forever under this
// provider. Admin approval (routes/admin.js approveStudy) only checks that
// a payment RECORD exists, not that it succeeded - this was already true
// before this refactor and is unchanged; it is called out explicitly in
// README.md "What is still mocked/manual".

import { PaymentProvider } from './PaymentProvider.js';
import { newId } from '../ids.js';

export class ManualPaymentProvider extends PaymentProvider {
  async createPayment({ amountPaise, businessId, researchProjectId }) {
    // "Creating" a manual payment just means recording that a business owes
    // this amount for this study - it is a bookkeeping record, not a
    // transaction. providerReference is a local id, not a real gateway
    // order id, because there is no real gateway.
    return {
      providerReference: `manual-${newId()}`,
      status: 'MANUAL_PENDING',
    };
  }

  async confirmPayment() {
    throw new Error(
      'ManualPaymentProvider cannot confirm a real payment - no payment gateway is connected in this deployment. ' +
      'Wire up a real PaymentProvider (e.g. Razorpay/Cashfree) and its webhook handler before this can return SUCCESS.'
    );
  }

  async refundPayment() {
    throw new Error('ManualPaymentProvider cannot process a real refund - no payment gateway is connected in this deployment.');
  }

  async createPayout() {
    throw new Error(
      'ManualPaymentProvider cannot send a real payout - no UPI payout provider is connected in this deployment. ' +
      'Withdrawals in this build are paid by an admin manually sending money outside this system and then clicking ' +
      '"Mark paid" to record that fact - see PaymentService.recordManualPayout and README "What is still mocked/manual".'
    );
  }
}
