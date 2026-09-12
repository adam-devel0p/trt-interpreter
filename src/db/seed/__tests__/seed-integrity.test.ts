import { describe, expect, it } from 'vitest';
import { ALIASES } from '../decks/aliases';
import { ARCHETYPES, archetypeKeyFor, mappingNoteFor } from '../decks/archetypes';
import { RWS_DECK } from '../decks/rws';
import { SPREADS } from '../decks/spreads';
import { THOTH_DECK } from '../decks/thoth';
import { cardSeedSchema, deckSeedSchema, spreadSeedSchema } from '@/domain/decks/types';

const DECKS = [RWS_DECK, THOTH_DECK];

describe('seed integrity — both decks', () => {
  it('each deck has exactly 78 cards that validate against the schema', () => {
    for (const d of DECKS) {
      expect(() => deckSeedSchema.parse(d)).not.toThrow();
      expect(d.cards).toHaveLength(78);
      for (const c of d.cards) expect(() => cardSeedSchema.parse(c)).not.toThrow();
    }
  });

  it('slugs and names are unique within a deck; sort_order is a permutation of 0..77', () => {
    for (const d of DECKS) {
      expect(new Set(d.cards.map((c) => c.slug)).size).toBe(78);
      expect(new Set(d.cards.map((c) => c.name)).size).toBe(78);
      expect([...d.cards.map((c) => c.sort_order)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 78 }, (_, i) => i),
      );
    }
  });

  it('every card carries keywords, a meaning, symbolism and correspondences', () => {
    for (const d of DECKS) {
      for (const c of d.cards) {
        expect(c.keywords_upright.length, `${d.slug}/${c.slug}`).toBeGreaterThanOrEqual(3);
        expect(c.meaning_upright.length, `${d.slug}/${c.slug}`).toBeGreaterThan(120);
        expect(c.symbolism.length, `${d.slug}/${c.slug}`).toBeGreaterThan(60);
        expect(Object.keys(c.correspondences).length, `${d.slug}/${c.slug}`).toBeGreaterThan(0);
      }
    }
  });

  it('structure: 22 majors numbered 0–21, four suits × (10 pips + 4 courts)', () => {
    for (const d of DECKS) {
      const majors = d.cards.filter((c) => c.arcana === 'major');
      expect(majors.map((c) => c.number).sort((a, b) => a! - b!)).toEqual(
        Array.from({ length: 22 }, (_, i) => i),
      );
      const suits = [...new Set(d.cards.filter((c) => c.suit).map((c) => c.suit))];
      expect(suits).toHaveLength(4);
      for (const s of suits) {
        const inSuit = d.cards.filter((c) => c.suit === s);
        expect(
          inSuit
            .filter((c) => c.number !== null)
            .map((c) => c.number)
            .sort((a, b) => a! - b!),
        ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(inSuit.filter((c) => c.rank_label)).toHaveLength(4);
      }
    }
  });

  it('meanings use the reflective register: no deterministic prediction verbs', () => {
    const banned =
      /\b(will happen|is going to|guaranteed|definitely|certainly will|you will (?:get|lose|win|meet))\b/i;
    for (const d of DECKS)
      for (const c of d.cards) {
        expect(c.meaning_upright, `${d.slug}/${c.slug}`).not.toMatch(banned);
        if (c.meaning_reversed)
          expect(c.meaning_reversed, `${d.slug}/${c.slug}`).not.toMatch(banned);
      }
  });

  it('a reversal-supporting deck has reversed text on every card; a non-supporting deck has none', () => {
    for (const d of DECKS) {
      for (const c of d.cards) {
        if (d.supports_reversals) {
          expect(c.meaning_reversed, `${d.slug}/${c.slug}`).toBeTruthy();
          expect(c.keywords_reversed.length).toBeGreaterThan(0);
        } else {
          expect(c.meaning_reversed, `${d.slug}/${c.slug}`).toBeNull();
          expect(c.keywords_reversed).toEqual([]);
        }
      }
    }
  });
});

