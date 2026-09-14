import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterEvidence,
  scorePair,
  selectSuggestions,
  type CorrelationObject,
} from '@/domain/correlation/score';

/**
 * Invariant (spec §10 "no self-validating loops", ALGORITHMS §3 guard 2): an interpretation
 * or a period summary may never be the sole evidence that a real-life event occurred. The
 * engine goes further and never counts generated text as evidence at all:
 *   1. entities and themes whose provenance is `interpretation` or `period_summary` are
 *      dropped before scoring, so a bundle made only of them yields nothing;
 *   2. a mixed bundle scores exactly as its user-text part alone;
 *   3. the feature loader only ever reads extractions of the user's own words and marks
 *      everything `user_text` (structural).
 */
const day = (d: string) => `${d}T12:00:00.000Z`;
const base = (id: string, type: CorrelationObject['type'], at: string): CorrelationObject => ({
  id,
  type,
  occurredAt: day(at),
  entities: [],
  themes: [],
  journeys: [],
  ...(type === 'reading' ? { cards: ['c'], horizon: null } : {}),
});

describe('summary-never-sole-evidence', () => {
  it('1 · a bundle whose only evidence came from generated text produces no link', () => {
    const reading: CorrelationObject = {
      ...base('r', 'reading', '2026-04-01'),
      entities: [{ id: 'agency', resolution: 'auto', provenance: 'interpretation' }],
      themes: [
        { slug: 'decision', weight: 0.9, provenance: 'period_summary' },
        { slug: 'ambition', weight: 0.8, provenance: 'interpretation' },
      ],
      horizon: { start: '2026-04-01', end: '2026-04-30', text: 'this month' },
    };
    const event: CorrelationObject = {
      ...base('e', 'life_event', '2026-04-10'),
      entities: [{ id: 'agency', resolution: 'user' }],
      themes: [
        { slug: 'decision', weight: 0.9 },
        { slug: 'ambition', weight: 0.8 },
      ],
    };
    const c = scorePair(reading, event);
    expect(c.signals.entity_overlap).toBe(0);
    expect(c.signals.theme_overlap).toBe(0);
    expect(c.evidence.sharedEntityIds).toEqual([]);
    expect(c.evidence.sharedThemeSlugs).toEqual([]);
    expect(c.eligible).toBe(false);
    expect(selectSuggestions([{ candidate: event, correlation: c }]).store).toEqual([]);
    // The timeframe (the user's question) and proximity are honest signals but not enough alone.
    expect(c.signals.timeframe_fit).toBe(1);
  });

  it('2 · generated evidence adds nothing to a bundle that also has the user’s words', () => {
    const userOnly: CorrelationObject = {
      ...base('r', 'reading', '2026-04-01'),
      entities: [{ id: 'agency', resolution: 'auto' }],
      themes: [{ slug: 'decision', weight: 0.7 }],
    };
    const padded: CorrelationObject = {
      ...userOnly,
      entities: [
        ...userOnly.entities,
        { id: 'sam', resolution: 'auto', provenance: 'interpretation' },
      ],
      themes: [...userOnly.themes, { slug: 'ambition', weight: 0.9, provenance: 'period_summary' }],
    };
    const event: CorrelationObject = {
      ...base('e', 'life_event', '2026-04-10'),
      entities: [
        { id: 'agency', resolution: 'auto' },
        { id: 'sam', resolution: 'auto' },
      ],
      themes: [
        { slug: 'decision', weight: 0.7 },
        { slug: 'ambition', weight: 0.9 },
      ],
    };
    const a = scorePair(userOnly, event);
    const b = scorePair(padded, event);
    expect(b.score).toBe(a.score);
    expect(b.signals).toEqual(a.signals);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(filterEvidence(padded)).toEqual(userOnly);
  });

  it('3 · the feature loader reads only extractions of the user’s words and marks them user_text', () => {
    const src = readFileSync(path.resolve('src/correlation/features.ts'), 'utf8');
    expect(src).not.toMatch(/interpretations/);
    expect(src).not.toMatch(/period_summaries|periodSummaries/);
    expect(src).toMatch(/provenance: 'user_text'/);
    expect((src.match(/provenance: /g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The engine filters regardless of what a loader hands it.
    const score = readFileSync(path.resolve('src/domain/correlation/score.ts'), 'utf8');
    expect(score).toMatch(/const a = filterEvidence\(rawA\);\s*const b = filterEvidence\(rawB\);/);
  });
});

/**
 * Phase 10: a period summary's own source set (spec §19 "journey summaries never cite a
 * model-generated summary as the sole evidence", FR-20). The application boundary refuses
 * a set made only of summaries or interpretations; the database refuses the empty set by
 * check constraint (exercised in `src/summaries/__tests__/summaries.integration.test.ts`);
 * the generator only ever builds a set from readings and life events (structural); and an
 * Ask answer drops a claim that rests on covering summaries alone.
 */
describe('summary-never-sole-evidence · period summaries (Phase 10)', () => {
  it('4 · the application boundary rejects a source set of summaries / interpretations, and the empty set', async () => {
    const { validateSources } = await import('@/domain/summaries/provenance');
    expect(validateSources([])).toEqual({ ok: false, reason: 'empty' });
    expect(
      validateSources([
        { type: 'period_summary', id: '11111111-1111-4111-8111-111111111111' },
        { type: 'interpretation', id: '22222222-2222-4222-8222-222222222222' },
      ]),
    ).toEqual({ ok: false, reason: 'generated_only' });
    expect(
      validateSources([
        { type: 'period_summary', id: '11111111-1111-4111-8111-111111111111' },
        { type: 'reading', id: '33333333-3333-4333-8333-333333333333' },
      ]).ok,
    ).toBe(true);
  });

  it('5 · the schema and migration carry the non-empty check, and the generator validates before storing', () => {
    const schema = readFileSync(path.resolve('src/db/schema/summaries.ts'), 'utf8');
    expect(schema).toMatch(
      /period_summaries_sources_check[\s\S]*cardinality\([\s\S]*sourceObjectIds[\s\S]*\) > 0/,
    );
    const migration = readFileSync(
      path.resolve('src/db/migrations/0011_summaries_retrospectives.sql'),
      'utf8',
    );
    expect(migration).toMatch(
      /CONSTRAINT "period_summaries_sources_check" CHECK \(cardinality\("period_summaries"\."source_object_ids"\) > 0\)/,
    );
    const generate = readFileSync(path.resolve('src/summaries/generate.ts'), 'utf8');
    expect(generate).toMatch(/validateSources\(evidence\.sources\)/);
    expect(generate).toMatch(/if \(!sources\.ok\) return/);
    // Evidence comes from the history loader (readings + events), never from summaries or interpretations.
    const evidence = readFileSync(path.resolve('src/summaries/evidence.ts'), 'utf8');
    expect(evidence).toMatch(/loadHistoryObjects/);
    expect(evidence).not.toMatch(/periodSummaries|interpretations/);
  });

  it('6 · a "confirmed fact" in a summary needs confirmed evidence, and an Ask claim never rests on summaries alone', async () => {
    const { verifySummary } = await import('@/domain/summaries/provenance');
    const labels = new Map([
      ['E1', { confirmed: false }],
      ['E2', { confirmed: true }],
    ]);
    const out = verifySummary(
      {
        headline: 'h',
        recurred: [],
        shifted: [],
        open: [],
        confirmed: [
          { text: 'You moved.', basis: 'confirmed_fact', citations: ['E1'] },
          { text: 'You logged the move.', basis: 'confirmed_fact', citations: ['E2'] },
        ],
      },
      labels,
    );
    expect(out.summary.confirmed.map((c) => c.text)).toEqual(['You logged the move.']);
    const { verifyAnswer } = await import('@/domain/retrieval/answer');
    const a = verifyAnswer(
      {
        evidence_sufficient: true,
        conclusion: 'c',
        claims: [{ text: 'It happened.', citations: ['E3'] }],
        found: null,
        narrower_question: null,
      },
      new Set(['E1', 'E3']),
      { summaryLabels: new Set(['E3']) },
    );
    expect(a.answer.claims).toEqual([]);
    expect(a.grounded).toBe(false);
  });
});
