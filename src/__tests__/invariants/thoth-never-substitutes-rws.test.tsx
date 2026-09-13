import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ALIASES } from '@/db/seed/decks/aliases';
import { archetypeKeyFor } from '@/db/seed/decks/archetypes';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import { searchCards } from '@/domain/decks/search';
import type { CardSeed, CardView, DeckSeed } from '@/domain/decks/types';
import { Card, cardAltText } from '@/ui/components/card';

/**
 * Invariant 3 (CLAUDE.md, spec §6.7): Thoth is never rendered as alternate RWS artwork or given
 * RWS meanings. RWS and Thoth are both first-class; card identity, names, court structure and
 * meanings are deck-native. The archetype mapping is metadata for search/analytics only.
 *
 * Three layers, so a regression in any one of them fails here:
 *   1. the seed data itself is deck-native;
 *   2. no render path in the source tree reads the archetype tables;
 *   3. the `Card` component's actual output shows the Thoth name and never the RWS one.
 */

const view = (deck: DeckSeed, c: CardSeed, id = `${deck.system}/${c.slug}`): CardView => ({
  id,
  deck_id: deck.slug,
  deck_system: deck.system,
  deck_name: deck.name,
  slug: c.slug,
  name: c.name,
  title: c.title,
  arcana: c.arcana,
  suit: c.suit,
  suit_label: c.suit_label,
  rank_label: c.rank_label,
  number: c.number,
  numeral: c.numeral,
  element: c.element,
  astrology: c.astrology,
  correspondences: c.correspondences,
  art_asset_path: c.art_asset_path,
  sort_order: c.sort_order,
});

const thothCard = (slug: string) => THOTH_DECK.cards.find((c) => c.slug === slug)!;
const rwsCard = (slug: string) => RWS_DECK.cards.find((c) => c.slug === slug)!;

