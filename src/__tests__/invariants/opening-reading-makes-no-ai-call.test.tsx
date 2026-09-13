import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '@/db/queries/readings';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import { SPREADS } from '@/db/seed/decks/spreads';
import type { CardSeed, DeckSeed } from '@/domain/decks/types';

/**
 * Invariant (CLAUDE.md engineering rules, spec §19): opening a saved reading makes zero AI
 * calls. Generated artifacts are stored, never recomputed. Two layers:
 *   1. the module graph — nothing reachable from the reading routes, the reading query layer
 *      or the detail component imports `src/ai/`;
 *   2. runtime — with every AI entry point replaced by a spy that throws, the query layer's
 *      read and the detail screen's render both complete without touching it.
 * Phase 04 extends layer 2 to a reading *with* a stored interpretation.
 */

const aiSpy = vi.fn(() => {
  throw new Error('AI must never be called when opening a reading');
});
vi.mock('@/ai', () => ({ getAiRunner: aiSpy, describeProviderConfig: aiSpy }));
vi.mock('@/ai/index', () => ({ getAiRunner: aiSpy, describeProviderConfig: aiSpy }));
vi.mock('@/ai/run', () => ({ createAiRunner: aiSpy }));
vi.mock('@/ai/providers/mock', () => ({ createMockProvider: aiSpy }));

const ROOT = process.cwd();
const ENTRY_POINTS = [
  'app/(app)/reading',
  'app/(app)/home/page.tsx',
  'src/db/queries/readings.ts',
  'src/db/queries/spreads.ts',
  'src/ui/components/reading-detail.tsx',
  'src/ui/components/card-entry.tsx',
  'src/ui/components/shuffle-reveal.tsx',
  'src/ui/components/user-note-editor.tsx',
];

