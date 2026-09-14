'use server';

import { z } from 'zod';
import { track } from '@/analytics/track';
import { requireUser } from '@/auth/session';

/** A card left the device (§15.1 acquisition loop): a count by kind and method, nothing else. */
export async function noteShareAction(kind: unknown, method: unknown): Promise<void> {
  const user = await requireUser();
  const k = z.enum(['reading', 'month']).safeParse(kind);
  const m = z.enum(['share', 'download']).safeParse(method);
  if (k.success && m.success) track(user.id, 'share_card_shared', { kind: k.data, method: m.data });
}