describe('thoth-never-substitutes-rws', () => {
  describe('1 · seed data is deck-native', () => {
    it('renamed trumps, Disks and the Thoth court never carry RWS names', () => {
      expect(thothCard('lust').name).toBe('Lust');
      expect(thothCard('adjustment').name).toBe('Adjustment');
      expect(thothCard('art').name).toBe('Art');
      expect(thothCard('the-aeon').name).toBe('The Aeon');
      expect(thothCard('the-universe').name).toBe('The Universe');
      const rwsNames = new Set(RWS_DECK.cards.map((c) => c.name));
      for (const slug of [
        'lust',
        'adjustment',
        'art',
        'the-aeon',
        'the-universe',
        'the-magus',
        'fortune',
        'the-priestess',
      ])
        expect(rwsNames.has(thothCard(slug).name), slug).toBe(false);
      expect(THOTH_DECK.cards.some((c) => /Pentacles|\bPage\b|\bKing\b/.test(c.name))).toBe(false);
    });

    it('no Thoth meaning is a copy of the RWS meaning in the same structural slot', () => {
      const rwsByKey = new Map(RWS_DECK.cards.map((c) => [archetypeKeyFor('rws', c), c]));
      for (const c of THOTH_DECK.cards) {
        const mate = rwsByKey.get(archetypeKeyFor('thoth', c))!;
        expect(c.meaning_upright, c.slug).not.toBe(mate.meaning_upright);
        expect(c.keywords_upright, c.slug).not.toEqual(mate.keywords_upright);
      }
    });

    it('no Thoth card points at RWS artwork', () => {
      expect(THOTH_DECK.art_strategy).toBe('text_only');
      for (const c of THOTH_DECK.cards) {
        expect(c.art_asset_path, c.slug).toBeNull();
      }
      for (const c of RWS_DECK.cards) expect(c.art_asset_path).toMatch(/^\/cards\/rws\//);
    });
  });

  describe('2 · render paths never resolve through archetypes', () => {
    const RENDER_PATHS = [
      'src/ui/components/card.tsx',
      'src/ui/components/card-picker.tsx',
      'src/ui/components/spread-layout.tsx',
      'src/db/queries/decks.ts',
      'app/(app)/decks',
      'app/(marketing)/cards',
      'app/(marketing)/spreads',
      // Phase 03: the reading loop renders cards from readings → cards rows only.
      'app/(app)/reading',
      'src/db/queries/readings.ts',
      'src/ui/components/reading-detail.tsx',
      'src/ui/components/card-entry.tsx',
      'src/ui/components/shuffle-reveal.tsx',
    ];
    const ARCHETYPE_REF = /card_archetype|cardArchetype|archetypeKeyFor|\barchetypes?\b/i;

    function files(p: string): string[] {
      const abs = path.resolve(process.cwd(), p);
      try {
        if (statSync(abs).isFile()) return [abs];
      } catch {
        return [];
      }
      return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(path.join(p, e.name))
          : /\.(tsx?|css)$/.test(e.name)
            ? [path.join(abs, e.name)]
            : [],
      );
    }

    it('card, picker, layout, deck queries and the reference pages contain no archetype reference', () => {
      const scanned = RENDER_PATHS.flatMap(files);
      expect(scanned.length, 'render paths exist').toBeGreaterThan(3);
      for (const f of scanned) {
        const src = readFileSync(f, 'utf8');
        // Comments may *mention* the rule; code may not. Strip comments before matching.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        expect(code, path.relative(process.cwd(), f)).not.toMatch(ARCHETYPE_REF);
      }
    });

    it('the deck and reading query modules never select from the archetype tables', () => {
      for (const [file, allowed] of [
        ['src/db/queries/decks.ts', ['decks', 'cards', 'card_aliases', 'spreads']],
        [
          'src/db/queries/readings.ts',
          ['readings', 'reading_cards', 'reading_drafts', 'reading_note_revisions'],
        ],
        ['src/db/queries/journal.ts', ['readings']],
      ] as const) {
        const src = readFileSync(path.resolve(file), 'utf8');
        const fromCalls = [...src.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
        expect(fromCalls.length, file).toBeGreaterThan(0);
        for (const t of fromCalls) expect(allowed, `${file}: ${t}`).toContain(t);
        // Embedded selects name their tables too: none may be an archetype table.
        expect(src).not.toMatch(/card_archetype/);
      }
    });
  });

  describe('3 · what the Card component actually renders', () => {
    it('Thoth Lust renders as "Lust — Thoth" and never mentions Strength', () => {
      const html = renderToStaticMarkup(
        <Card card={view(THOTH_DECK, thothCard('lust'))} caption />,
      );
      expect(html).toContain('aria-label="Lust — Thoth"');
      expect(html).toContain('Lust');
      expect(html).not.toMatch(/Strength/);
      expect(html).not.toMatch(/<img/); // text-only treatment, no RWS scan
      expect(html).toContain('data-deck="thoth"');
    });

    it('Thoth court and Disks render deck-natively', () => {
      const html = renderToStaticMarkup(
        <Card card={view(THOTH_DECK, thothCard('princess-of-disks'))} caption />,
      );
      expect(html).toContain('Princess of Disks');
      expect(html).not.toMatch(/Page|Pentacles/);
      const two = renderToStaticMarkup(<Card card={view(THOTH_DECK, thothCard('two-of-disks'))} />);
      expect(two).toContain('Two of Disks');
      expect(two).toContain('Change'); // the Thoth title, not an RWS keyword
    });

    it('RWS Strength reversed renders its own art with deck-native alt text and an explicit label', () => {
      const html = renderToStaticMarkup(
        <Card card={view(RWS_DECK, rwsCard('strength'))} orientation="reversed" caption />,
      );
      expect(html).toContain('alt="Strength, reversed — Rider–Waite–Smith"');
      expect(html).toContain('/cards/rws/strength-320.webp');
      expect(html).toContain('rotate-180');
      expect(html).toMatch(/>Reversed</);
      expect(html).not.toMatch(/Lust/);
    });

    it('alt text is deck-native for every card of both decks', () => {
      for (const deck of [RWS_DECK, THOTH_DECK])
        for (const c of deck.cards) {
          const alt = cardAltText(view(deck, c), 'upright');
          expect(alt).toBe(`${c.name} — ${deck.name}`);
        }
    });
  });

  describe('4 · aliases find, never rename', () => {
    it('searching an RWS term in the Thoth deck labels the hit with the Thoth name', () => {
      const cards = THOTH_DECK.cards.map((c) => ({
        ...view(THOTH_DECK, c),
        aliases: ALIASES.filter((a) => a.deck === 'thoth' && a.card_slug === c.slug).map((a) => ({
          alias: a.alias,
          kind: a.kind,
        })),
      }));
      const strength = searchCards(cards, 'Strength').find((h) => h.matched === 'alias')!;
      expect(strength.card.name).toBe('Lust');
      expect(strength.via).toBe('Strength');
      expect(searchCards(cards, 'Page of Pentacles')[0]!.card.name).toBe('Princess of Disks');
      expect(searchCards(cards, 'The World')[0]!.card.name).toBe('The Universe');
    });
  });
});
