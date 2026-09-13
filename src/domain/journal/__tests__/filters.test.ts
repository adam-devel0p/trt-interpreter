import { describe, expect, it } from 'vitest';
import {
  dayRangeToInstants,
  decodeCursor,
  EMPTY_FILTERS,
  encodeCursor,
  groupByMonth,
  hasActiveFilters,
  journalHref,
  parseJournalParams,
  toSearchParams,
} from '../filters';

describe('journal filters ↔ URL', () => {
  it('parses every key, drops bad values field by field, and round-trips', () => {
    const f = parseJournalParams({
      q: '  strength ',
      from: '2026-01-01',
      to: '2026-03-31',
      deck: 'thoth',
      spread: '11111111-1111-4111-8111-111111111111',
      entity: '22222222-2222-4222-8222-222222222222',
      journey: '33333333-3333-4333-8333-333333333333',
      source: 'physical',
      status: 'resolved',
      notes: '1',
      ai: '0',
      sort: 'oldest',
    });
    expect(f).toEqual({
      q: 'strength',
      from: '2026-01-01',
      to: '2026-03-31',
      deck: 'thoth',
      spread: '11111111-1111-4111-8111-111111111111',
      entity: '22222222-2222-4222-8222-222222222222',
      journey: '33333333-3333-4333-8333-333333333333',
      source: 'physical',
      followUp: 'resolved',
      hasNotes: true,
      hasInterpretation: false,
      sort: 'oldest',
    });
    expect(parseJournalParams(toSearchParams(f))).toEqual(f);
    expect(journalHref(f)).toMatch(/^\/journal\?q=strength&from=/);
  });

  it('a malformed value drops only itself; the bare URL means everything', () => {
    const f = parseJournalParams({
      spread: 'not-a-uuid',
      entity: 'nobody',
      journey: 'nowhere',
      sort: 'sideways',
      source: 'psychic',
    });
    expect(f).toEqual(EMPTY_FILTERS);
    expect(hasActiveFilters(f)).toBe(false);
    expect(journalHref(f)).toBe('/journal');
    expect(journalHref({ sort: 'edited' })).toBe('/journal?sort=edited');
    expect(hasActiveFilters(parseJournalParams({ sort: 'edited' }))).toBe(false);
    expect(hasActiveFilters(parseJournalParams({ notes: '0' }))).toBe(true);
  });

  it('swaps an inverted date range and accepts arrays (first value wins)', () => {
    const f = parseJournalParams({ from: '2026-05-01', to: '2026-04-01', q: ['a', 'b'] });
    expect(f.from).toBe('2026-04-01');
    expect(f.to).toBe('2026-05-01');
    expect(f.q).toBe('a');
  });
});

describe('cursor', () => {
  it('round-trips and rejects garbage', () => {
    const c = {
      key: '2026-09-01T12:00:00.123456+00:00',
      id: '11111111-1111-4111-8111-111111111111',
    };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not base64 json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"key":"x","id":"nope"}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
  });
});

describe('month grouping and day ranges', () => {
  it('groups consecutive items by month in the given zone', () => {
    const items = [
      { at: '2026-09-01T00:30:00Z' },
      { at: '2026-08-31T23:30:00Z' },
      { at: '2026-08-02T10:00:00Z' },
    ];
    const utc = groupByMonth(items, (i) => i.at);
    expect(utc.map((g) => [g.key, g.label, g.items.length])).toEqual([
      ['2026-09', 'September 2026', 1],
      ['2026-08', 'August 2026', 2],
    ]);
    // In Auckland (UTC+12) the first two are both September.
    const nz = groupByMonth(items, (i) => i.at, { timeZone: 'Pacific/Auckland' });
    expect(nz.map((g) => [g.key, g.items.length])).toEqual([
      ['2026-09', 2],
      ['2026-08', 1],
    ]);
  });

  it('turns local calendar days into an inclusive instant range', () => {
    expect(dayRangeToInstants('2026-09-01', '2026-09-01')).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
    });
    expect(dayRangeToInstants('2026-09-01', null, 'Europe/Berlin').from).toBe(
      '2026-08-31T22:00:00.000Z',
    );
    expect(dayRangeToInstants(null, '2026-01-15', 'America/New_York').to).toBe(
      '2026-01-16T05:00:00.000Z',
    );
  });
});
