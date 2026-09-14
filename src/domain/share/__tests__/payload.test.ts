import { describe, expect, it } from 'vitest';
import {
  buildMonthCard,
  buildReadingCard,
  DEFAULT_SHARE_OPTIONS,
  excerpt,
  parseShareOptions,
  shareOptionsQuery,
  type MonthForShare,
  type ReadingForShare,
} from '../payload';

const reading: ReadingForShare = {
  occurredAt: '2026-08-12T09:00:00Z',
  deck: { name: 'Rider–Waite–Smith', system: 'rws' },
  spread: { name: 'Three card' },
  cards: [
    {
      positionLabel: 'Past',
      name: 'The Star',
      reversed: false,
      artPath: '/cards/rws/17.avif',
      caption: 'XVII',
    },
    {
      positionLabel: 'Present',
      name: 'Two of Cups',
      reversed: true,
      artPath: '/cards/rws/c02.avif',
      caption: 'II · Cups',
    },
  ],
  question: 'Should I take the job Maya offered at the agency?',
  notes: 'Private: I am scared of letting Dad down. Maya said the agency would wait until October.',
  themes: ['decision', 'ambition'],
  entityLabels: ['Maya', 'the agency', 'Dad'],
};

const month: MonthForShare = {
  monthLabel: 'August 2026',
  readings: 3,
  events: 2,
  outcomes: 1,
  recurring: [{ name: 'Two of Cups', count: 3, deckSystem: 'rws' }],
  themes: ['uncertainty', 'decision'],
  journeyTitles: ['The agency and ambition', 'Maya'],
  entityLabels: ['Maya', 'the agency'],
};

describe('share-card payloads (FR-24)', () => {
  it('the default reading card carries no note, no question and no names — anywhere in the payload', () => {
    const p = buildReadingCard(reading);
    expect(p.question).toBeNull();
    expect(p.note).toBeNull();
    expect(p.entities).toBeNull();
    const json = JSON.stringify(p);
    expect(json).not.toContain('Maya');
    expect(json).not.toContain('agency');
    expect(json).not.toContain('Dad');
    expect(json).not.toContain('scared');
    expect(json).not.toContain('take the job');
    // What it does carry: the deck-native cards, positions, date, spread and themes.
    expect(p.cards.map((c) => c.name)).toEqual(['The Star', 'Two of Cups']);
    expect(p.cards[1]!.reversed).toBe(true);
    expect(p.dateLabel).toBe('12 August 2026');
    expect(p.themes).toEqual(['decision', 'ambition']);
    expect(p.deckSystem).toBe('rws');
  });

  it('opting in changes exactly what was opted into', () => {
    const q = buildReadingCard(reading, { question: true });
    expect(q.question).toBe(reading.question);
    expect(q.note).toBeNull();
    expect(q.entities).toBeNull();
    const n = buildReadingCard(reading, { notes: true });
    expect(n.question).toBeNull();
    expect(n.note).toMatch(/^Private: I am scared/);
    expect(n.entities).toBeNull();
    const e = buildReadingCard(reading, { entities: true });
    expect(e.entities).toEqual(['Maya', 'the agency', 'Dad']);
    expect(e.question).toBeNull();
    expect(e.note).toBeNull();
  });

  it('a Thoth reading keeps its own names and no art', () => {
    const p = buildReadingCard({
      ...reading,
      deck: { name: 'Thoth', system: 'thoth' },
      cards: [
        { positionLabel: 'One', name: 'Lust', reversed: false, artPath: null, caption: 'XI' },
      ],
    });
    expect(p.cards[0]).toMatchObject({ name: 'Lust', artPath: null, caption: 'XI' });
    expect(p.deckSystem).toBe('thoth');
  });

  it('the default month card names no journey and no person; opt-ins are separate', () => {
    const p = buildMonthCard(month);
    expect(p.journeys).toBeNull();
    expect(p.entities).toBeNull();
    expect(JSON.stringify(p)).not.toContain('Maya');
    expect(p.recurring[0]).toEqual({ name: 'Two of Cups', count: 3, deckSystem: 'rws' });
    expect(buildMonthCard(month, { journeys: true }).journeys).toEqual([
      'The agency and ambition',
      'Maya',
    ]);
    expect(buildMonthCard(month, { journeys: true }).entities).toBeNull();
    expect(buildMonthCard(month, { entities: true }).entities).toEqual(['Maya', 'the agency']);
    // Question and notes have no meaning on a month card and never leak in.
    const all = buildMonthCard(month, { question: true, notes: true });
    expect(all.journeys).toBeNull();
    expect(all.entities).toBeNull();
  });

  it('excerpts cut at a word boundary with an ellipsis; query round-trips; unknown params stay private', () => {
    expect(excerpt('short')).toBe('short');
    const long = excerpt('a'.repeat(50) + ' ' + 'b'.repeat(200));
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(161);
    expect(parseShareOptions({})).toEqual(DEFAULT_SHARE_OPTIONS);
    expect(parseShareOptions({ question: '1', notes: 'true', entities: 'yes' })).toEqual({
      question: true,
      notes: true,
      entities: false,
      journeys: false,
    });
    expect(shareOptionsQuery({ ...DEFAULT_SHARE_OPTIONS, notes: true })).toBe('?notes=1');
    expect(shareOptionsQuery(DEFAULT_SHARE_OPTIONS)).toBe('');
  });
});
