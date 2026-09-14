import { describe, expect, it } from 'vitest';
import { shouldResurface } from '../resurface';
import {
  bandFor,
  daysApartPhrase,
  fingerprintOf,
  filterEvidence,
  scorePair,
  selectSuggestions,
  temporalProximity,
  timeframeFit,
  type CorrelationObject,
} from '../score';
import {
  LIKELY,
  LIKELY_TEMPORAL_MIN,
  MAX_SUGGESTIONS,
  NON_CARD_SIGNAL_FLOOR,
  POSSIBLE,
  PROXIMITY_TAU_DAYS,
  RESUGGEST_DELTA,
  STORE_MIN,
  TENTATIVE_WEIGHT,
  TIMEFRAME_GRACE_MIN_DAYS,
  WEIGHTS,
} from '../thresholds';
import { loadLabeledPairs, scoreLabels, toObject } from './fixtures';

/**
 * The correlation engine (docs/ALGORITHMS.md §3) at its boundaries: every signal on its own,
 * renormalisation of unavailable signals, the four guards, the display bands, the
 * fingerprint's stability, the §19 re-suggestion rule, and the hand-labelled fixture set
 * (precision is the number that matters — a wrong confident connection is a phase failure).
 */
const day = (d: string) => `${d}T12:00:00.000Z`;
const obj = (over: Partial<CorrelationObject> & { id: string; type: CorrelationObject['type'] }) =>
  ({
    occurredAt: day('2026-05-01'),
    entities: [],
    themes: [],
    journeys: [],
    ...over,
  }) as CorrelationObject;
const reading = (over: Partial<CorrelationObject> = {}) =>
  obj({ id: 'r', type: 'reading', cards: ['c1', 'c2', 'c3'], horizon: null, ...over });
const event = (over: Partial<CorrelationObject> = {}) =>
  obj({ id: 'e', type: 'life_event', occurredAt: day('2026-05-11'), ...over });

describe('correlation weights', () => {
  it('are the documented numbers (they sum to 1.05 as written) and are normalised over the available set', () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(total * 1000)).toBe(1050);
    // Every signal at 1 scores exactly 1 whatever subset is available.
    const full = scorePair(
      reading({
        id: 'r1',
        entities: [{ id: 'x', resolution: 'auto' }],
        themes: [{ slug: 't', weight: 1 }],
        journeys: [{ id: 'j', state: 'auto' }],
        cards: ['c'],
        horizon: { start: '2026-05-01', end: '2026-05-02', text: null },
      }),
      reading({
        id: 'r2',
        entities: [{ id: 'x', resolution: 'auto' }],
        themes: [{ slug: 't', weight: 1 }],
        journeys: [{ id: 'j', state: 'auto' }],
        cards: ['c'],
        horizon: null,
      }),
    );
    expect(full.score).toBe(1);
    const c = scorePair(reading(), event());
    expect(c.available).not.toContain('semantic_similarity');
    expect(c.available).not.toContain('card_symbol_overlap'); // an event has no cards
    expect(c.available).not.toContain('journey_overlap'); // neither side is in a journey
    expect(c.available).not.toContain('timeframe_fit'); // no horizon stated
    expect(c.available).toEqual(['entity_overlap', 'theme_overlap', 'temporal_proximity']);
  });
});