describe('RWS deck', () => {
  const rws = RWS_DECK;
  it('uses the standard names, Pentacles and the Page/Knight/Queen/King court', () => {
    const byNum = (n: number) =>
      rws.cards.find((c) => c.arcana === 'major' && c.number === n)!.name;
    expect(byNum(8)).toBe('Strength');
    expect(byNum(11)).toBe('Justice');
    expect(byNum(14)).toBe('Temperance');
    expect(byNum(20)).toBe('Judgement');
    expect(byNum(21)).toBe('The World');
    expect(byNum(1)).toBe('The Magician');
    expect(new Set(rws.cards.filter((c) => c.suit).map((c) => c.suit_label))).toEqual(
      new Set(['Wands', 'Cups', 'Swords', 'Pentacles']),
    );
    expect(new Set(rws.cards.filter((c) => c.rank_label).map((c) => c.rank_label))).toEqual(
      new Set(['Page', 'Knight', 'Queen', 'King']),
    );
    expect(rws.art_strategy).toBe('bundled_public_domain');
    expect(rws.cards.every((c) => c.art_asset_path?.startsWith('/cards/rws/'))).toBe(true);
  });
});

describe('Thoth authenticity suite (§6.7 — never a skin over RWS)', () => {
  const thoth = THOTH_DECK;
  const byNum = (n: number) => thoth.cards.find((c) => c.arcana === 'major' && c.number === n)!;

  it('court ranks are Knight / Queen / Prince / Princess', () => {
    expect(new Set(thoth.cards.filter((c) => c.rank_label).map((c) => c.rank_label))).toEqual(
      new Set(['Knight', 'Queen', 'Prince', 'Princess']),
    );
    expect(thoth.cards.some((c) => c.rank_label === 'Page' || c.rank_label === 'King')).toBe(false);
  });

  it('the earth suit is Disks', () => {
    expect(new Set(thoth.cards.filter((c) => c.suit).map((c) => c.suit_label))).toEqual(
      new Set(['Wands', 'Cups', 'Swords', 'Disks']),
    );
    expect(thoth.cards.some((c) => c.suit === 'pentacles')).toBe(false);
  });

  it('VIII = Adjustment, XI = Lust, XIV = Art, XX = The Aeon, XXI = The Universe, I = The Magus, II = The Priestess, X = Fortune', () => {
    expect(byNum(8).name).toBe('Adjustment');
    expect(byNum(11).name).toBe('Lust');
    expect(byNum(14).name).toBe('Art');
    expect(byNum(20).name).toBe('The Aeon');
    expect(byNum(21).name).toBe('The Universe');
    expect(byNum(1).name).toBe('The Magus');
    expect(byNum(2).name).toBe('The Priestess');
    expect(byNum(10).name).toBe('Fortune');
  });

  it('small cards 2–10 carry their Thoth titles; Aces carry none', () => {
    const titles: Record<string, string[]> = {
      wands: [
        'Dominion',
        'Virtue',
        'Completion',
        'Strife',
        'Victory',
        'Valour',
        'Swiftness',
        'Strength',
        'Oppression',
      ],
      cups: [
        'Love',
        'Abundance',
        'Luxury',
        'Disappointment',
        'Pleasure',
        'Debauch',
        'Indolence',
        'Happiness',
        'Satiety',
      ],
      swords: [
        'Peace',
        'Sorrow',
        'Truce',
        'Defeat',
        'Science',
        'Futility',
        'Interference',
        'Cruelty',
        'Ruin',
      ],
      disks: [
        'Change',
        'Works',
        'Power',
        'Worry',
        'Success',
        'Failure',
        'Prudence',
        'Gain',
        'Wealth',
      ],
    };
    for (const [suit, expected] of Object.entries(titles)) {
      const pips = thoth.cards
        .filter((c) => c.suit === suit && c.number !== null && c.number >= 2)
        .sort((a, b) => a.number! - b.number!);
      expect(pips.map((c) => c.title)).toEqual(expected);
      expect(thoth.cards.find((c) => c.suit === suit && c.number === 1)!.title).toBeNull();
    }
  });

  it('majors carry Hebrew letter and path; small cards carry decan and sephira; courts carry rulership', () => {
    for (const c of thoth.cards) {
      const k = c.correspondences;
      if (c.arcana === 'major') {
        expect(k.hebrew_letter, c.slug).toBeTruthy();
        expect(k.path, c.slug).toBeGreaterThanOrEqual(11);
      } else if (c.rank_label) {
        expect(k.rulership, c.slug).toBeTruthy();
        expect(k.sub_element, c.slug).toBeTruthy();
      } else {
        expect(k.sephira, c.slug).toBeTruthy();
        if (c.number! > 1) expect(k.decan, c.slug).toBeTruthy();
      }
    }
  });

  it('no Thoth meaning equals its archetype-mapped RWS meaning, and no Thoth text borrows RWS vocabulary', () => {
    const rwsByKey = new Map(RWS_DECK.cards.map((c) => [archetypeKeyFor('rws', c), c]));
    const rwsOnly = /\b(Pentacles?|Page of|King of|Rider|Waite|Colman Smith)\b/;
    for (const c of thoth.cards) {
      const mate = rwsByKey.get(archetypeKeyFor('thoth', c));
      expect(mate, `no RWS mate for ${c.slug}`).toBeDefined();
      expect(c.meaning_upright).not.toBe(mate!.meaning_upright);
      expect(c.symbolism).not.toBe(mate!.symbolism);
      // Not even a shared sentence.
      const sentences = c.meaning_upright.split(/(?<=\.)\s+/);
      for (const s of sentences)
        expect(mate!.meaning_upright, `${c.slug} shares "${s}"`).not.toContain(s);
      for (const field of [c.meaning_upright, c.symbolism, ...c.keywords_upright])
        expect(field, `${c.slug}: ${field}`).not.toMatch(rwsOnly);
    }
    // Renamed trumps never mention their RWS counterpart's name in their own meaning.
    const renamed: Record<string, RegExp> = {
      lust: /\bStrength\b/,
      adjustment: /\bJustice\b/,
      art: /\bTemperance\b/,
      'the-aeon': /\bJudgement\b/,
      'the-universe': /\bThe World\b/,
      'the-magus': /\bMagician\b/,
    };
    for (const [slug, re] of Object.entries(renamed)) {
      const c = thoth.cards.find((x) => x.slug === slug)!;
      expect(c.meaning_upright, slug).not.toMatch(re);
      expect(c.keywords_upright.join(' '), slug).not.toMatch(re);
    }
  });

  it('is text-only, supports no reversals, and says so', () => {
    expect(thoth.art_strategy).toBe('text_only');
    expect(thoth.supports_reversals).toBe(false);
    expect(thoth.cards.every((c) => c.art_asset_path === null)).toBe(true);
    expect(thoth.license_note).toMatch(/No scans/);
  });
});

