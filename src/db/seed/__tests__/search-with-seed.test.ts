import { describe, expect, it } from 'vitest';
import { searchCards, similarity, type SearchableCard } from '@/domain/decks/search';
import type { DeckSeed } from '@/domain/decks/types';
import { ALIASES } from '../decks/aliases';
import { RWS_DECK } from '../decks/rws';
import { THOTH_DECK } from '../decks/thoth';

type C = SearchableCard & { deck: 'rws' | 'thoth' };

function searchable(deck: DeckSeed): C[] {
  return deck.cards.map((c) => ({
    id: `${deck.system}/${c.slug}`,
    deck: deck.system,
    name: c.name,
    title: c.title,
    arcana: c.arcana,
    suit: c.suit,
    suit_label: c.suit_label,
    rank_label: c.rank_label,
    number: c.number,
    numeral: c.numeral,
    sort_order: c.sort_order,
    aliases: ALIASES.filter((a) => a.deck === deck.system && a.card_slug === c.slug).map((a) => ({
      alias: a.alias,
      kind: a.kind,
    })),
  }));
}

const rws = searchable(RWS_DECK);
const thoth = searchable(THOTH_DECK);
const all = [...rws, ...thoth];
const names = (hits: { card: C }[]) => hits.map((h) => `${h.card.deck}:${h.card.name}`);

describe('searchCards — deck-native, alias-aware (FR-03C)', () => {
  it('"Strength" finds Thoth Lust under its own name, labeled Thoth', () => {
    const hits = searchCards(thoth, 'Strength');
    const lust = hits.find((h) => h.card.name === 'Lust');
    expect(lust).toBeDefined();
    expect(lust!.matched).toBe('alias');
    expect(lust!.via).toBe('Strength');
    expect(lust!.card.deck).toBe('thoth');
    // Nothing in the result set is renamed: no Thoth hit carries an RWS-only name.
    expect(hits.every((h) => h.card.name !== 'Strength' || h.card.title === 'Strength')).toBe(true);
  });

  it('"Strength" across both decks ranks the RWS card itself first, then Thoth results', () => {
    const hits = searchCards(all, 'Strength');
    expect(names(hits)[0]).toBe('rws:Strength');
    expect(names(hits)).toContain('thoth:Lust');
    // The Thoth Nine of Wands is titled "Strength" — a title hit, honestly labeled as Nine of Wands.
    expect(names(hits)).toContain('thoth:Nine of Wands');
  });

  it('"Pentacles" finds Thoth Disks cards without renaming them', () => {
    const hits = searchCards(thoth, 'Pentacles', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.card.suit === 'disks' && h.card.name.endsWith('of Disks'))).toBe(
      true,
    );
    expect(hits.every((h) => h.matched === 'alias')).toBe(true);
  });

  it('"Two of Pentacles" in Thoth resolves to Two of Disks', () => {
    expect(names(searchCards(thoth, 'Two of Pentacles'))[0]).toBe('thoth:Two of Disks');
  });

  it('deck scoping: an RWS-only term in the Thoth deck never yields a Page', () => {
    const hits = searchCards(thoth, 'Page of Pentacles');
    expect(hits[0]!.card.name).toBe('Princess of Disks');
    expect(hits.every((h) => h.card.rank_label !== 'Page')).toBe(true);
  });

  it('partial and prefix queries', () => {
    expect(names(searchCards(rws, 'hang'))[0]).toBe('rws:The Hanged Man');
    expect(names(searchCards(rws, 'kni cu'))[0]).toBe('rws:Knight of Cups');
    expect(names(searchCards(thoth, 'prin sw'))).toEqual([
      'thoth:Princess of Swords',
      'thoth:Prince of Swords',
    ]);
  });

  it('number queries: digits, "3 cups", roman numerals', () => {
    const three = searchCards(rws, '3', { limit: 20 });
    expect(names(three)).toContain('rws:The Empress');
    expect(names(three)).toContain('rws:Three of Cups');
    expect(names(searchCards(rws, '3 cups'))[0]).toBe('rws:Three of Cups');
    expect(names(searchCards(thoth, 'viii'))[0]).toBe('thoth:Adjustment');
    expect(names(searchCards(rws, '8'))).toContain('rws:Strength');
  });

  it('Thoth titles are searchable and labeled as the card', () => {
    const hit = searchCards(thoth, 'Dominion')[0]!;
    expect(hit.card.name).toBe('Two of Wands');
    expect(hit.matched).toBe('title');
    expect(names(searchCards(thoth, 'ruin'))[0]).toBe('thoth:Ten of Swords');
  });

  it('cross-deck names resolve in both directions', () => {
    expect(names(searchCards(rws, 'Lust'))[0]).toBe('rws:Strength');
    expect(names(searchCards(rws, 'The Universe'))[0]).toBe('rws:The World');
    expect(names(searchCards(thoth, 'Temperance'))[0]).toBe('thoth:Art');
    expect(names(searchCards(thoth, 'Judgement'))[0]).toBe('thoth:The Aeon');
    expect(names(searchCards(thoth, 'Wheel of Fortune'))[0]).toBe('thoth:Fortune');
  });

  it('typos fall back to fuzzy matching', () => {
    expect(names(searchCards(rws, 'strenght'))[0]).toBe('rws:Strength');
    expect(names(searchCards(thoth, 'adjustmnt'))[0]).toBe('thoth:Adjustment');
    expect(searchCards(rws, 'zzzzqqq')).toEqual([]);
  });

  it('empty query returns nothing; similarity is symmetric and bounded', () => {
    expect(searchCards(rws, '   ')).toEqual([]);
    expect(similarity('lust', 'lust')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('strength', 'strenght')).toBeCloseTo(similarity('strenght', 'strength'));
  });
});