describe('signals', () => {
  it('entity overlap: shared over the smaller side, tentative at half weight, resolved only', () => {
    const a = reading({
      entities: [
        { id: 'maya', resolution: 'auto' },
        { id: 'leeds', resolution: 'user' },
      ],
    });
    expect(
      scorePair(a, event({ entities: [{ id: 'maya', resolution: 'auto' }] })).signals
        .entity_overlap,
    ).toBe(1);
    expect(
      scorePair(a, event({ entities: [{ id: 'maya', resolution: 'tentative' }] })).signals
        .entity_overlap,
    ).toBe(TENTATIVE_WEIGHT);
    expect(
      scorePair(a, event({ entities: [{ id: 'sam', resolution: 'auto' }] })).signals.entity_overlap,
    ).toBe(0);
    expect(scorePair(a, event()).signals.entity_overlap).toBe(0);
  });

  it('entity overlap: a tentatively shared second entity adds, never subtracts', () => {
    const r = reading({
      entities: [
        { id: 'maya', resolution: 'auto' },
        { id: 'leeds', resolution: 'auto' },
      ],
    });
    const one = scorePair(r, event({ entities: [{ id: 'maya', resolution: 'auto' }] }));
    const two = scorePair(
      r,
      event({
        entities: [
          { id: 'maya', resolution: 'auto' },
          { id: 'leeds', resolution: 'tentative' },
        ],
      }),
    );
    expect(two.signals.entity_overlap).toBeGreaterThanOrEqual(one.signals.entity_overlap);
    expect(two.score).toBeGreaterThanOrEqual(one.score);
  });

  it('theme overlap is a weighted Jaccard', () => {
    const c = scorePair(
      reading({
        themes: [
          { slug: 'decision', weight: 0.8 },
          { slug: 'ambition', weight: 0.6 },
        ],
      }),
      event({
        themes: [
          { slug: 'decision', weight: 0.6 },
          { slug: 'change', weight: 0.4 },
        ],
      }),
    );
    // min: 0.6 · max: 0.8 + 0.6 + 0.4 = 1.8
    expect(c.signals.theme_overlap).toBeCloseTo(0.6 / 1.8, 3);
  });

  it('journey overlap: unavailable when either side is in no journey, else the overlap coefficient', () => {
    const inJ = { journeys: [{ id: 'j1', state: 'auto' as const }] };
    expect(scorePair(reading(inJ), event()).available).not.toContain('journey_overlap');
    const same = scorePair(reading(inJ), event(inJ));
    expect(same.available).toContain('journey_overlap');
    expect(same.signals.journey_overlap).toBe(1);
    const other = scorePair(reading(inJ), event({ journeys: [{ id: 'j2', state: 'auto' }] }));
    expect(other.signals.journey_overlap).toBe(0);
  });

  it('temporal proximity decays as exp(−days/τ)', () => {
    expect(temporalProximity(0)).toBe(1);
    expect(temporalProximity(PROXIMITY_TAU_DAYS)).toBeCloseTo(Math.E ** -1, 6);
    const c = scorePair(reading(), event({ occurredAt: day('2026-05-01') }));
    expect(c.signals.temporal_proximity).toBe(1);
    expect(c.evidence.daysApart).toBe(0);
  });

  it('timeframe fit: 1 inside, linear decay over a grace as long as the horizon (≥ 14 days), then 0', () => {
    const horizon = { start: '2026-05-01', end: '2026-05-31', text: 'this month' };
    expect(timeframeFit(horizon, day('2026-05-01'))).toEqual({ value: 1, relation: 'inside' });
    expect(timeframeFit(horizon, day('2026-05-31'))).toEqual({ value: 1, relation: 'inside' });
    // 30-day horizon → 30-day grace: 15 days past the end is half way.
    expect(timeframeFit(horizon, day('2026-06-15'))).toEqual({ value: 0.5, relation: 'near' });
    expect(timeframeFit(horizon, day('2026-06-30'))).toEqual({ value: 0, relation: 'outside' });
    expect(timeframeFit(horizon, day('2026-04-16'))).toEqual({ value: 0.5, relation: 'near' });
    // A one-week horizon still gets the minimum grace.
    const week = { start: '2026-03-01', end: '2026-03-07', text: 'this week' };
    const grace = TIMEFRAME_GRACE_MIN_DAYS;
    expect(timeframeFit(week, day('2026-03-14'))!.value).toBeCloseTo(1 - 7 / grace, 3);
    expect(timeframeFit(null, day('2026-03-14'))).toBeNull();
    // The horizon belongs to the reading side, whichever order the pair comes in.
    const r = reading({ horizon });
    const e = event({ occurredAt: day('2026-05-14') });
    expect(scorePair(r, e).signals.timeframe_fit).toBe(1);
    expect(scorePair(e, r).signals.timeframe_fit).toBe(1);
  });

  it('card overlap is available only between two readings and is a Jaccard of deck-native ids', () => {
    const r1 = reading({ id: 'r1', cards: ['rws:tower', 'rws:star'] });
    const r2 = reading({
      id: 'r2',
      cards: ['rws:tower', 'thoth:lust'],
      occurredAt: day('2026-05-05'),
    });
    const c = scorePair(r1, r2);
    expect(c.available).toContain('card_symbol_overlap');
    expect(c.signals.card_symbol_overlap).toBeCloseTo(1 / 3, 3);
    expect(c.evidence.sharedCardKeys).toEqual(['rws:tower']);
  });
});

