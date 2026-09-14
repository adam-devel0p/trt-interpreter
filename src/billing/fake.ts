import 'server-only';
import type { BillingProvider } from './provider';
import { verifyWebhookBody } from './stripe';

/**
 * The local billing provider: checkout and the portal are pages of this app
 * (`/billing/checkout`, `/billing/portal`) that emit Stripe-shaped events, sign them with the
 * webhook secret and POST them to `/api/billing/webhook` — the real handler, the real
 * signature check, the real ledger. Never enabled in production (`getBilling()` refuses).
 */
export function createFakeBilling(cfg: {
  webhookSecret: string;
  siteUrl: string;
}): BillingProvider {
  // The pages are ours, so every URL stays relative: the e2e server's port is not the site URL's.
  const rel = (u: string) => (u.startsWith(cfg.siteUrl) ? u.slice(cfg.siteUrl.length) || '/' : u);
  return {
    id: 'fake',
    async createCheckout(input) {
      const q = new URLSearchParams({
        interval: input.interval,
        trial: String(input.trialDays),
        success: rel(input.successUrl),
        cancel: rel(input.cancelUrl),
        ...(input.existingCustomerId ? { customer: input.existingCustomerId } : {}),
      });
      return { url: `/billing/checkout?${q.toString()}` };
    },
    async createPortal(input) {
      const q = new URLSearchParams({ customer: input.customerId, return: rel(input.returnUrl) });
      return { url: `/billing/portal?${q.toString()}` };
    },
    parseWebhook(rawBody, signature) {
      return verifyWebhookBody(rawBody, signature, cfg.webhookSecret);
    },
  };
}
