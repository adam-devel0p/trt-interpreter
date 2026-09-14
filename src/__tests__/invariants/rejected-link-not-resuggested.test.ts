import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldResurface } from '@/domain/correlation/resurface';
import { scorePair, type CorrelationObject } from '@/domain/correlation/score';
import { RESUGGEST_DELTA } from '@/domain/correlation/thresholds';

/**
 * Invariant (spec §19, ALGORITHMS §3 "Feedback → confidence"): a rejected link is not
 * re-suggested without a materially new evidence fingerprint. Pure half here (the database
 * proof — reject, re-run the engine unchanged → nothing; add evidence → once — is
 * `src/correlation/__tests__/correlation.integration.test.ts`):
 *   1. an identical re-run after a rejection yields the same fingerprint and is not re-surfaced;
 *   2. new evidence must score at least RESUGGEST_DELTA higher, or be a user-confirmed
 *      entity / journey overlap that did not exist at the rejection;
 *   3. the runtime records the score and fingerprint at rejection and consults the rule
 *      (structural), and the rejected row is never deleted by the engine.
 */
const day = (d: string) => `${d}T12:00:00.000Z`;
const reading = (over: Partial<CorrelationObject> = {}): CorrelationObject => ({
  id: 'r',
  type: 'reading',
  occurredAt: day('2026-05-01'),
  entities: [{ id: 'maya', resolution: 'auto' }],
  themes: [],
  journeys: [],
  cards: ['c'],
  horizon: null,
  ...over,
});
const event = (over: Partial<CorrelationObject> = {}): CorrelationObject => ({
  id: 'e',
  type: 'life_event',
  occurredAt: day('2026-05-15'),
  entities: [{ id: 'maya', resolution: 'auto' }],
  themes: [],
  journeys: [],
  ...over,
});

describe('rejected-link-not-resuggested', () => {
  const first = scorePair(reading(), event());
  const rejected = {
    state: 'rejected' as const,
    rejectedScore: first.score,
    rejectedFingerprint: first.fingerprint,
    confirmedEntityIds: first.evidence.confirmedEntityIds,
    confirmedJourneyIds: first.evidence.confirmedJourneyIds,
  };

  it('1 · the same evidence, re-run, never comes back', () => {
    const again = scorePair(reading(), event());
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(shouldResurface(rejected, again)).toEqual({ resurface: false, reason: 'same_evidence' });
    // Nor when a day of drift nudges proximity without changing the evidence set.
    const drift = scorePair(reading(), event({ occurredAt: day('2026-05-16') }));
    expect(drift.fingerprint).toBe(first.fingerprint);
    expect(shouldResurface(rejected, drift).resurface).toBe(false);
  });

  it(`2 · new evidence returns it once only when it scores ≥ +${RESUGGEST_DELTA}, or on a confirmed overlap`, () => {
    // A shared theme is new evidence (new fingerprint) but a small lift: not enough.
    const small = scorePair(
      reading({ themes: [{ slug: 'distance', weight: 0.3 }] }),
      event({
        themes: [
          { slug: 'distance', weight: 0.3 },
          { slug: 'home', weight: 0.9 },
        ],
      }),
    );
    expect(small.fingerprint).not.toBe(first.fingerprint);
    expect(small.score - first.score).toBeLessThan(RESUGGEST_DELTA);
    expect(shouldResurface(rejected, small)).toEqual({
      resurface: false,
      reason: 'not_materially_stronger',
    });
    // A shared journey, a shared theme and a stated horizon: materially stronger.
    const strong = scorePair(
      reading({
        journeys: [{ id: 'j', state: 'auto' }],
        themes: [{ slug: 'distance', weight: 0.8 }],
        horizon: { start: '2026-05-01', end: '2026-05-31', text: 'this month' },
      }),
      event({
        journeys: [{ id: 'j', state: 'auto' }],
        themes: [{ slug: 'distance', weight: 0.8 }],
      }),
    );
    expect(strong.score - first.score).toBeGreaterThanOrEqual(RESUGGEST_DELTA);
    expect(shouldResurface(rejected, strong)).toEqual({
      resurface: true,
      reason: 'stronger_new_evidence',
    });
    // The user linking the mention by hand is a confirmed overlap that did not exist before.
    const confirmed = scorePair(
      reading(),
      event({ entities: [{ id: 'maya', resolution: 'user' }] }),
    );
    expect(confirmed.evidence.confirmedEntityIds).toEqual(['maya']);
    expect(shouldResurface(rejected, confirmed)).toEqual({
      resurface: true,
      reason: 'confirmed_overlap',
    });
    // …but not a second time.
    expect(
      shouldResurface(
        { ...rejected, confirmedEntityIds: ['maya'], rejectedFingerprint: confirmed.fingerprint },
        confirmed,
      ).resurface,
    ).toBe(false);
  });

  it('3 · the runtime records the rejection point, consults the rule, and never deletes a rejected row', () => {
    const queries = readFileSync(path.resolve('src/db/queries/events.ts'), 'utf8');
    expect(queries).toMatch(/patch\.rejected_score = Number\(prior\.score\);/);
    expect(queries).toMatch(/patch\.rejected_fingerprint = prior\.evidence_fingerprint;/);
    const run = readFileSync(path.resolve('src/correlation/run.ts'), 'utf8');
    expect(run).toMatch(/shouldResurface\(/);
    expect(run).not.toMatch(/\.delete\(links\)/);
    // A rejected row that is not resurfaced is left exactly as it was.
    expect(run).toMatch(/if \(!verdict\.resurface \|\| !wantOffer \|\| slots <= 0\) continue;/);
    const schema = readFileSync(path.resolve('src/db/schema/events.ts'), 'utf8');
    expect(schema).toMatch(/rejectedFingerprint: text\('rejected_fingerprint'\)/);
    expect(schema).toMatch(/index\('links_fingerprint_idx'\)\.on\(t\.evidenceFingerprint\)/);
  });
});