describe('guards', () => {
  it('1 · card overlap alone never makes a pair eligible, whatever the score', () => {
    const r1 = reading({ id: 'r1', cards: ['tower', 'star', 'moon'] });
    const r2 = reading({
      id: 'r2',
      cards: ['tower', 'star', 'moon'],
      occurredAt: day('2026-09-01'),
    });
    const c = scorePair(r1, r2);
    expect(c.signals.card_symbol_overlap).toBe(1);
    expect(c.eligible).toBe(false);
    expect(c.guardFailures).toContain('card_overlap_alone');
    // Even the same day (proximity 1): one non-card signal is not two.
    const sameDay = scorePair(r1, reading({ id: 'r3', cards: ['tower', 'star', 'moon'] }));
    expect(sameDay.signals.temporal_proximity).toBe(1);
    expect(sameDay.eligible).toBe(false);
    expect(sameDay.guardFailures).toContain('card_overlap_alone');
  });

  it(`1 · two non-card signals above ${NON_CARD_SIGNAL_FLOOR} are required`, () => {
    const c = scorePair(
      reading({ entities: [{ id: 'maya', resolution: 'auto' }] }),
      event({ entities: [{ id: 'maya', resolution: 'auto' }], occurredAt: day('2026-11-01') }),
    );
    expect(c.signals.entity_overlap).toBe(1);
    expect(c.signals.temporal_proximity).toBeLessThan(NON_CARD_SIGNAL_FLOOR);
    expect(c.eligible).toBe(false);
  });

  it('1 · one of the two signals must be temporal: a shared journey and employer months apart is not a connection', () => {
    const c = scorePair(
      reading({
        entities: [{ id: 'agency', resolution: 'auto' }],
        themes: [{ slug: 'ambition', weight: 0.8 }],
        journeys: [{ id: 'career', state: 'auto' }],
      }),
      event({
        entities: [{ id: 'agency', resolution: 'auto' }],
        themes: [{ slug: 'ambition', weight: 0.8 }],
        journeys: [{ id: 'career', state: 'auto' }],
        occurredAt: day('2026-09-01'),
      }),
    );
    expect(c.score).toBeGreaterThan(LIKELY); // the raw score would read "likely"
    expect(c.eligible).toBe(false);
    expect(c.guardFailures).toEqual(['no_temporal_anchor']);
    // Inside the stated window, the same pair is anchored and eligible.
    const anchored = scorePair(
      reading({
        entities: [{ id: 'agency', resolution: 'auto' }],
        journeys: [{ id: 'career', state: 'auto' }],
        horizon: { start: '2026-05-01', end: '2026-09-30', text: 'by the autumn' },
      }),
      event({
        entities: [{ id: 'agency', resolution: 'auto' }],
        journeys: [{ id: 'career', state: 'auto' }],
        occurredAt: day('2026-09-01'),
      }),
    );
    expect(anchored.eligible).toBe(true);
  });

  it('2 · evidence from an interpretation or a summary is dropped before scoring', () => {
    const r = reading({
      entities: [{ id: 'agency', resolution: 'auto', provenance: 'interpretation' }],
      themes: [{ slug: 'decision', weight: 0.9, provenance: 'period_summary' }],
    });
    expect(filterEvidence(r).entities).toEqual([]);
    expect(filterEvidence(r).themes).toEqual([]);
    const c = scorePair(
      r,
      event({
        entities: [{ id: 'agency', resolution: 'auto' }],
        themes: [{ slug: 'decision', weight: 0.9 }],
      }),
    );
    expect(c.signals.entity_overlap).toBe(0);
    expect(c.signals.theme_overlap).toBe(0);
    expect(c.eligible).toBe(false);
    // Mixed provenance scores exactly like the user-text-only bundle.
    const userOnly = reading({ entities: [{ id: 'agency', resolution: 'auto' }] });
    const mixed = reading({
      entities: [
        { id: 'agency', resolution: 'auto' },
        { id: 'sam', resolution: 'auto', provenance: 'interpretation' },
      ],
      themes: [{ slug: 'change', weight: 0.5, provenance: 'interpretation' }],
    });
    const e = event({
      entities: [
        { id: 'agency', resolution: 'auto' },
        { id: 'sam', resolution: 'auto' },
      ],
    });
    expect(scorePair(mixed, e).score).toBe(scorePair(userOnly, e).score);
  });

  it('3 · zero candidates is a valid result', () => {
    expect(selectSuggestions([])).toEqual({ store: [], offer: [] });
  });

  it(`4 · at most ${MAX_SUGGESTIONS} are offered, strongest first; hidden-band rows are stored only`, () => {
    const mk = (id: string, score: number, eligible = true) => ({
      candidate: id,
      correlation: { ...scorePair(reading(), event()), score, eligible, guardFailures: [] },
    });
    const { store, offer } = selectSuggestions([
      mk('a', 0.9),
      mk('b', 0.6),
      mk('c', 0.8),
      mk('d', 0.7),
      mk('e', 0.45),
      mk('f', 0.95, false),
    ]);
    expect(store.map((s) => s.candidate)).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(offer.map((s) => s.candidate)).toEqual(['a', 'c', 'd']);
  });
});

