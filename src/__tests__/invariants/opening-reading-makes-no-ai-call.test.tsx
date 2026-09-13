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
  // Phase 05: the journal, the profile's export/delete controls, the export route and the
  // purge/export jobs the delete and export actions reach.
  'app/(app)/journal',
  'app/(app)/profile',
  'app/api/exports',
  'src/db/queries/journal.ts',
  'src/db/queries/exports.ts',
  'src/ui/components/timeline-item.tsx',
  'src/ui/components/note-history.tsx',
  'src/export/build.ts',
  'src/privacy/purge.ts',
  'src/privacy/aiArtifacts.ts',
  // The registry and the handlers the reading/journal/export paths run; the AI-backed
  // handlers are reached only through the registry's lazy import (asserted below).
  'src/jobs/handlers/index.ts',
  'src/jobs/handlers/purge-deleted.ts',
  'src/jobs/handlers/export-user-data.ts',
  'src/jobs/handlers/noop-echo.ts',
  'src/jobs/handlers/payloads.ts',
  // Phase 06: the memory read path, corrections and the entities pages.
  'app/api/readings/[id]/memory',
  'src/db/queries/memory.ts',
  'src/memory/corrections.ts',
  'src/memory/materialize.ts',
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
  // Phase 07: the journey pages, actions and query layer, and the assignment step the
  // materialiser runs. Naming (`propose_journey`) is reached only through the lazy registry.
  'app/(app)/journey',
  'src/db/queries/journeys.ts',
  'src/journeys/materialize.ts',
  'src/journeys/refresh.ts',
  'src/ui/components/journey-timeline.tsx',
  'src/ui/components/theme-progression.tsx',
  'src/ui/components/recurring-symbols.tsx',
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

/**
 * The one sanctioned lazy edge: the job registry loads the AI-backed handlers (extraction,
 * reprocessing) with a dynamic `import()` only when the worker claims a job of that kind.
 * Nothing on a reading, journal or export path executes them. Every other dynamic import is
 * followed like a static one.
 */
const LAZY_REGISTRY = path.resolve(ROOT, 'src/jobs/handlers/index.ts');

/** Every file transitively imported from the entry points (source-level, first-party only). */
function moduleGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = ENTRY_POINTS.flatMap(listFiles);
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(from|import)\s*(\(?)\s*['"]([^'"]+)['"]/g)) {
      const dynamic = m[1] === 'import' && m[2] === '(';
      if (dynamic && f === LAZY_REGISTRY) continue;
      const dep = resolveImport(f, m[3]!);
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
    expect(graph.has(path.resolve(ROOT, 'src/db/queries/journal.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/export/build.ts'))).toBe(true);
    // Phase 06: the memory read path and corrections are on the graph and AI-free; the
    // extraction run is not (only the lazy registry edge reaches it).
    expect(graph.has(path.resolve(ROOT, 'src/db/queries/memory.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/memory/materialize.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/memory/extract.ts'))).toBe(false);
    expect(graph.has(path.resolve(ROOT, 'src/jobs/handlers/extract-reading.ts'))).toBe(false);
    // Phase 07: assignment, discovery and refresh are on the graph and AI-free; naming is not.
    expect(graph.has(path.resolve(ROOT, 'src/journeys/assign.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/journeys/discover.ts'))).toBe(true);
    expect(graph.has(path.resolve(ROOT, 'src/journeys/propose.ts'))).toBe(false);
    expect(graph.has(path.resolve(ROOT, 'src/jobs/handlers/propose-journey.ts'))).toBe(false);
    const registry = readFileSync(LAZY_REGISTRY, 'utf8');
    expect(registry).not.toMatch(
      /^import .*(extract-reading|reprocess-extractions|propose-journey)/m,
    );
  });

  it('1b · the journal search is one RPC + embed, no model; the timeline renders from stored rows', async () => {
    const { searchJournal } = await import('@/db/queries/journal');
    const { TimelineItem } = await import('@/ui/components/timeline-item');
    const fixture = fixtureReading(THOTH_DECK, ['lust', 'the-universe', 'princess-of-disks']);
    const tables: string[] = [];
    const rpcs: string[] = [];
    const row = {
      id: fixture.id,
      occurred_at: fixture.occurred_at,
      updated_at: fixture.updated_at,
      question: fixture.question,
      is_open_reflection: false,
      life_area: null,
      source: 'physical',
      follow_up_status: 'unresolved',
      revisit_at: null,
      user_notes: 'my own words',
      decks: {
        id: fixture.deck.id,
        slug: fixture.deck.slug,
        name: fixture.deck.name,
        system: 'thoth',
      },
      spreads: { id: fixture.spread.id, name: fixture.spread.name, card_count: 3 },
      reading_cards: fixture.cards.map((c) => ({
        position_index: c.position_index,
        orientation: c.orientation,
        cards: c.card,
      })),
      interpretations: [
        { synthesis: 'old', status: 'complete', superseded_by: 'x' },
        { synthesis: 'current synthesis', status: 'complete', superseded_by: null },
      ],
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown) => void) => resolve({ data: [row], error: null }),
    };
    const client = {
      from: (t: string) => {
        tables.push(t);
        return {
          ...builder,
          then: (r: (v: unknown) => void) => r({ data: [], error: null, count: 0 }),
        };
      },
      rpc: (name: string) => {
        rpcs.push(name);
        return builder;
      },
    };
    const page = await searchJournal(client as never, {
      q: '',
      from: null,
      to: null,
      deck: null,
      spread: null,
      entity: null,
      journey: null,
      source: null,
      followUp: null,
      hasNotes: null,
      hasInterpretation: null,
      sort: 'newest',
    });
    expect(rpcs).toEqual(['search_readings']);
    expect(tables).toEqual([]);
    expect(page.items[0]?.synthesis).toBe('current synthesis');
    const html = renderToStaticMarkup(<TimelineItem item={page.items[0]!} />);
    expect(html).toContain('current synthesis');
    expect(html).toContain('Lust');
    expect(html).not.toMatch(/Strength|Pentacles|Rider/);
    expect(aiSpy).not.toHaveBeenCalled();
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
