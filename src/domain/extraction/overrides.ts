/**
 * User corrections to extracted metadata (FR-26). An override is keyed by a stable
 * `field_path` and holds a small typed value; `applyOverrides()` layers a set of overrides
 * over an extraction payload to produce what the user actually sees. The read path and the
 * materialiser both use it, so a reprocess under a newer schema can never undo a correction.
 */
import { z } from 'zod';
import { normalizeAlias } from '../entities/normalize';
import { LIFE_AREAS } from '../readings/types';
import { resolveThemeLabel, slugifyTheme } from '../themes/taxonomy';
import { textKey } from './hash';
import { THEME_CATEGORIES, type ExtractionPayload, type EntityKind } from './schema';

const lifeAreaKeys = LIFE_AREAS.map((a) => a.key) as [string, ...string[]];

export const overrideValueSchema = z.union([
  z.object({ kind: z.literal('life_area'), value: z.enum(lifeAreaKeys).nullable() }).strict(),
  z
    .object({
      kind: z.literal('theme'),
      state: z.enum(['dismissed', 'confirmed', 'added']),
      label: z.string().trim().min(1).max(120).optional(),
      category: z.enum(THEME_CATEGORIES).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('entity'), state: z.literal('dismissed') }).strict(),
  z
    .object({ kind: z.literal('entity'), state: z.literal('linked'), entityId: z.string().uuid() })
    .strict(),
  z.object({ kind: z.literal('possibility'), state: z.literal('dismissed') }).strict(),
  z
    .object({
      kind: z.literal('possibility'),
      state: z.literal('edited'),
      text: z.string().trim().min(1).max(400),
    })
    .strict(),
  z.object({ kind: z.literal('timeframe'), state: z.literal('dismissed') }).strict(),
  z
    .object({
      kind: z.literal('timeframe'),
      state: z.literal('edited'),
      text: z.string().trim().min(1).max(120),
    })
    .strict(),
]);
export type OverrideValue = z.infer<typeof overrideValueSchema>;

export interface Override {
  fieldPath: string;
  value: OverrideValue;
}

/** Stable keys. */
export const overrideKey = {
  lifeArea: () => 'life_area',
  theme: (slug: string) => `themes/${slug}`,
  entity: (mentionText: string) => `entities/${normalizeAlias(mentionText)}`,
  possibility: (text: string) => `possibilities/${textKey(text)}`,
  timeframe: () => 'timeframe',
} as const;

/** Parse a stored (field_path, value) pair; malformed rows are ignored, never fatal. */
export function parseOverride(fieldPath: string, value: unknown): Override | null {
  const parsed = overrideValueSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const prefix = fieldPath.split('/')[0];
  const expected: Record<OverrideValue['kind'], string> = {
    life_area: 'life_area',
    theme: 'themes',
    entity: 'entities',
    possibility: 'possibilities',
    timeframe: 'timeframe',
  };
  if (expected[v.kind] !== prefix) return null;
  return { fieldPath, value: v };
}

/** The taxonomy slug a free-text theme label lands on. */
export function themeSlugFor(label: string): string {
  return resolveThemeLabel(label)?.slug ?? slugifyTheme(label);
}

export type Provenance = 'model' | 'user';

export interface EffectiveTheme {
  slug: string;
  label: string;
  category: (typeof THEME_CATEGORIES)[number];
  weight: number;
  source: Provenance;
  confirmed: boolean;
}
export interface EffectiveEntityMention {
  mention: string;
  normalized: string;
  kind: EntityKind;
  relation: string | null;
  context: string | null;
  confidence: number;
  /** A user relink pins the mention to this entity. */
  linkedEntityId: string | null;
}
export interface EffectivePossibility {
  key: string;
  text: string;
  category: string | null;
  timeframe: string | null;
  kind: 'possibility' | 'prediction';
  source: Provenance;
}
export interface EffectiveMetadata {
  lifeArea: { value: string | null; source: Provenance };
  themes: EffectiveTheme[];
  entities: EffectiveEntityMention[];
  possibilities: EffectivePossibility[];
  timeframe: {
    text: string | null;
    start: string | null;
    end: string | null;
    source: Provenance;
  } | null;
  goals: string[];
  fears: string[];
  decisions: string[];
  emotionalTone: string | null;
  eventMentions: ExtractionPayload['event_mentions'];
  journeyCandidates: ExtractionPayload['journey_candidates'];
}

