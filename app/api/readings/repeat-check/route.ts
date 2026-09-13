import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getEmbedder } from '@/ai';
import { getSessionClient, getUser } from '@/auth/session';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { QUESTION_MAX } from '@/domain/readings/types';
import { checkRepeatQuestion } from '@/interpretation/repeat';
import { errorClassOf, logger } from '@/observability/logger';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ question: z.string().trim().min(1).max(QUESTION_MAX) }).strict();

/**
 * Repeated-question check before drawing (FR-25). Consent-gated (the question is embedded by a
 * provider). Never blocks: any failure answers "no nudge".
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 401 }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ nudge: false, priorReadings: [] });
  try {
    const client = await getSessionClient();
    const profile = await getProfile(client, user.id);
    if (!profile || !hasAiConsent(profile)) {
      return NextResponse.json({ nudge: false, priorReadings: [], consent: false });
    }
    const result = await checkRepeatQuestion({
      client,
      userId: user.id,
      question: parsed.data.question,
      embedder: getEmbedder(),
    });
    return NextResponse.json(result);
  } catch (err) {
    // The check must never block a draw: any failure answers "no nudge".
    logger.warn('ai.repeat.route_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return NextResponse.json({ nudge: false, priorReadings: [] });
  }
}
