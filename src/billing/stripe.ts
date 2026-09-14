import 'server-only';
import Stripe from 'stripe';
import { BillingSignatureError, type BillingProvider } from './provider';

/**
 * Stripe adapter. Checkout carries the user id twice (`client_reference_id` and the
 * subscription's metadata) so every later event can be attributed without a lookup; the
 * webhook secret verifies signatures with the SDK's constant-time check and a 5-minute
 * tolerance (replays of an old signed body are refused). Cancellation goes through the
 * customer portal — one tap, no retention flow of ours in between (§4.8, no dark patterns).
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  prices: { month: string; year: string };
}

export function createStripeBilling(cfg: StripeConfig): BillingProvider {
  const stripe = new Stripe(cfg.secretKey);
  return {
    id: 'stripe',
    async createCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: cfg.prices[input.interval], quantity: 1 }],
        client_reference_id: input.userId,
        ...(input.existingCustomerId
          ? { customer: input.existingCustomerId }
          : input.email
            ? { customer_email: input.email }
            : {}),
        subscription_data: {
          metadata: { user_id: input.userId },
          ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: false,
      });
      if (!session.url) throw new Error('checkout session without url');
      return { url: session.url };
    },
    async createPortal(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },
    parseWebhook(rawBody, signature) {
      if (!signature) throw new BillingSignatureError('missing signature');
      try {
        return stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
      } catch (err) {
        throw new BillingSignatureError((err as Error).message);
      }
    },
  };
}

/** Test helper and the fake adapter's signer: a valid `stripe-signature` header for a body. */
export function signWebhookBody(rawBody: string, secret: string, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
    ...(timestamp ? { timestamp } : {}),
  });
}

/** Signature verification without a Stripe key (the fake adapter and tests). */
export function verifyWebhookBody(rawBody: string, signature: string | null, secret: string) {
  if (!signature) throw new BillingSignatureError('missing signature');
  try {
    return Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new BillingSignatureError((err as Error).message);
  }
}
