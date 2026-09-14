/**
 * The billing provider seam (spec §14). Two adapters: `stripe` (the real thing, test or live
 * keys) and `fake` (local pages that walk the same lifecycle through the same webhook route,
 * so the handler, the signature check and the idempotency ledger are exercised without a key).
 * Nothing outside `src/billing/` knows which one is live.
 */
import type { BillingInterval } from '@/domain/billing/pricing';

export interface CheckoutInput {
  userId: string;
  email: string | null;
  interval: BillingInterval;
  /** 0 = no trial (a second checkout after a used trial). */
  trialDays: number;
  existingCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalInput {
  customerId: string;
  returnUrl: string;
}

export class BillingSignatureError extends Error {
  override readonly name = 'BillingSignatureError';
}

export interface BillingProvider {
  readonly id: 'stripe' | 'fake';
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  createPortal(input: PortalInput): Promise<{ url: string }>;
  /**
   * Verifies the webhook signature and returns the provider-shaped event object. Throws
   * `BillingSignatureError` when the signature is missing, malformed or stale.
   */
  parseWebhook(rawBody: string, signature: string | null): unknown;
}
