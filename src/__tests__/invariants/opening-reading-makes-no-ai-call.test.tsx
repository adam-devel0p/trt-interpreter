import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReadingView } from '@/db/queries/readings';
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import { fixtureInterpretation, fixtureReading } from '@/__tests__/fixtures/reading';

/**
 * Invariant (CLAUDE.md engineering rules, spec §19): opening a saved reading makes zero AI
 * calls. Generated artifacts are stored, never recomputed. Two layers:
 *   1. the module graph — nothing reachable from the reading routes, the reading query layer
 *      or the detail component imports `src/ai/`;
 *   2. runtime — with every AI entry point replaced by a spy that throws, the query layer's
 *      read and the detail screen's render both complete without touching it.
 * Since Phase 04 layer 2 also covers a reading *with* a stored interpretation: the
 * interpretation query reads one table, and the detail screen renders the stored layers.
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
  'src/ui/components/layered-interpretation.tsx',
  'src/ui/components/safety-resource-card.tsx',
  'src/db/queries/interpretations.ts',
  'src/db/queries/profile.ts',
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

/** A PostgREST-shaped fake: records every table touched, returns the fixture for each table. */
function fakeClient(reading: ReadingView, interpretation?: object) {
  const tables: string[] = [];
  const rpcs: string[] = [];
  let current: unknown[] = [];
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
    maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: current, error: null }),
  };
  return {
    tables,
    rpcs,
    client: {
      from: (t: string) => {
        tables.push(t);
        current =
          t === 'readings'
            ? [row]
            : t === 'interpretations' && interpretation
              ? [interpretation]
              : [];
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

  it('2b · reading a stored interpretation is one select on `interpretations`, no RPC, no runner', async () => {
    const { getInterpretationState } = await import('@/db/queries/interpretations');
    const fixture = fixtureReading(RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']);
    const stored = fixtureInterpretation(fixture);
    const fake = fakeClient(fixture, stored);
    const state = await getInterpretationState(fake.client as never, fixture.id);
    expect(fake.tables).toEqual(['interpretations']);
    expect(fake.rpcs).toEqual([]);
    expect(state.current?.id).toBe(stored.id);
    expect(state.current?.synthesis).toBe(stored.synthesis);
    expect(state.latest?.id).toBe(stored.id);
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

  it('4 · a reading with a stored interpretation renders every layer from the row, with the spy never called', async () => {
    const { ReadingDetail } = await import('@/ui/components/reading-detail');
    const { LayeredInterpretation } = await import('@/ui/components/layered-interpretation');
    for (const [deck, slugs] of [
      [RWS_DECK, ['strength', 'the-tower', 'ace-of-cups']],
      [THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']],
    ] as const) {
      const reading = fixtureReading(deck, [...slugs]);
      const stored = fixtureInterpretation(reading);
      const html = renderToStaticMarkup(
        <ReadingDetail
          reading={reading}
          slots={{
            notes: null,
            followUp: null,
            revisit: null,
            controls: null,
            interpretation: (
              <LayeredInterpretation
                layers={{
                  synthesis: stored.synthesis,
                  per_card: stored.per_card,
                  combined: stored.combined,
                  reflective_prompts: stored.reflective_prompts,
                }}
                cards={reading.cards.map((c) => ({
                  position_index: c.position_index,
                  positionName: c.position!.name,
                  cardName: c.card.name,
                  orientation: c.orientation,
                }))}
                meta={{
                  modelId: stored.model_id,
                  promptVersion: stored.prompt_version,
                  generatedAt: stored.generated_at,
                }}
              />
            ),
          }}
        />,
      );
      expect(html).not.toContain('Not generated.');
      expect(html).toContain('AI interpretation');
      expect(html).toContain(escapeHtml(stored.synthesis));
      for (const c of stored.per_card) expect(html).toContain(escapeHtml(c.text));
      expect(html).toContain(escapeHtml(stored.combined));
      for (const p of stored.reflective_prompts) expect(html).toContain(escapeHtml(p));
      expect(html).toContain('suggested');
      expect(html).toContain(stored.model_id);
      if (deck.system === 'thoth') expect(html).not.toMatch(/Pentacles|\bPage\b/);
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
