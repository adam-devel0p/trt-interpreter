import { NextResponse } from 'next/server';
import { handleWebhookBody } from '@/billing/webhook';

export const dynamic = 'force-dynamic';

/**
 * Billing webhook (§14). The raw body is verified against the provider's signature before
 * anything is parsed; a bad signature is a 400 with no detail. Every accepted event is
 * acknowledged with 200 whatever its outcome (applied, duplicate, stale, unknown type), so
 * the provider does not retry what we have already handled.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const result = await handleWebhookBody(raw, req.headers.get('stripe-signature'));
  if (result.status === 400) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ outcome: result.outcome });
}
