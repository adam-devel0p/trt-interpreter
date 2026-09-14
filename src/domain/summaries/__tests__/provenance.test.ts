import { describe, expect, it } from 'vitest';
import {
  summaryCitedLabels,
  validateSources,
  verifyNarrative,
  verifySummary,
  type LabelFacts,
} from '../provenance';
import type { PeriodSummary } from '../schema';

const labels = new Map<string, LabelFacts>([
  ['E1', { confirmed: false }], // a reading with nothing recorded
  ['E2', { confirmed: true }], // a life event
  ['E3', { confirmed: true }], // a reading with an outcome
]);

const claim = (
  text: string,
  basis: PeriodSummary['recurred'][number]['basis'],
  citations: string[],
) => ({
  text,
  basis,
  citations,
});

const base = (): PeriodSummary => ({
  headline: 'August: three readings, one thing that happened.',
  recurred: [],
  shifted: [],
  open: [],
  confirmed: [],
});

describe('validateSources (§19)', () => {
  it('rejects the empty set and a set made only of summaries or interpretations', () => {
    expect(validateSources([])).toEqual({ ok: false, reason: 'empty' });
    expect(validateSources([{ type: 'period_summary', id: 'a' }])).toEqual({
      ok: false,
      reason: 'generated_only',
    });
    expect(
      validateSources([
        { type: 'period_summary', id: 'a' },
        { type: 'interpretation', id: 'b' },
      ]),
    ).toEqual({ ok: false, reason: 'generated_only' });
    expect(validateSources([{ type: 'reading', id: '' }])).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
  it('accepts a set with at least one entry of the user’s own, deduplicated', () => {
    const v = validateSources([
      { type: 'period_summary', id: 'a' },
      { type: 'reading', id: 'r' },
      { type: 'reading', id: 'r' },
      { type: 'life_event', id: 'e' },
    ]);
    expect(v).toEqual({
      ok: true,
      sources: [
        { type: 'period_summary', id: 'a' },
        { type: 'reading', id: 'r' },
        { type: 'life_event', id: 'e' },
      ],
    });
  });
});

describe('verifySummary', () => {
  it('strips unknown labels and drops a claim left without evidence', () => {
    const out = verifySummary(
      {
        ...base(),
        recurred: [
          claim('The Tower kept coming back.', 'tarot_interpretation', ['E1', 'E9', 'E1']),
        ],
        open: [claim('Still open.', 'user_reflection', ['E7'])],
      },
      labels,
    );
    expect(out.summary.recurred).toEqual([
      claim('The Tower kept coming back.', 'tarot_interpretation', ['E1']),
    ]);
    expect(out.summary.open).toEqual([]);
    expect(out.stripped).toEqual(['E9', 'E7']);
    expect(out.dropped).toEqual([{ section: 'open', reason: 'uncited' }]);
    expect(out.grounded).toBe(true);
    expect(out.issues).toContain('unknown citations');
  });

  it('refuses a "confirmed fact" that cites no confirmed evidence — generated text never makes a fact (§21.7)', () => {
    const out = verifySummary(
      {
        ...base(),
        confirmed: [
          claim('You got the job.', 'confirmed_fact', ['E1']),
          claim('You logged the move on 3 August.', 'confirmed_fact', ['E2']),
        ],
      },
      labels,
    );
    expect(out.summary.confirmed).toEqual([
      claim('You logged the move on 3 August.', 'confirmed_fact', ['E2']),
    ]);
    expect(out.dropped).toEqual([{ section: 'confirmed', reason: 'unsupported_fact' }]);
    expect(out.grounded).toBe(true);
    // The same sentence as an interpretation with the same citation is fine: it is not stated as a fact.
    const ok = verifySummary(
      {
        ...base(),
        shifted: [
          claim('One way to read it: a job may be coming.', 'tarot_interpretation', ['E1']),
        ],
      },
      labels,
    );
    expect(ok.summary.shifted).toHaveLength(1);
  });

  it('drops claims in the wrong register and is ungrounded when nothing survives or the headline predicts', () => {
    const out = verifySummary(
      { ...base(), open: [claim('You will definitely get the flat.', 'inferred', ['E1'])] },
      labels,
    );
    expect(out.summary.open).toEqual([]);
    expect(out.dropped).toEqual([{ section: 'open', reason: 'register' }]);
    expect(out.grounded).toBe(false);
    expect(out.issues).toContain('no cited claim');
    const head = verifySummary(
      {
        ...base(),
        headline: 'This month is 90% resolved.',
        recurred: [claim('Cups recurred.', 'tarot_interpretation', ['E1'])],
      },
      labels,
    );
    expect(head.grounded).toBe(false);
    expect(head.issues.some((i) => i.startsWith('register'))).toBe(true);
  });

  it('cited labels come back in order of first appearance', () => {
    const out = verifySummary(
      {
        ...base(),
        recurred: [claim('a', 'inferred', ['E3', 'E1'])],
        confirmed: [claim('b', 'confirmed_fact', ['E2', 'E3'])],
      },
      labels,
    );
    expect(summaryCitedLabels(out.summary)).toEqual(['E3', 'E1', 'E2']);
  });
});

describe('verifyNarrative', () => {
  it('needs one real citation and a hedged sentence', () => {
    const set = new Set(['E1', 'E2']);
    expect(
      verifyNarrative(
        {
          sentence: 'Your readings seem to have moved from hesitation to action.',
          progression: ['Hesitation', 'action'],
          citations: ['E1', 'E5'],
        },
        set,
      ),
    ).toMatchObject({
      grounded: true,
      stripped: ['E5'],
      narrative: { progression: ['hesitation', 'action'], citations: ['E1'] },
    });
    expect(
      verifyNarrative(
        { sentence: 'It will definitely work out.', progression: [], citations: ['E1'] },
        set,
      ).grounded,
    ).toBe(false);
    expect(
      verifyNarrative({ sentence: 'Fine.', progression: [], citations: ['E9'] }, set),
    ).toMatchObject({ grounded: false, issues: ['unknown citation', 'uncited sentence'] });
  });
});
