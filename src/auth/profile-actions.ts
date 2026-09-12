'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { EXPLANATION_DEPTHS, setAiConsent, updateProfile } from '@/db/queries/profile';
import { errorClassOf, logger } from '@/observability/logger';
import type { PrefState } from './form-state';
import { getSessionClient, requireUser } from './session';

/**
 * Profile-screen preference writes. Each is one validated field; each revalidates the
 * Profile route so the RSC re-reads the row. Failures are logged by class and surface as a
 * neutral message — the previous value stays on screen.
 */

const FAILED = "That didn't save. Your previous setting is still in place — try again.";

async function run(
  write: (client: Awaited<ReturnType<typeof getSessionClient>>, userId: string) => Promise<unknown>,
): Promise<PrefState> {
  const user = await requireUser();
  const client = await getSessionClient();
  try {
    await write(client, user.id);
    revalidatePath('/profile');
    return { status: 'idle' };
  } catch (err) {
    logger.warn('app.profile.write_failed', { userId: user.id, errorClass: errorClassOf(err) });
    return { status: 'error', message: FAILED };
  }
}

export async function setAiConsentAction(granted: boolean): Promise<PrefState> {
  return run(async (client, userId) => {
    await setAiConsent(client, userId, granted);
    logger.info(granted ? 'app.ai_consent.granted' : 'app.ai_consent.withdrawn', { userId });
  });
}

export async function setExplanationDepthAction(
  _prev: PrefState,
  fd: FormData,
): Promise<PrefState> {
  const parsed = z.enum(EXPLANATION_DEPTHS).safeParse(fd.get('depth'));
  if (!parsed.success) return { status: 'error', message: FAILED };
  return run((client, userId) =>
    updateProfile(client, userId, { ai_explanation_depth: parsed.data }),
  );
}
