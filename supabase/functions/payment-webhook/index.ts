// supabase/functions/payment-webhook/index.ts
//
// WRITTEN, NOT EXECUTED, AND DELIBERATELY NON-FUNCTIONAL. There is no real
// payment gateway connected anywhere in this project (see
// src/lib/payments/ManualPaymentProvider.js and its Node-side comments).
// This file exists to show EXACTLY where a real integration plugs in and
// what it must do, per the brief's instruction: "When something cannot
// safely be implemented without an external provider or credential,
// implement the correct integration architecture and clearly tell me
// exactly what credential/configuration is required."
//
// This function currently does ONE thing: reject every request with a 501,
// so it is impossible to mistake it for a working webhook. Do not remove
// that guard as a shortcut to "make it work" - replace it only once real
// signature verification is in place.
//
// TO MAKE THIS REAL (e.g. with Razorpay):
//   1. Get PAYMENT_GATEWAY_WEBHOOK_SECRET from your gateway dashboard and
//      set it via `supabase secrets set PAYMENT_GATEWAY_WEBHOOK_SECRET=...`
//      (server-side only - this must never reach any client).
//   2. Verify the webhook signature from the raw request body using the
//      gateway's SDK/documented HMAC scheme BEFORE trusting any field in
//      the payload - webhooks are unauthenticated HTTP requests from the
//      internet until you do this.
//   3. Look up the business_payments row by gateway_reference (set when
//      submit-study-for-approval created it) and update its status based on
//      the VERIFIED event type - 'SUCCESS' only on a genuine success event,
//      never on receipt of the request itself.
//   4. Make the handler idempotent (gateways retry webhooks) - checking the
//      current status before applying a transition, exactly like every
//      other state change in this codebase, is sufficient.
//   5. Do the equivalent for a payout webhook if your gateway also handles
//      participant payouts, updating withdrawals.status via
//      admin_mark_withdrawal_paid-equivalent logic instead of requiring a
//      manual admin click.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleOptions, json } from '../_shared/cors.ts';

serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  return json({
    error: 'No payment gateway is connected to this deployment. This endpoint intentionally does nothing yet - see the header comment in payment-webhook/index.ts for exactly what real integration requires.',
  }, 501);
});