describe('display bands', () => {
  it('map the documented thresholds', () => {
    expect(bandFor(POSSIBLE - 0.001)).toBe('hidden');
    expect(bandFor(POSSIBLE)).toBe('possible');
    expect(bandFor(LIKELY - 0.001)).toBe('possible');
    expect(bandFor(LIKELY)).toBe('likely');
    expect(STORE_MIN).toBeLessThan(POSSIBLE);
  });

  it('"likely" also needs a strong temporal signal; a shared journey and person weeks apart reads as "possible"', () => {
    const far = { timeframe_fit: 0, temporal_proximity: LIKELY_TEMPORAL_MIN - 0.01 };
    const near = { timeframe_fit: 0, temporal_proximity: LIKELY_TEMPORAL_MIN };
    const inWindow = { timeframe_fit: 1, temporal_proximity: 0.05 };
    expect(bandFor(0.9, far)).toBe('possible');
    expect(bandFor(0.9, near)).toBe('likely');
    expect(bandFor(0.9, inWindow)).toBe('likely');
    expect(bandFor(0.6, inWindow)).toBe('possible');
    expect(bandFor(0.5, inWindow)).toBe('hidden');
    // The demo case: the Maya conversation and a Maya reading seven weeks later.
    const c = scorePair(
      reading({
        entities: [{ id: 'maya', resolution: 'auto' }],
        themes: [{ slug: 'communication', weight: 0.7 }],
        journeys: [{ id: 'maya', state: 'confirmed' }],
        occurredAt: day('2026-06-06'),
      }),
      event({
        entities: [{ id: 'maya', resolution: 'auto' }],
        themes: [{ slug: 'communication', weight: 0.7 }],
        journeys: [{ id: 'maya', state: 'auto' }],
        occurredAt: day('2026-04-17'),
      }),
    );
    expect(c.score).toBeGreaterThanOrEqual(LIKELY);
    expect(c.eligible).toBe(true);
    expect(bandFor(c.score, c.signals)).toBe('possible');
  });
});

describe('reasons and fingerprint', () => {
  it('reasons are sentences without numbers and name the shared evidence', () => {
    const c = scorePair(
      reading({
        entities: [{ id: 'agency', resolution: 'auto' }],
        themes: [{ slug: 'decision', weight: 0.8 }],
        journeys: [{ id: 'j', state: 'auto' }],
        horizon: { start: '2026-05-01', end: '2026-05-31', text: 'next month' },
      }),
      event({
        entities: [{ id: 'agency', resolution: 'auto' }],
        themes: [{ slug: 'decision', weight: 0.6 }],
        journeys: [{ id: 'j', state: 'confirmed' }],
      }),
      {
        entityLabels: new Map([['agency', 'the agency']]),
        themeLabels: new Map([['decision', 'Decision']]),
        journeyTitles: new Map([['j', 'The agency and ambition']]),
      },
    );
    expect(c.reasons).toEqual([
      'Both are part of “The agency and ambition”',
      'Both mention the agency',
      'Related themes: Decision',
      'The reading’s “next month” window covers this date',
      'About a week apart',
    ]);
    for (const r of c.reasons) expect(r).not.toMatch(/\d/);
    expect(c.evidence.confirmedJourneyIds).toEqual(['j']);
    expect(c.evidence.confirmedEntityIds).toEqual([]);
  });

  it('phrases days apart in words', () => {
    expect(daysApartPhrase(0)).toBe('The same day');
    expect(daysApartPhrase(1)).toBe('A day apart');
    expect(daysApartPhrase(3)).toBe('Three days apart');
    expect(daysApartPhrase(10)).toBe('About a week apart');
    expect(daysApartPhrase(21)).toBe('About three weeks apart');
    expect(daysApartPhrase(31)).toBe('About a month apart');
    expect(daysApartPhrase(95)).toBe('About three months apart');
    expect(daysApartPhrase(400)).toBe('About a year apart');
  });

  it('the fingerprint is stable across a day of drift and changes with the evidence', () => {
    const base = scorePair(
      reading({ entities: [{ id: 'maya', resolution: 'auto' }] }),
      event({ entities: [{ id: 'maya', resolution: 'auto' }] }),
    );
    const drifted = scorePair(
      reading({ entities: [{ id: 'maya', resolution: 'auto' }] }),
      event({ entities: [{ id: 'maya', resolution: 'auto' }], occurredAt: day('2026-05-12') }),
    );
    expect(drifted.fingerprint).toBe(base.fingerprint);
    const more = scorePair(
      reading({
        entities: [{ id: 'maya', resolution: 'auto' }],
        themes: [{ slug: 'distance', weight: 0.8 }],
      }),
      event({
        entities: [{ id: 'maya', resolution: 'auto' }],
        themes: [{ slug: 'distance', weight: 0.8 }],
      }),
    );
    expect(more.fingerprint).not.toBe(base.fingerprint);
    expect(fingerprintOf(base.evidence)).toBe(base.fingerprint);
  });
});

