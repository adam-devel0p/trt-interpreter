import { describe, expect, it } from 'vitest';
import { INSIGHT_PRIORITY, pickInsight, pickOnThisDay, pickUnresolvedReview } from '../retention';
import { UNRESOLVED_REVIEW_MIN } from '../thresholds';

describe('on this day (§15.2, §4.7)', () => {
  const readings = [
    { id: 'y1', occurredAt: '2025-09-14T10:00:00Z' },
    { id: 'y2', occurredAt: '2024-09-14T18:00:00Z' },
    { id: 'd30', occurredAt: '2026-08-15T09:00:00Z' },
    { id: 'd29', occurredAt: '2026-08-16T09:00:00Z' },
    { id: 'today', occurredAt: '2026-09-14T08:00:00Z' },
  ];
  it('prefers the oldest anniversary, then exactly 30 days ago, else nothing', () => {
    expect(pickOnThisDay(readings, '2026-09-14')).toMatchObject({ readingId: 'y2', yearsAgo: 2 });
    expect(
      pickOnThisDay(
        readings.filter((r) => !r.id.startsWith('y')),
        '2026-09-14',
      ),
    ).toMatchObject({ readingId: 'd30', yearsAgo: 0 });
    // Three weeks ago is not "on this day"; today's own reading is not an anniversary.
    expect(pickOnThisDay([readings[3]!, readings[4]!], '2026-09-14')).toBeNull();
  });
  it('the fingerprint is per reading and per day, so a dismissal is remembered for that day', () => {
    const a = pickOnThisDay(readings, '2026-09-14')!;
    const b = pickOnThisDay(readings, '2026-09-14')!;
    const c = pickOnThisDay(readings, '2027-09-14')!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(c.readingId).toBe('y2');
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });
});

describe('unresolved question review', () => {
  const r = (id: string, day: string, entities: string[] = [], themes: string[] = []) => ({
    id,
    occurredAt: `2026-08-${day}T12:00:00Z`,
    entities: entities.map((e) => ({ id: e.toLowerCase(), label: e })),
    themes: themes.map((t) => ({ slug: t, label: t[0]!.toUpperCase() + t.slice(1) })),
  });
  it('needs three unresolved readings about one subject; a named subject beats a theme', () => {
    expect(UNRESOLVED_REVIEW_MIN).toBe(3);
    expect(pickUnresolvedReview([r('a', '01', ['Sam']), r('b', '05', ['Sam'])])).toBeNull();
    const review = pickUnresolvedReview([
      r('a', '01', ['Sam'], ['work']),
      r('b', '05', ['Sam'], ['work']),
      r('c', '09', ['Sam'], ['work']),
      r('d', '10', [], ['work']),
    ]);
    expect(review).toMatchObject({
      key: 'entity:sam',
      subject: 'Sam',
      readingIds: ['a', 'b', 'c'],
    });
    // Only the strongest theme files a reading, so a broad secondary theme does not group.
    const byTheme = pickUnresolvedReview([
      r('a', '01', [], ['work', 'money']),
      r('b', '02', [], ['money', 'work']),
      r('c', '03', [], ['work']),
    ]);
    expect(byTheme).toBeNull();
  });
  it('the fingerprint covers the member set: a fourth reading makes it new, otherwise it stays dismissed', () => {
    const three = [r('a', '01', ['Sam']), r('b', '05', ['Sam']), r('c', '09', ['Sam'])];
    const x = pickUnresolvedReview(three)!;
    const y = pickUnresolvedReview([...three].reverse())!;
    expect(x.fingerprint).toBe(y.fingerprint);
    const z = pickUnresolvedReview([...three, r('d', '12', ['Sam'])])!;
    expect(z.fingerprint).not.toBe(x.fingerprint);
  });
});

describe('the Home slot picks one thing (§5)', () => {
  const c = (kind: (typeof INSIGHT_PRIORITY)[number], fingerprint: string) => ({
    kind,
    fingerprint,
    payload: null,
  });
  const all = {
    journey_shift: true,
    retrospective: true,
    unresolved_review: true,
    on_this_day: true,
  };
  it('by priority, skipping dismissed fingerprints and switched-off surfaces; nothing when all are gone', () => {
    const candidates = [
      c('on_this_day', 'd'),
      c('unresolved_review', 'u'),
      c('journey_shift', 's'),
      c('retrospective', 'r'),
    ];
    expect(pickInsight(candidates, { enabled: all, dismissed: new Set() })?.kind).toBe(
      'journey_shift',
    );
    expect(pickInsight(candidates, { enabled: all, dismissed: new Set(['s']) })?.kind).toBe(
      'retrospective',
    );
    expect(
      pickInsight(candidates, {
        enabled: { ...all, journey_shift: false, retrospective: false },
        dismissed: new Set(),
      })?.kind,
    ).toBe('unresolved_review');
    expect(
      pickInsight(candidates, { enabled: all, dismissed: new Set(['s', 'r', 'u', 'd']) }),
    ).toBeNull();
    expect(
      pickInsight(candidates, {
        enabled: {
          journey_shift: false,
          retrospective: false,
          unresolved_review: false,
          on_this_day: false,
        },
        dismissed: new Set(),
      }),
    ).toBeNull();
  });
});
