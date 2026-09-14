'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { listActivePeriodStarts } from '@/db/queries/retrospective';
import {
  getJourneyNarrative,
  getJourneySummary,
  getSummary,
  getSummaryForPeriod,
  setSummaryDismissed,
} from '@/db/queries/summaries';
import { summaryFloor } from '@/domain/summaries/floors';
import { inPeriod, parsePeriodKey } from '@/domain/summaries/periods';
import { flag } from '@/flags';
import { enqueue } from '@/jobs/enqueue';
import { runBatch } from '@/jobs/worker';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * The user's part of summaries (FR-20): dismiss (remembered), and regenerate — the one
 * explicit action on these screens that leads to a model call. Opening a retrospective or
 * a journey never does. Regeneration goes through the job queue like every generation
 * (`summarize_period` / `journey_narrative` with `force`) and runs that one job straight
 * away so the screen can show the result; the model layer is reached only through the
 * lazy handler registry, never from this route. A failure leaves the stored row as it was.
 */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

const FAILED = "That didn't go through. Nothing changed — try again.";
const uuid = z.string().uuid();

export async function dismissSummaryAction(id: string, dismissed: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, message: 'Not found.' };
  try {
    const client = await getSessionClient();
    await setSummaryDismissed(client, id, dismissed);
    const s = await getSummary(client, id);
    logger.info('summaries.dismissed', { userId: user.id, summaryId: id, enabled: dismissed });
    revalidatePath('/retrospective');
    revalidatePath('/home');
    if (s?.journey_id) revalidatePath(`/journey/${s.journey_id}`);
    return { ok: true };
  } catch (err) {
    logger.warn('summaries.dismiss_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

const regenerateSchema = z.union([
  z
    .object({ kind: z.enum(['weekly', 'monthly', 'yearly']), periodKey: z.string().min(4) })
    .strict(),
  z.object({ kind: z.literal('journey'), journeyId: uuid }).strict(),
]);

async function canGenerate(userId: string): Promise<string | null> {
  const client = await getSessionClient();
  const profile = await getProfile(client, userId);
  if (!profile || !hasAiConsent(profile))
    return 'AI is switched off in your profile, so nothing is generated.';
  if (!(await flag('period_summaries', { userId })))
    return 'Summaries are not switched on for your account yet.';
  return null;
}

export async function regenerateSummaryAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = regenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Not found.' };
  const target = parsed.data;
  try {
    const blocked = await canGenerate(user.id);
    if (blocked) return { ok: false, message: blocked };
    const client = await getSessionClient();
    let payload;
    let before: string | null = null;
    if (target.kind === 'journey') {
      const j = await client.from('journeys').select('id').eq('id', target.journeyId).maybeSingle();
      if (!j.data) return { ok: false, message: 'Not found.' };
      before = (await getJourneySummary(client, target.journeyId))?.generated_at ?? null;
      payload = { userId: user.id, kind: 'journey', journeyId: target.journeyId, force: true };
    } else {
      const period = parsePeriodKey(target.periodKey);
      if (!period) return { ok: false, message: 'Not found.' };
      const active = await listActivePeriodStarts(client);
      const count =
        active.readings.filter((d) => inPeriod(period, d)).length +
        active.events.filter((d) => inPeriod(period, d)).length;
      if (count < summaryFloor(period.kind))
        return { ok: false, message: 'Not enough entries in this period to summarise honestly.' };
      before = (await getSummaryForPeriod(client, period.kind, period.start))?.generated_at ?? null;
      payload = {
        userId: user.id,
        kind: period.kind,
        periodStart: period.start,
        periodEnd: period.end,
        force: true,
      };
    }
    const job = await enqueue('summarize_period', payload, { userId: user.id, maxAttempts: 1 });
    await runBatch({ jobId: job.id });
    const after =
      target.kind === 'journey'
        ? (await getJourneySummary(client, target.journeyId))?.generated_at
        : (await getSummaryForPeriod(client, target.kind, parsePeriodKey(target.periodKey)!.start))
            ?.generated_at;
    const changed = !!after && after !== before;
    logger.info('summaries.regenerate_requested', {
      userId: user.id,
      kind: target.kind,
      jobId: job.id,
      status: changed ? 'generated' : 'unchanged',
    });
    revalidatePath('/retrospective');
    revalidatePath('/home');
    if (target.kind === 'journey') revalidatePath(`/journey/${target.journeyId}`);
    else revalidatePath(`/retrospective/${target.periodKey}`);
    return changed
      ? { ok: true }
      : {
          ok: false,
          message:
            'Nothing could be written that cites your entries just now, so the earlier summary, if any, is unchanged.',
        };
  } catch (err) {
    logger.warn('summaries.regenerate_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: FAILED };
  }
}

export async function regenerateNarrativeAction(journeyId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(journeyId).success) return { ok: false, message: 'Not found.' };
  try {
    const blocked = await canGenerate(user.id);
    if (blocked) return { ok: false, message: 'Narratives are not switched on for this account.' };
    const client = await getSessionClient();
    const { data } = await client.from('journeys').select('id').eq('id', journeyId).maybeSingle();
    if (!data) return { ok: false, message: 'Not found.' };
    const before = (await getJourneyNarrative(client, journeyId))?.generated_at ?? null;
    const job = await enqueue(
      'journey_narrative',
      { journeyId, force: true },
      { userId: user.id, maxAttempts: 1 },
    );
    await runBatch({ jobId: job.id });
    const after = (await getJourneyNarrative(client, journeyId))?.generated_at ?? null;
    revalidatePath(`/journey/${journeyId}`);
    if (after && after !== before) return { ok: true };
    return {
      ok: false,
      message:
        'Nothing could be written that cites the entries (three are needed), so the plain header stays.',
    };
  } catch (err) {
    logger.warn('summaries.narrative_action_failed', {
      userId: user.id,
      errorClass: errorClassOf(err),
    });
    return { ok: false, message: FAILED };
  }
}
