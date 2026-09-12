/**
 * Profile reads/writes through the RLS-respecting user client. Rows come back in the
 * database's snake_case; keep it that way here so the shape matches DATA_MODEL.md and the
 * PostgREST wire format, and map at the edge if a component wants camelCase.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import {
  EXPERIENCE_LEVELS,
  USAGE_STYLES,
  type ExperienceLevel,
  type UsageStyle,
} from '@/domain/onboarding/machine';

export const EXPLANATION_DEPTHS = ['brief', 'standard', 'deep'] as const;
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];

export interface ProfileRow {
  id: string;
  locale: string;
  timezone: string;
  usage_style: UsageStyle | null;
  experience_level: ExperienceLevel | null;
  default_deck_id: string | null;
  use_reversals: boolean;
  ai_consent_at: string | null;
  ai_explanation_depth: ExplanationDepth;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
}

const PROFILE_COLUMNS =
  'id, locale, timezone, usage_style, experience_level, default_deck_id, use_reversals, ' +
  'ai_consent_at, ai_explanation_depth, onboarding_step, onboarding_completed_at, plan, ' +
  'created_at, updated_at';

/** Everything a user may write about themselves. `plan` is absent on purpose. */
export const profilePatchSchema = z
  .object({
    locale: z.string().min(2).max(16),
    timezone: z.string().min(1).max(64),
    usage_style: z.enum(USAGE_STYLES).nullable(),
    experience_level: z.enum(EXPERIENCE_LEVELS).nullable(),
    default_deck_id: z.string().uuid().nullable(),
    use_reversals: z.boolean(),
    ai_consent_at: z.string().datetime({ offset: true }).nullable(),
    ai_explanation_depth: z.enum(EXPLANATION_DEPTHS),
    onboarding_step: z.number().int().min(0).max(32),
    onboarding_completed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .partial()
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export class ProfileError extends Error {
  override name = 'ProfileError';
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The caller's profile. The trigger guarantees one exists; a miss means the session is stale. */
export async function getProfile(client: UserClient, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new ProfileError('profile read failed', error.code);
  return (data as ProfileRow | null) ?? null;
}

/** Validated partial update; returns the fresh row. Unknown keys are rejected, not dropped. */
export async function updateProfile(
  client: UserClient,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRow> {
  const clean = profilePatchSchema.parse(patch);
  const { data, error } = await client
    .from('profiles')
    .update(clean)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new ProfileError('profile update failed', error.code);
  return data as unknown as ProfileRow;
}

/** Consent is a timestamp, never a boolean: when it was given matters (§9.2, §11). */
export function setAiConsent(
  client: UserClient,
  userId: string,
  granted: boolean,
  now = new Date(),
) {
  return updateProfile(client, userId, { ai_consent_at: granted ? now.toISOString() : null });
}

export function hasAiConsent(profile: Pick<ProfileRow, 'ai_consent_at'>): boolean {
  return profile.ai_consent_at !== null;
}
