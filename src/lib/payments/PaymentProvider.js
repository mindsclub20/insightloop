// src/lib/payments/PaymentProvider.js
//
// Abstract contract for a real payment gateway integration (Razorpay,
// Cashfree, Stripe, etc.). NOTHING in this codebase implements this against
// a real provider today - see ManualPaymentProvider.js for what actually
// runs in P0, and the class comment there for exactly what that means.
//
// The point of this abstraction: PaymentService and every route that needs
// to move money talks to THIS interface, never to a specific gateway's SDK
// or to raw business_payments rows directly. Swapping in a real provider
// later means writing one new class that implements these four methods and
// changing one line in PaymentService.js - not touching routes/business.js,
// routes/admin.js, or any RLS policy.

export class PaymentProvider {
  /**
   * Create a payment intent/order for a business study. Must return
   * { providerReference, status } without ever returning status 'SUCCESS'
   * synchronously - a real gateway confirms success asynchronously (redirect
   * callback + webhook), never at creation time.
   */
  async createPayment(/* { amountPaise, businessId, researchProjectId } */) {
    throw new Error('PaymentProvider.createPayment is abstract - implement it in a concrete provider subclass');
  }

  /**
   * Confirm a payment previously created. In a real integration this is
   * called from a webhook handler after verifying the gateway's signature,
   * NOT from an admin button click and NOT from unauthenticated client
   * input. Must return the provider's own confirmed status - the caller
   * must not assume success.
   */
  async confirmPayment(/* providerReference */) {
    throw new Error('PaymentProvider.confirmPayment is abstract - implement it in a concrete provider subclass');
  }

  async refundPayment(/* providerReference, amountPaise */) {
    throw new Error('PaymentProvider.refundPayment is abstract - implement it in a concrete provider subclass');
  }

  /**
   * Send money out to a participant's UPI ID for a withdrawal. A real
   * implementation calls the gateway's payout API. Must return a pending
   * state, never an immediate PAID - real payouts are asynchronous too.
   */
  async createPayout(/* { amountPaise, upiId, withdrawalId } */) {
    throw new Error('PaymentProvider.createPayout is abstract - implement it in a concrete provider subclass');
  }
}
