import { describe, expect, it } from 'vitest';
import { narrativeHeader } from '../narrative';
import { chooseBucketing, themeProgression } from '../progression';
import { occurrencesSentence, patterns, recurringSymbols, type SymbolObject } from '../symbols';
import { buildTimeline, isOpenLoop, type TimelineEntry } from '../timeline';

/**
 * The derived sections of a journey (spec §6.5, FR-17, §3.3): progression collapses
 * consecutive duplicates and drops steps under two supporting objects; symbols recur by
 * deck-native identity with context and sources; the header is honest counts; the timeline
 * interleaves kinds by date.
 */
const DAY = 86_400_000;
const T0 = Date.parse('2026-03-02T12:00:00Z'); // a Monday
const at = (day: number) => new Date(T0 + day * DAY).toISOString();
const th = (slug: string, weight = 0.7) => ({
  slug,
  label: slug[0]!.toUpperCase() + slug.slice(1),
  weight,
});

describe('theme progression', () => {
  it('buckets by month when sparse, by week when dense', () => {
    const sparse = [0, 30, 60, 90].map((d, i) => ({
      id: `s${i}`,
      occurredAt: at(d),
      themes: [th('trust')],
    }));
    expect(chooseBucketing(sparse)).toBe('month');
    const dense = [0, 2, 4, 6, 8, 10].map((d, i) => ({
      id: `d${i}`,
      occurredAt: at(d),
      themes: [th('trust')],
    }));
    expect(chooseBucketing(dense)).toBe('week');
  });

  it('collapses consecutive duplicates across buckets and keeps every source id', () => {
    const objects = [
      { id: 'a', occurredAt: at(0), themes: [th('uncertainty', 0.9)] },
      { id: 'b', occurredAt: at(3), themes: [th('uncertainty', 0.8)] },
      { id: 'c', occurredAt: at(31), themes: [th('uncertainty', 0.7)] },
      { id: 'd', occurredAt: at(34), themes: [th('uncertainty', 0.6), th('conflict', 0.9)] },
      { id: 'e', occurredAt: at(62), themes: [th('conflict', 0.9)] },
      { id: 'f', occurredAt: at(65), themes: [th('decision', 0.9), th('conflict', 0.3)] },
      { id: 'g', occurredAt: at(91), themes: [th('decision', 0.9)] },
      { id: 'h', occurredAt: at(94), themes: [th('decision', 0.8)] },
    ];
    const steps = themeProgression(objects, { bucketing: 'month', perBucket: 1 });
    expect(steps.map((s) => s.slug)).toEqual(['uncertainty', 'conflict', 'decision']);
    expect(steps[0]!.sourceObjectIds.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(steps[0]!.periodStart).toBe('2026-03-01');
    expect(steps[0]!.periodEnd).toBe('2026-04-30');
    expect(steps.map((s) => s.sequenceIndex)).toEqual([0, 1, 2]);
    for (const s of steps) expect(s.sourceObjectIds.length).toBeGreaterThanOrEqual(2);
  });

  it('drops a step with fewer than two supporting objects', () => {
    const objects = [
      { id: 'a', occurredAt: at(0), themes: [th('trust', 0.9)] },
      { id: 'b', occurredAt: at(3), themes: [th('trust', 0.8)] },
      { id: 'c', occurredAt: at(40), themes: [th('grief', 0.9)] },
      { id: 'd', occurredAt: at(70), themes: [th('hope', 0.9)] },
      { id: 'e', occurredAt: at(72), themes: [th('hope', 0.9)] },
    ];
    const steps = themeProgression(objects, { bucketing: 'month' });
    expect(steps.map((s) => s.slug)).toEqual(['trust', 'hope']);
    expect(themeProgression([])).toEqual([]);
    expect(themeProgression([objects[0]!])).toEqual([]);
  });

  it('takes the top two themes per bucket by weight', () => {
    const objects = [
      { id: 'a', occurredAt: at(0), themes: [th('trust', 0.9), th('care', 0.5), th('fear', 0.4)] },
      { id: 'b', occurredAt: at(3), themes: [th('trust', 0.8), th('care', 0.6), th('fear', 0.4)] },
    ];
    expect(themeProgression(objects, { bucketing: 'month' }).map((s) => s.slug)).toEqual([
      'trust',
      'care',
    ]);
  });
});

describe('recurring symbols', () => {
  const rws = (
    id: string,
    day: number,
    cards: [string, string, string | null, string | null][],
    themes: string[] = [],
  ): SymbolObject => ({
    id,
    occurredAt: at(day),
    deckSystem: 'rws',
    deckName: 'Rider–Waite–Smith',
    cards: cards.map(([cardId, name, suit, positionName]) => ({
      cardId,
      name,
      suit,
      suitLabel: suit ? suit[0]!.toUpperCase() + suit.slice(1) : null,
      positionName,
    })),
    themes: themes.map((s) => ({ slug: s, label: s })),
  });
  const thoth = (
    id: string,
    day: number,
    cards: [string, string, string | null, string | null][],
  ): SymbolObject => ({
    ...rws(id, day, cards),
    deckSystem: 'thoth',
    deckName: 'Thoth',
  });

  it('a card recurs by its own id with context, sources newest first, and a repeated position', () => {
    const objects = [
      rws('a', 0, [['tower-rws', 'The Tower', null, 'Outcome']]),
      rws('b', 40, [
        ['tower-rws', 'The Tower', null, 'Outcome'],
        ['ace-cups', 'Ace of Cups', 'cups', 'Advice'],
      ]),
      rws('c', 80, [['tower-rws', 'The Tower', null, 'Situation']]),
    ];
    const [tower] = recurringSymbols(objects);
    expect(tower).toMatchObject({
      kind: 'card',
      label: 'The Tower',
      deck: { system: 'rws' },
      sourceObjectIds: ['c', 'b', 'a'],
    });
    expect(tower!.context).toBe(
      'Appeared in 3 of 3 readings between March and May, twice in the outcome position.',
    );
    expect(recurringSymbols(objects).some((s) => s.label === 'Ace of Cups')).toBe(false);
  });

  it('never merges a Thoth card with its RWS cousin, nor Disks with Pentacles (§6.7)', () => {
    const objects = [
      rws('a', 0, [
        ['strength-rws', 'Strength', null, null],
        ['ten-pentacles', 'Ten of Pentacles', 'pentacles', null],
      ]),
      thoth('b', 10, [
        ['lust-thoth', 'Lust', null, null],
        ['ten-disks', 'Ten of Disks', 'disks', null],
      ]),
      rws('c', 20, [
        ['strength-rws', 'Strength', null, null],
        ['two-pentacles', 'Two of Pentacles', 'pentacles', null],
      ]),
      thoth('d', 30, [
        ['lust-thoth', 'Lust', null, null],
        ['two-disks', 'Two of Disks', 'disks', null],
      ]),
    ];
    const symbols = recurringSymbols(objects);
    const cards = symbols
      .filter((s) => s.kind === 'card')
      .map((s) => `${s.label}@${s.deck?.system}`);
    expect(cards.sort()).toEqual(['Lust@thoth', 'Strength@rws']);
    const suits = symbols
      .filter((s) => s.kind === 'suit')
      .map((s) => `${s.label}@${s.deck?.system}`);
    expect(suits.sort()).toEqual(['Disks@thoth', 'Pentacles@rws']);
    expect(JSON.stringify(symbols)).not.toMatch(/archetype|cross_deck|equivalent/i);
  });

  it('themes recur across decks with an entries count', () => {
    const objects = [
      rws('a', 0, [], ['distance']),
      { ...thoth('b', 5, []), themes: [{ slug: 'distance', label: 'Distance' }] },
    ];
    const [t] = recurringSymbols(objects);
    expect(t).toMatchObject({ kind: 'theme', deck: null, sourceObjectIds: ['b', 'a'] });
    expect(t!.context).toBe('Came up in 2 of 2 entries in March.');
  });
});

describe('narrative header and timeline', () => {
  it('states counts honestly, including zero outcomes and both decks', () => {
    const now = '2026-09-13T00:00:00Z';
    expect(
      narrativeHeader({
        readings: 14,
        confirmedOutcomes: 2,
        openLoops: 0,
        deckSystems: 1,
        since: '2026-03-04T00:00:00Z',
        now,
      }),
    ).toBe('14 readings and 2 confirmed outcomes since March.');
    expect(
      narrativeHeader({
        readings: 3,
        confirmedOutcomes: 0,
        openLoops: 1,
        deckSystems: 2,
        since: '2025-11-04T00:00:00Z',
        now,
      }),
    ).toBe(
      '3 readings and no confirmed outcomes yet since November 2025, across both decks. One reading is still open.',
    );
    expect(
      narrativeHeader({
        readings: 0,
        confirmedOutcomes: 0,
        openLoops: 0,
        deckSystems: 0,
        since: null,
        now,
      }),
    ).toMatch(/Nothing here yet/);
  });

  it('interleaves kinds by date, newest first, grouped by month; open loops are unresolved or past-revisit', () => {
    const reading = (id: string, day: number): TimelineEntry => ({
      kind: 'reading',
      id,
      at: at(day),
      question: 'q',
      isOpenReflection: false,
      deck: { system: 'rws', name: 'RWS' },
      spread: 'One card',
      cards: [],
      followUpStatus: 'resolved',
      revisitAt: null,
      membership: { state: 'auto', reasons: [] },
    });
    const groups = buildTimeline([
      reading('r1', 0),
      { kind: 'event', id: 'e1', at: at(5), description: 'moved' },
      reading('r2', 40),
    ]);
    expect(groups.map((g) => g.items.map((i) => `${i.kind}:${i.id}`))).toEqual([
      ['reading:r2'],
      ['event:e1', 'reading:r1'],
    ]);
    expect(groups.map((g) => g.label)).toEqual(['April 2026', 'March 2026']);
    expect(isOpenLoop({ followUpStatus: 'unresolved', revisitAt: null })).toBe(true);
    expect(isOpenLoop({ followUpStatus: 'resolved', revisitAt: at(-1) }, at(0))).toBe(true);
    expect(isOpenLoop({ followUpStatus: 'resolved', revisitAt: at(1) }, at(0))).toBe(false);
    expect(isOpenLoop({ followUpStatus: 'not_relevant', revisitAt: null })).toBe(false);
  });
});

describe('recurring symbols v2 — context, not statistics (§3.3, Phase 10)', () => {
  const rws = (
    id: string,
    day: number,
    cardId: string,
    name: string,
    journeys?: { id: string; title: string }[],
  ): SymbolObject => ({
    id,
    occurredAt: at(day),
    deckSystem: 'rws',
    deckName: 'Rider–Waite–Smith',
    cards: [{ cardId, name, suit: null, suitLabel: null, positionName: 'Outcome' }],
    themes: [],
    ...(journeys ? { journeys } : {}),
  });

  it('two appearances are listed but never called a pattern; three are', () => {
    const two = recurringSymbols([
      rws('a', 0, 'tower', 'The Tower'),
      rws('b', 10, 'tower', 'The Tower'),
    ]);
    expect(two[0]).toMatchObject({ label: 'The Tower', isPattern: false });
    expect(patterns(two)).toEqual([]);
    const three = recurringSymbols([
      ...[rws('a', 0, 'tower', 'The Tower'), rws('b', 10, 'tower', 'The Tower')],
      rws('c', 30, 'tower', 'The Tower'),
    ]);
    expect(three[0]!.isPattern).toBe(true);
    expect(patterns(three).map((s) => s.label)).toEqual(['The Tower']);
    expect(three[0]!.occurrences.map((o) => o.objectId)).toEqual(['a', 'b', 'c']);
    expect(occurrencesSentence(three[0]!)).toMatch(/^The Tower: .+, .+, .+\.$/);
  });

  it('says when, around which journeys, before or after which confirmed events, and whether a connection was confirmed', () => {
    const j = { id: 'j1', title: 'The move' };
    const objects = [
      rws('a', 0, 'tower', 'The Tower', [j]),
      rws('b', 20, 'tower', 'The Tower', [j]),
      rws('c', 60, 'tower', 'The Tower'),
    ];
    const events = [
      { id: 'e1', occurredOn: at(23).slice(0, 10), description: 'Signed the lease' },
      { id: 'e2', occurredOn: at(200).slice(0, 10), description: 'Far away' },
    ];
    const [tower] = recurringSymbols(objects, {
      events,
      confirmedLinks: [{ readingId: 'b', eventId: 'e1' }],
    });
    expect(tower!.journeys).toEqual([{ id: 'j1', title: 'The move', count: 2 }]);
    expect(tower!.around).toEqual([
      {
        eventId: 'e1',
        description: 'Signed the lease',
        occurredOn: events[0]!.occurredOn,
        relation: 'after',
        days: 3,
        objectId: 'b',
        confirmed: true,
      },
    ]);
    expect(tower!.context).toContain('In “The move”.');
    expect(tower!.context).toContain(
      'Once 3 days after “Signed the lease”, a connection you confirmed.',
    );
    // Without the link the same event is context but not a confirmed connection.
    const [plain] = recurringSymbols(objects, { events });
    expect(plain!.around[0]!.confirmed).toBe(false);
    expect(plain!.context).not.toContain('confirmed');
  });
});
