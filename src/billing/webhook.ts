import 'server-only';
import { BillingEventShapeError, normalizeStripeEvent } from '@/domain/billing/providerEvents';
import { logger } from '@/observability/logger';
import { getBilling } from './index';
import { BillingSignatureError } from './provider';
import { applyBillingEvent, type ApplyOutcome } from './subscriptions';

export type WebhookResult =
  { status: 200; outcome: ApplyOutcome } | { status: 400; error: 'signature' | 'shape' };

/**
 * One verified body in, one outcome out. Shared by the HTTP route and the fake provider's
 * pages, so both paths run the signature check, the normaliser and the idempotent apply.
 */
export async function handleWebhookBody(
  rawBody: string,
  signature: string | null,
): Promise<WebhookResult> {
  let raw: unknown;
  try {
    raw = getBilling().parseWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof BillingSignatureError) {
      logger.warn('billing.webhook.bad_signature', { errorClass: err.name });
      return { status: 400, error: 'signature' };
    }
    throw err;
  }
  try {
    const outcome = await applyBillingEvent(normalizeStripeEvent(raw));
    return { status: 200, outcome };
  } catch (err) {
    if (err instanceof BillingEventShapeError) {
      logger.warn('billing.webhook.bad_shape', { errorClass: err.name });
      return { status: 400, error: 'shape' };
    }
    throw err;
  }
}