describe('re-suggestion after a rejection (§19)', () => {
  const rejected = (over: Partial<Parameters<typeof shouldResurface>[0]> = {}) => ({
    state: 'rejected' as const,
    rejectedScore: 0.6,
    rejectedFingerprint: 'abc',
    confirmedEntityIds: [],
    confirmedJourneyIds: [],
    ...over,
  });
  const next = (score: number, fingerprint: string, confirmed: string[] = []) => ({
    ...scorePair(reading(), event()),
    score,
    fingerprint,
    evidence: { ...scorePair(reading(), event()).evidence, confirmedEntityIds: confirmed },
  });

  it('the same evidence never comes back, whatever the score', () => {
    expect(shouldResurface(rejected(), next(0.95, 'abc'))).toEqual({
      resurface: false,
      reason: 'same_evidence',
    });
  });
  it(`new evidence needs +${RESUGGEST_DELTA}`, () => {
    expect(shouldResurface(rejected(), next(0.6 + RESUGGEST_DELTA - 0.001, 'xyz')).resurface).toBe(
      false,
    );
    expect(shouldResurface(rejected(), next(0.6 + RESUGGEST_DELTA, 'xyz'))).toEqual({
      resurface: true,
      reason: 'stronger_new_evidence',
    });
  });
  it('a newly user-confirmed overlap brings it back on its own', () => {
    expect(shouldResurface(rejected(), next(0.6, 'abc', ['maya']))).toEqual({
      resurface: true,
      reason: 'confirmed_overlap',
    });
    expect(
      shouldResurface(rejected({ confirmedEntityIds: ['maya'] }), next(0.6, 'abc', ['maya']))
        .resurface,
    ).toBe(false);
  });
  it('only rejected links are subject to the rule', () => {
    expect(shouldResurface(rejected({ state: 'maybe' }), next(0.9, 'zzz')).reason).toBe(
      'not_rejected',
    );
  });
});

describe('labelled pairs (fixtures/history/correlation)', () => {
  const pairs = loadLabeledPairs();
  const results = pairs.map((p) => {
    const c = scorePair(
      toObject(`r-${p.id}`, 'reading', p.reading),
      toObject(`e-${p.id}`, 'life_event', p.event),
    );
    return {
      id: p.id,
      related: p.related,
      shown: c.eligible && bandFor(c.score, c.signals) !== 'hidden',
      c,
    };
  });

  it('never shows a pair a person labelled unrelated (precision 1.0 on the set)', () => {
    const { precision, recall, wrongShown, missed } = scoreLabels(results);
    expect(wrongShown).toEqual([]);
    expect(precision).toBe(1);
    // Recall is allowed to be imperfect; the miss must be the theme-only pair, which cannot
    // reach the band without semantic similarity (Phase 09) — missing-but-quiet.
    expect(missed).toEqual(['health-theme-only-close']);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('the canonical loop is a likely connection with the expected reasons', () => {
    const r = results.find((x) => x.id === 'job-offer-accepted')!;
    expect(bandFor(r.c.score, r.c.signals)).toBe('likely');
    expect(r.c.reasons).toContain('The reading’s “next month” window covers this date');
  });
});
