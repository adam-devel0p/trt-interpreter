/**
 * Custom spreads (FR-05): user-owned `spreads` rows through the RLS-respecting client. Built-in
 * spreads are read via `listSpreads` in ./decks.
 */
import { z } from 'zod';
import type { UserClient } from '@/db/client';
import { spreadLayoutSchema, spreadPositionSchema } from '@/domain/decks/types';
import { autoLayout, positionKey, slugify } from '@/domain/readings/spreadLayout';
import {
  CUSTOM_SPREAD_MAX_POSITIONS,
  CUSTOM_SPREAD_MIN_POSITIONS,
} from '@/domain/readings/thresholds';
import { DeckQueryError, SPREAD_COLUMNS, type SpreadView } from './decks';

export const customSpreadInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300),
    positions: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(60),
            prompt: z.string().trim().max(300),
          })
          .strict(),
      )
      .min(CUSTOM_SPREAD_MIN_POSITIONS)
      .max(CUSTOM_SPREAD_MAX_POSITIONS),
  })
  .strict();
export type CustomSpreadInput = z.infer<typeof customSpreadInputSchema>;

/** Position prompts are optional in the UI; the schema needs ≥ 20 chars, so fill a neutral one. */
export function defaultPrompt(positionName: string): string {
  return `What this card suggests in the position “${positionName}”, read alongside the question.`;
}

/** Build the row a valid custom spread becomes (pure; the query below persists it). */
export function buildCustomSpread(input: CustomSpreadInput, userId: string, slugSuffix = '') {
  const clean = customSpreadInputSchema.parse(input);
  const taken = new Set<string>();
  const positions = clean.positions.map((p, index) => {
    const key = positionKey(p.name, index, taken);
    taken.add(key);
    return spreadPositionSchema.parse({
      index,
      key,
      name: p.name,
      prompt: p.prompt.length >= 20 ? p.prompt : defaultPrompt(p.name),
    });
  });
  const layout = spreadLayoutSchema.parse(autoLayout(positions.length));
  return {
    user_id: userId,
    slug: `${slugify(clean.name)}${slugSuffix}`,
    name: clean.name,
    description:
      clean.description || `${positions.length} position${positions.length === 1 ? '' : 's'}.`,
    positions,
    layout,
    is_builtin: false,
    deck_scope: null,
    card_count: positions.length,
    sort_order: 100,
  };
}

/** Insert, retrying the slug with a numeric suffix if the user already has one by that name. */
export async function createCustomSpread(
  client: UserClient,
  userId: string,
  input: CustomSpreadInput,
): Promise<SpreadView> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = buildCustomSpread(input, userId, attempt === 0 ? '' : `-${attempt + 1}`);
    const { data, error } = await client
      .from('spreads')
      .insert(row)
      .select(SPREAD_COLUMNS)
      .single();
    if (!error) return data as unknown as SpreadView;
    if (error.code !== '23505') throw new DeckQueryError('spread insert failed', error.code);
  }
  throw new DeckQueryError('spread insert failed', '23505');
}

export async function getSpreadById(client: UserClient, id: string): Promise<SpreadView | null> {
  const { data, error } = await client
    .from('spreads')
    .select(SPREAD_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new DeckQueryError('spread read failed', error.code);
  return (data as unknown as SpreadView | null) ?? null;
}

/** The caller's own custom spreads (RLS scopes the rows). */
export async function listCustomSpreads(client: UserClient): Promise<SpreadView[]> {
  const { data, error } = await client
    .from('spreads')
    .select(SPREAD_COLUMNS)
    .eq('is_builtin', false)
    .not('user_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw new DeckQueryError('spreads read failed', error.code);
  return (data ?? []) as unknown as SpreadView[];
}

/**
 * Delete a custom spread. Readings keep a plain FK to spreads, so a spread in use is refused
 * (`23503`) and the caller shows a message rather than orphaning readings.
 */
export async function deleteCustomSpread(
  client: UserClient,
  id: string,
): Promise<'deleted' | 'in_use' | 'missing'> {
  const { data, error } = await client
    .from('spreads')
    .delete()
    .eq('id', id)
    .eq('is_builtin', false)
    .select('id');
  if (error) {
    if (error.code === '23503') return 'in_use';
    throw new DeckQueryError('spread delete failed', error.code);
  }
  return data && data.length > 0 ? 'deleted' : 'missing';
}
