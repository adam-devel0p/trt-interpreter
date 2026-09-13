import { describe, expect, it } from 'vitest';
import { CURATED_THEMES, resolveThemeLabel, slugifyTheme } from '@/domain/themes/taxonomy';
import { fnv1a, sourceHash, textKey } from '../hash';
import {
  applyOverrides,
  overrideKey,
  parseOverride,
  themeSlugFor,
  type Override,
} from '../overrides';
import { EMPTY_PAYLOAD, extractionPayloadSchema, type ExtractionPayload } from '../schema';

describe('extraction payload schema', () => {
  it('accepts the documented shape and fills defaults', () => {
    const p = extractionPayloadSchema.parse({
      life_area: 'work',
      entities: [{ mention: 'my boss', kind: 'person', confidence: 0.9 }],
      themes: [{ label: 'Decision', category: 'situational', weight: 0.8 }],
      possibilities: [{ text: 'The role could come with more travel.' }],
    });
    expect(p.entities[0]).toEqual({
      mention: 'my boss',
      kind: 'person',
      confidence: 0.9,
      relation: null,
      context: null,
    });
    expect(p.possibilities[0]?.kind).toBe('possibility');
    expect(p.journey_candidates).toEqual([]);
    expect(EMPTY_PAYLOAD.life_area).toBeNull();
  });
  it('carries no probability and refuses unknown keys, bad areas and out-of-range weights', () => {
    expect(extractionPayloadSchema.safeParse({ probability: 0.7 }).success).toBe(false);
    expect(extractionPayloadSchema.safeParse({ life_area: 'astrology' }).success).toBe(false);
    expect(
      extractionPayloadSchema.safeParse({
        themes: [{ label: 'x', category: 'situational', weight: 1.4 }],
      }).success,
    ).toBe(false);
    expect(
      extractionPayloadSchema.safeParse({ possibilities: [{ text: 'x', probability: 0.5 }] })
        .success,
    ).toBe(false);
    expect(JSON.stringify(extractionPayloadSchema.shape)).not.toMatch(/probab/i);
  });
});

describe('hashes', () => {
  it('are stable, case- and whitespace-insensitive for text keys, exact for source hashes', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(textKey('The role could come with more travel.')).toBe(
      textKey('the role could come  with more travel'),
    );
    expect(sourceHash('q', 'n')).not.toBe(sourceHash('q ', 'n'));
    expect(sourceHash(null, null)).toBe(sourceHash(null, null));
  });
});

describe('theme taxonomy', () => {
  it('has unique slugs and maps labels, synonyms and slugs onto curated themes', () => {
    const slugs = CURATED_THEMES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(resolveThemeLabel('Decision')?.slug).toBe('decision');
    expect(resolveThemeLabel('a fork in the road')?.slug).toBe('decision');
    expect(resolveThemeLabel('money_pressure')?.slug).toBe('money_pressure');
    expect(resolveThemeLabel('Work–life balance')?.slug).toBe('work_life');
    expect(resolveThemeLabel('the paperwork of leaving')).toBeNull();
    expect(slugifyTheme('The paperwork of leaving!')).toBe('the_paperwork_of_leaving');
    expect(themeSlugFor('Loss')).toBe('grief');
    expect(themeSlugFor('Novel label')).toBe('novel_label');
  });
});

const payload: ExtractionPayload = extractionPayloadSchema.parse({
  life_area: 'work',
  entities: [
    { mention: 'my boss', kind: 'person', confidence: 0.9, relation: 'manager' },
    { mention: 'the agency', kind: 'organization', confidence: 0.8 },
    { mention: 'My Boss', kind: 'person', confidence: 0.5 },
  ],
  themes: [
    { label: 'Decision', category: 'situational', weight: 0.9 },
    { label: 'worry', category: 'emotional', weight: 0.6 },
    { label: 'the paperwork of leaving', category: 'situational', weight: 0.4 },
  ],
  possibilities: [
    { text: 'The role could come with more travel.', category: 'work' },
    { text: 'You may be asked to decide quickly.' },
  ],
  timeframe: { start: null, end: null, text: 'before the review' },
});