function listFiles(p: string): string[] {
  const abs = path.resolve(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(path.join(p, e.name))
      : /\.(tsx?|mjs|js)$/.test(e.name)
        ? [path.join(abs, e.name)]
        : [],
  );
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.resolve(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null; // node_modules
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Every file transitively imported from the entry points (source-level, first-party only). */
function moduleGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = ENTRY_POINTS.flatMap(listFiles);
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const dep = resolveImport(f, m[1]!);
      if (dep && !seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

const view = (deck: DeckSeed, c: CardSeed, deckId: string) => ({
  id: `${deck.system}-${c.slug}`,
  deck_id: deckId,
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
  keywords_upright: c.keywords_upright,
  keywords_reversed: c.keywords_reversed,
  meaning_upright: c.meaning_upright,
  meaning_reversed: c.meaning_reversed,
});

function fixtureReading(deck: DeckSeed, slugs: string[]): ReadingView {
  const deckId = `00000000-0000-4000-8000-00000000000${deck.system === 'rws' ? 'a' : 'b'}`;
  const spread = SPREADS.find((s) => s.positions.length === slugs.length)!;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000002',
    created_at: '2026-09-12T10:00:00.000Z',
    occurred_at: '2026-09-12T10:00:00.000Z',
    question: 'Should I take the job?',
    is_open_reflection: false,
    life_area: 'work',
    spread_id: '00000000-0000-4000-8000-000000000003',
    deck_id: deckId,
    source: 'physical',
    uses_reversals: deck.supports_reversals,
    user_notes: 'My own words.',
    follow_up_status: 'unresolved',
    revisit_at: null,
    rng: null,
    metadata_version: 1,
    updated_at: '2026-09-12T10:00:00.000Z',
    deck: {
      id: deckId,
      slug: deck.slug,
      name: deck.name,
      system: deck.system,
      tradition_notes: deck.tradition_notes,
      supports_reversals: deck.supports_reversals,
      art_strategy: deck.art_strategy,
      license_note: deck.license_note,
      sort_order: deck.sort_order,
    },
    spread: {
      id: '00000000-0000-4000-8000-000000000003',
      user_id: null,
      slug: spread.slug,
      name: spread.name,
      description: spread.description,
      positions: spread.positions,
      layout: spread.layout,
      is_builtin: true,
      deck_scope: null,
      card_count: spread.positions.length,
      sort_order: 0,
    },
    cards: slugs.map((slug, i) => ({
      id: `rc-${i}`,
      position_index: i,
      position_key: spread.positions[i]!.key,
      orientation: i === 1 && deck.supports_reversals ? 'reversed' : 'upright',
      user_meaning: null,
      card: view(
        deck,
        deck.cards.find((c) => c.slug === slug)!,
        deckId,
      ),
      position: spread.positions[i]!,
    })),
  };
}

/** A PostgREST-shaped fake: records every table touched, returns the fixture for `readings`. */
function fakeClient(reading: ReadingView) {
  const tables: string[] = [];
  const rpcs: string[] = [];
  const row = {
    ...reading,
    decks: reading.deck,
    spreads: reading.spread,
    reading_cards: reading.cards.map((c) => ({
      id: c.id,
      position_index: c.position_index,
      position_key: c.position_key,
      orientation: c.orientation,
      user_meaning: c.user_meaning,
      cards: c.card,
    })),
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: [row], error: null }),
  };
  return {
    tables,
    rpcs,
    client: {
      from: (t: string) => {
        tables.push(t);
        return builder;
      },
      rpc: (name: string) => {
        rpcs.push(name);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

describe('opening-reading-makes-no-ai-call', () => {
  it('1 · nothing reachable from the reading routes, queries or detail screen imports src/ai/', () => {
    const graph = moduleGraph();
    expect(graph.size).toBeGreaterThan(20);
    const aiDir = path.resolve(ROOT, 'src/ai') + path.sep;
    const offenders = [...graph].filter((f) => f.startsWith(aiDir));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
    // Sanity: the scan does reach the query layer and the detail component.
    expect(graph.has(path.resolve(ROOT, 'src/db/queries/readings.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/ui/components/reading-detail.tsx'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/ui/components/card.tsx'))).toBe(true);
  });

  it('2 · reading the query layer touches only readings (embedded deck/spread/cards) and never the AI runner', async () => {
    const { getReading } = await import('@/db/queries/readings');
    const fixture = fixtureReading(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const fake = fakeClient(fixture);
    const result = await getReading(fake.client as never, fixture.id);
    expect(fake.tables).toEqual(['readings']);
    expect(fake.rpcs).toEqual([]);
    expect(result?.cards.map((c) => c.card.name)).toEqual(['Strength', 'The Tower', 'Ace of Cups']);
    expect(result?.cards[1]?.orientation).toBe('reversed');
    expect(result?.cards[1]?.position?.name).toBe('Present');
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it('3 · the detail screen renders a complete, useful reading from stored data alone', async () => {
    const { ReadingDetail } = await import('@/ui/components/reading-detail');
    for (const [deck, slugs] of [
      [RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']],
      [THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']],
    ] as const) {
      const reading = fixtureReading(deck, [...slugs]);
      const html = renderToStaticMarkup(
        <ReadingDetail
          reading={reading}
          justSaved
          slots={{ notes: null, followUp: null, revisit: null, controls: null }}
        />,
      );
      expect(html).toContain('Should I take the job?');
      expect(html).toContain('Not generated.');
      expect(html).toContain('part of your timeline');
      for (const c of reading.cards) {
        expect(html).toContain(c.card.name);
        expect(html).toContain(c.position!.name);
        // The reference meaning for the orientation is on the page, from the cards row.
        const meaning =
          c.orientation === 'reversed' && c.card.meaning_reversed
            ? c.card.meaning_reversed
            : c.card.meaning_upright;
        expect(html).toContain(escapeHtml(meaning.slice(0, 40)));
      }
      if (deck.system === 'thoth') {
        expect(html).not.toMatch(/Strength|Pentacles|\bPage\b/);
        expect(html).toContain('data-deck="thoth"');
      } else {
        expect(html).toContain('The Tower, reversed — Rider–Waite–Smith');
      }
    }
    expect(aiSpy).not.toHaveBeenCalled();
  });
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#x27;')
    .replace(/"/g, '&quot;');
}