/** Layer the user's corrections over an extraction payload. Overrides always win. */
export function applyOverrides(
  payload: ExtractionPayload,
  overrides: readonly Override[],
): EffectiveMetadata {
  const byPath = new Map(overrides.map((o) => [o.fieldPath, o.value]));

  const lifeOverride = byPath.get(overrideKey.lifeArea());
  const lifeArea =
    lifeOverride?.kind === 'life_area'
      ? { value: lifeOverride.value, source: 'user' as const }
      : { value: payload.life_area, source: 'model' as const };

  const themes: EffectiveTheme[] = [];
  const seenThemes = new Set<string>();
  for (const t of payload.themes) {
    const slug = themeSlugFor(t.label);
    if (seenThemes.has(slug)) continue;
    seenThemes.add(slug);
    const o = byPath.get(overrideKey.theme(slug));
    if (o?.kind === 'theme' && o.state === 'dismissed') continue;
    const curated = resolveThemeLabel(t.label);
    themes.push({
      slug,
      label: curated?.label ?? t.label,
      category: curated?.category ?? t.category,
      weight: t.weight,
      source: 'model',
      confirmed: o?.kind === 'theme' && o.state === 'confirmed',
    });
  }
  for (const [path, o] of byPath) {
    if (o.kind !== 'theme' || o.state !== 'added') continue;
    const slug = path.slice('themes/'.length);
    if (!slug || seenThemes.has(slug)) continue;
    seenThemes.add(slug);
    const curated = resolveThemeLabel(o.label ?? slug);
    themes.push({
      slug,
      label: curated?.label ?? o.label ?? slug,
      category: curated?.category ?? o.category ?? 'situational',
      weight: 1,
      source: 'user',
      confirmed: true,
    });
  }
  themes.sort((a, b) => b.weight - a.weight);

  const entities: EffectiveEntityMention[] = [];
  const seenMentions = new Set<string>();
  for (const e of payload.entities) {
    const normalized = normalizeAlias(e.mention);
    if (!normalized || seenMentions.has(normalized)) continue;
    seenMentions.add(normalized);
    const o = byPath.get(overrideKey.entity(e.mention));
    if (o?.kind === 'entity' && o.state === 'dismissed') continue;
    entities.push({
      mention: e.mention,
      normalized,
      kind: e.kind,
      relation: e.relation,
      context: e.context,
      confidence: e.confidence,
      linkedEntityId: o?.kind === 'entity' && o.state === 'linked' ? o.entityId : null,
    });
  }

  const possibilities: EffectivePossibility[] = [];
  const seenPoss = new Set<string>();
  for (const p of payload.possibilities) {
    const key = textKey(p.text);
    if (seenPoss.has(key)) continue;
    seenPoss.add(key);
    const o = byPath.get(overrideKey.possibility(p.text));
    if (o?.kind === 'possibility' && o.state === 'dismissed') continue;
    const edited = o?.kind === 'possibility' && o.state === 'edited';
    possibilities.push({
      key,
      text: edited ? o.text : p.text,
      category: p.category,
      timeframe: p.timeframe,
      kind: p.kind,
      source: edited ? 'user' : 'model',
    });
  }

  const tfOverride = byPath.get(overrideKey.timeframe());
  let timeframe: EffectiveMetadata['timeframe'] = payload.timeframe
    ? { ...payload.timeframe, source: 'model' }
    : null;
  if (tfOverride?.kind === 'timeframe') {
    timeframe =
      tfOverride.state === 'dismissed'
        ? null
        : {
            text: tfOverride.text,
            start: payload.timeframe?.start ?? null,
            end: payload.timeframe?.end ?? null,
            source: 'user',
          };
  }

  return {
    lifeArea,
    themes,
    entities,
    possibilities,
    timeframe,
    goals: payload.goals,
    fears: payload.fears,
    decisions: payload.decisions,
    emotionalTone: payload.emotional_tone,
    eventMentions: payload.event_mentions,
    journeyCandidates: payload.journey_candidates,
  };
}