describe('archetype mapping — metadata only', () => {
  it('has 78 slots and every card of every deck belongs to exactly one', () => {
    expect(ARCHETYPES).toHaveLength(78);
    expect(new Set(ARCHETYPES.map((a) => a.key)).size).toBe(78);
    const keys = new Set(ARCHETYPES.map((a) => a.key));
    for (const d of DECKS) {
      const used = d.cards.map((c) => archetypeKeyFor(d.system, c));
      expect(new Set(used).size, d.slug).toBe(78);
      for (const k of used) expect(keys.has(k), k).toBe(true);
    }
  });

  it('labels are neutral (no deck-specific card names) and mismatches carry a note', () => {
    const cardNames = new Set(DECKS.flatMap((d) => d.cards.map((c) => c.name)));
    for (const a of ARCHETYPES) expect(cardNames.has(a.label), a.label).toBe(false);
    const mismatched = [
      'lust',
      'adjustment',
      'art',
      'the-aeon',
      'the-universe',
      'two-of-disks',
      'princess-of-disks',
      'knight-of-wands',
    ];
    for (const slug of mismatched) {
      const c = THOTH_DECK.cards.find((x) => x.slug === slug)!;
      expect(mappingNoteFor('thoth', c), slug).toMatch(/Structural/);
    }
    for (const slug of ['page-of-cups', 'king-of-swords', 'two-of-pentacles'])
      expect(
        mappingNoteFor(
          'rws',
          RWS_DECK.cards.find((x) => x.slug === slug)!,
        ),
      ).toMatch(/Structural/);
  });
});