describe('applyOverrides', () => {
  it('with no overrides mirrors the payload, dedupes mentions and maps themes onto the taxonomy', () => {
    const eff = applyOverrides(payload, []);
    expect(eff.lifeArea).toEqual({ value: 'work', source: 'model' });
    expect(eff.entities.map((e) => e.normalized)).toEqual(['boss', 'agency']);
    expect(eff.themes.map((t) => [t.slug, t.label, t.source])).toEqual([
      ['decision', 'Decision', 'model'],
      ['anxiety', 'Anxiety', 'model'],
      ['the_paperwork_of_leaving', 'the paperwork of leaving', 'model'],
    ]);
    expect(eff.possibilities).toHaveLength(2);
    expect(eff.timeframe).toEqual({
      start: null,
      end: null,
      text: 'before the review',
      source: 'model',
    });
  });

  it('overrides are authoritative for every chip kind', () => {
    const overrides: Override[] = [
      { fieldPath: overrideKey.lifeArea(), value: { kind: 'life_area', value: 'money' } },
      { fieldPath: overrideKey.theme('anxiety'), value: { kind: 'theme', state: 'dismissed' } },
      { fieldPath: overrideKey.theme('decision'), value: { kind: 'theme', state: 'confirmed' } },
      {
        fieldPath: overrideKey.theme('trust'),
        value: { kind: 'theme', state: 'added', label: 'Trust' },
      },
      {
        fieldPath: overrideKey.entity('The Agency'),
        value: { kind: 'entity', state: 'dismissed' },
      },
      {
        fieldPath: overrideKey.entity('my boss'),
        value: {
          kind: 'entity',
          state: 'linked',
          entityId: '00000000-0000-4000-8000-000000000001',
        },
      },
      {
        fieldPath: overrideKey.possibility('the role could come with more travel'),
        value: { kind: 'possibility', state: 'edited', text: 'More travel is possible.' },
      },
      {
        fieldPath: overrideKey.possibility('You may be asked to decide quickly.'),
        value: { kind: 'possibility', state: 'dismissed' },
      },
      {
        fieldPath: overrideKey.timeframe(),
        value: { kind: 'timeframe', state: 'edited', text: 'by Friday' },
      },
    ];
    const eff = applyOverrides(payload, overrides);
    expect(eff.lifeArea).toEqual({ value: 'money', source: 'user' });
    // Heaviest first; a user-added theme carries full weight.
    expect(eff.themes.map((t) => [t.slug, t.source, t.confirmed])).toEqual([
      ['trust', 'user', true],
      ['decision', 'model', true],
      ['the_paperwork_of_leaving', 'model', false],
    ]);
    expect(eff.entities).toEqual([
      expect.objectContaining({
        normalized: 'boss',
        linkedEntityId: '00000000-0000-4000-8000-000000000001',
      }),
    ]);
    expect(eff.possibilities).toEqual([
      expect.objectContaining({ text: 'More travel is possible.', source: 'user' }),
    ]);
    expect(eff.timeframe).toEqual({ start: null, end: null, text: 'by Friday', source: 'user' });
    // A dismissed timeframe / life area.
    const cleared = applyOverrides(payload, [
      { fieldPath: 'timeframe', value: { kind: 'timeframe', state: 'dismissed' } },
      { fieldPath: 'life_area', value: { kind: 'life_area', value: null } },
    ]);
    expect(cleared.timeframe).toBeNull();
    expect(cleared.lifeArea).toEqual({ value: null, source: 'user' });
  });

  it('overrides survive a reprocess that changes the payload', () => {
    const overrides: Override[] = [
      { fieldPath: overrideKey.theme('anxiety'), value: { kind: 'theme', state: 'dismissed' } },
      {
        fieldPath: overrideKey.theme('trust'),
        value: { kind: 'theme', state: 'added', label: 'Trust' },
      },
    ];
    const reprocessed: ExtractionPayload = {
      ...payload,
      themes: [
        { label: 'Anxiety', category: 'emotional', weight: 0.95 },
        { label: 'Change', category: 'situational', weight: 0.5 },
      ],
    };
    const eff = applyOverrides(reprocessed, overrides);
    expect(eff.themes.map((t) => t.slug)).toEqual(['trust', 'change']);
  });

  it('parseOverride ignores malformed or mismatched rows instead of failing', () => {
    expect(parseOverride('life_area', { kind: 'life_area', value: 'work' })).not.toBeNull();
    expect(parseOverride('themes/x', { kind: 'life_area', value: 'work' })).toBeNull();
    expect(parseOverride('life_area', { kind: 'life_area', value: 'nope' })).toBeNull();
    expect(parseOverride('life_area', 'garbage')).toBeNull();
    expect(overrideKey.entity('My Boss’s')).toBe('entities/boss');
  });
});
