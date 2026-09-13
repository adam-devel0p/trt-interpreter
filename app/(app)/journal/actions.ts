'use server';

import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { searchJournal, type JournalPage } from '@/db/queries/journal';
import { parseJournalParams } from '@/domain/journal/filters';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * The next page of the timeline for the current filters (cursor-based, FR-07). Stored rows
 * only — this action, like the page, reaches nothing under `src/ai/`.
 */
export async function loadJournalPageAction(
  rawParams: unknown,
  cursor: unknown,
  timeZone: unknown,
): Promise<{ ok: true; page: JournalPage } | { ok: false; message: string }> {
  const user = await requireUser();
  const params = z.record(z.string(), z.string()).safeParse(rawParams);
  const c = z.string().max(400).nullable().safeParse(cursor);
  const tz = z.string().max(64).optional().safeParse(timeZone);
  if (!params.success || !c.success) return { ok: false, message: 'Could not load more.' };
  try {
    const page = await searchJournal(await getSessionClient(), parseJournalParams(params.data), {
      cursor: c.data,
      timeZone: tz.success ? tz.data : undefined,
    });
    return { ok: true, page };
  } catch (err) {
    logger.warn('app.journal.page_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { ok: false, message: 'Could not load more. Try again.' };
  }
}
