import { describe, expect, it } from 'vitest';
import { decideNarrative, narrativeFingerprint } from '../narrativeChange';
import type { ProgressionStep } from '../progression';
import { detectShift, shiftSentence } from '../shift';

const step = (
  i: number,
  slug: string,
  start: string,
  end: string,
  sources: string[],
): ProgressionStep => ({
  sequenceIndex: i,
  slug,
  label: slug[0]!.toUpperCase() + slug.slice(1),
  periodStart: start,
  periodEnd: end,
  sourceObjectIds: sources,
});
const now = '2026-09-14T12:00:00Z';

describe('journey change detection (§15.2)', () => {
  it('fires when the newest step differs from the one before, once per shift, never for an old one', () => {
    const steps = [
      step(0, 'hesitation', '2026-06-01', '2026-06-30', ['a', 'b']),
      step(1, 'action', '2026-08-01', '2026-08-31', ['c', 'd', 'e']),
    ];
    const shift = detectShift('j1', steps, now)!;
    expect(shift).toMatchObject({
      from: { slug: 'hesitation' },
      to: { slug: 'action' },
      sourceObjectIds: ['c', 'd', 'e'],
    });
    expect(shiftSentence(shift, 'The move')).toBe(
      'Your last 3 entries in “The move” moved from hesitation toward action.',
    );
    // Same progression again → same fingerprint (the caller's memory shows it once).
    expect(detectShift('j1', steps, now)!.fingerprint).toBe(shift.fingerprint);
    // A further step with a new theme is a new shift.
    const more = [...steps, step(2, 'stability', '2026-09-01', '2026-09-14', ['f', 'g'])];
    expect(detectShift('j1', more, now)!.fingerprint).not.toBe(shift.fingerprint);
    // No change → nothing; one step → nothing; a shift older than 45 days → nothing.
    expect(
      detectShift(
        'j1',
        [steps[0]!, step(1, 'hesitation', '2026-08-01', '2026-08-31', ['c', 'd'])],
        now,
      ),
    ).toBeNull();
    expect(detectShift('j1', [steps[1]!], now)).toBeNull();
    expect(detectShift('j1', steps, '2026-12-01T00:00:00Z')).toBeNull();
  });
});

describe('narrative regeneration (§6.5, §19)', () => {
  it('regenerates on a member or outcome change or after 14 days, never otherwise', () => {
    const fp = narrativeFingerprint({ memberIds: ['b', 'a', 'a'], confirmedOutcomes: 1 });
    expect(narrativeFingerprint({ memberIds: ['a', 'b'], confirmedOutcomes: 1 })).toBe(fp);
    expect(narrativeFingerprint({ memberIds: ['a', 'b', 'c'], confirmedOutcomes: 1 })).not.toBe(fp);
    expect(narrativeFingerprint({ memberIds: ['a', 'b'], confirmedOutcomes: 2 })).not.toBe(fp);
    expect(decideNarrative(null, fp, now)).toEqual({ regenerate: true, reason: 'none' });
    expect(
      decideNarrative({ fingerprint: fp, generatedAt: '2026-09-10T00:00:00Z' }, fp, now),
    ).toEqual({ regenerate: false, reason: 'unchanged' });
    expect(
      decideNarrative({ fingerprint: 'other', generatedAt: '2026-09-10T00:00:00Z' }, fp, now),
    ).toEqual({ regenerate: true, reason: 'changed' });
    expect(
      decideNarrative({ fingerprint: fp, generatedAt: '2026-08-30T00:00:00Z' }, fp, now),
    ).toEqual({ regenerate: true, reason: 'aged' });
  });
});
