import { platformSql } from '@/db/admin';

/**
 * Phase 06 fixtures. Extraction is flag-gated (`ai_extraction`, env default off); tests turn
 * it on per user through the same `user_flags` override a rollout would use.
 */
export async function enableExtraction(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'ai_extraction', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}

/** Phase 07 fixtures: journeys are flag-gated too (`journey_autocreate`, env default off). */
export async function enableJourneys(userId: string): Promise<void> {
  await platformSql()`
    insert into public.user_flags (user_id, flag, enabled, set_by)
    values (${userId}, 'journey_autocreate', true, 'rollout')
    on conflict (user_id, flag) do update set enabled = true`;
}