describe('aliases', () => {
  it('point at real cards, are unique per (deck, card, alias) and never equal the card’s own name', () => {
    const slugs = new Map(DECKS.map((d) => [d.system, new Map(d.cards.map((c) => [c.slug, c]))]));
    const seen = new Set<string>();
    for (const a of ALIASES) {
      const card = slugs.get(a.deck)!.get(a.card_slug);
      expect(card, `${a.deck}/${a.card_slug}`).toBeDefined();
      expect(a.alias.toLowerCase()).not.toBe(card!.name.toLowerCase());
      const k = `${a.deck}/${a.card_slug}/${a.alias.toLowerCase()}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it('cover the required equivalences in both directions', () => {
    const has = (deck: string, slug: string, alias: string) =>
      ALIASES.some((a) => a.deck === deck && a.card_slug === slug && a.alias === alias);
    expect(has('thoth', 'lust', 'Strength')).toBe(true);
    expect(has('rws', 'strength', 'Lust')).toBe(true);
    expect(has('thoth', 'two-of-disks', 'Two of Pentacles')).toBe(true);
    expect(has('rws', 'two-of-pentacles', 'Two of Disks')).toBe(true);
    expect(has('thoth', 'princess-of-disks', 'Page of Pentacles')).toBe(true);
    expect(has('thoth', 'the-aeon', 'Judgement')).toBe(true);
  });

  it('never gives a deck an alias that is another card’s name in the same deck', () => {
    for (const d of DECKS) {
      const names = new Set(d.cards.map((c) => c.name.toLowerCase()));
      for (const a of ALIASES.filter((x) => x.deck === d.system))
        expect(names.has(a.alias.toLowerCase()), `${d.slug}: ${a.alias}`).toBe(false);
    }
  });
});

describe('built-in spreads', () => {
  it('there are five, each valid, with prompts on every position and layout slots within the canvas', () => {
    expect(SPREADS.map((s) => s.slug)).toEqual([
      'one-card',
      'three-card',
      'situation-advice-outcome',
      'decision',
      'celtic-cross-lite',
    ]);
    expect(SPREADS.map((s) => s.positions.length)).toEqual([1, 3, 3, 5, 5]);
    for (const s of SPREADS) {
      expect(() => spreadSeedSchema.parse(s)).not.toThrow();
      expect(new Set(s.positions.map((p) => p.key)).size).toBe(s.positions.length);
      for (const p of s.positions) expect(p.prompt.length).toBeGreaterThan(20);
      // Every slot's card box stays inside the canvas (card aspect 3:5).
      for (const slot of s.layout.slots) {
        const h = (slot.w * s.layout.aspect) / 0.6;
        expect(slot.x - slot.w / 2, `${s.slug}#${slot.index} left`).toBeGreaterThanOrEqual(-0.001);
        expect(slot.x + slot.w / 2, `${s.slug}#${slot.index} right`).toBeLessThanOrEqual(1.001);
        expect(slot.y - h / 2, `${s.slug}#${slot.index} top`).toBeGreaterThanOrEqual(-0.001);
        expect(slot.y + h / 2, `${s.slug}#${slot.index} bottom`).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('prompts are hedged, never predictive', () => {
    for (const s of SPREADS)
      for (const p of s.positions)
        expect(p.prompt).not.toMatch(/\b(will happen|is going to|certainly)\b/i);
  });
});
