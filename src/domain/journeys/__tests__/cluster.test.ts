import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ObjectFeatures } from '../affinity';
import { classifyCluster, discoverClusters } from '../cluster';
import { CLUSTER_MIN_OBJECTS, CLUSTER_MIN_SPAN_DAYS, SUGGEST_MIN_AFFINITY } from '../thresholds';
import { placeholderTitle } from '../titles';

/**
 * Journey creation (docs/ALGORITHMS.md §2): the fixture arc yields exactly the expected
 * clusters; an `active` journey needs 3 objects across 14 days sharing an entity or a
 * theme pair — at exactly those numbers and not one less; a dismissed member set is not
 * re-suggested; placeholder titles come from what the cluster shares.
 */
const DAY = 86_400_000;
const T0 = Date.parse('2026-03-01T12:00:00Z');
const at = (day: number) => new Date(T0 + day * DAY).toISOString();
const obj = (
  id: string,
  day: number,
  o: Partial<Omit<ObjectFeatures, 'id' | 'occurredAt' | 'type'>> = {},
): ObjectFeatures => ({
  id,
  type: 'reading',
  occurredAt: at(day),
  entityIds: o.entityIds ?? [],
  themes: o.themes ?? [],
  question: o.question ?? null,
});

interface Arc {
  entities: Record<string, string>;
  objects: {
    id: string;
    day: number;
    question: string | null;
    entities: string[];
    themes: { slug: string; weight: number }[];
  }[];
  expectClusters: { members: string[]; status: 'active' | 'suggested'; sharedEntity?: string }[];
}
const arc = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'fixtures/history/journeys/journey-arcs.json'), 'utf8'),
) as Arc;
const arcObjects = arc.objects.map<ObjectFeatures>((o) => ({
  id: o.id,
  type: 'reading',
  occurredAt: at(o.day),
  entityIds: o.entities,
  themes: o.themes,
  question: o.question,
}));

describe('journey discovery', () => {
  it('finds the fixture arc’s journeys and nothing else', () => {
    const clusters = discoverClusters(arcObjects, {
      entityLabels: new Map(Object.entries(arc.entities)),
    });
    const got = clusters
      .map((c) => ({
        members: [...c.memberIds].sort(),
        status: c.status,
        sharedEntity: c.sharedEntityIds[0],
      }))
      .sort((a, b) => a.members[0]!.localeCompare(b.members[0]!));
    const want = arc.expectClusters
      .map((c) => ({
        members: [...c.members].sort(),
        status: c.status,
        sharedEntity: c.sharedEntity,
      }))
      .sort((a, b) => a.members[0]!.localeCompare(b.members[0]!));
    expect(got).toEqual(want);
    const maya = clusters.find((c) => c.sharedEntityIds[0] === 'maya')!;
    expect(maya.reasons).toContain('Every entry mentions Maya');
    expect(maya.reasons).toContain('It kept coming up over weeks, not days');
    for (const c of clusters) for (const r of c.reasons) expect(r).not.toMatch(/\d/);
    // r5 (a lone open reflection) is in no cluster.
    expect(clusters.some((c) => c.memberIds.includes('r5'))).toBe(false);
  });

  it('creates an active journey at exactly 3 objects over exactly 14 days, not at 2 or 13', () => {
    const shared = { entityIds: ['maya'], themes: [{ slug: 'trust', weight: 0.8 }] };
    const three = [
      obj('a', 0, shared),
      obj('b', 7, shared),
      obj('c', CLUSTER_MIN_SPAN_DAYS, shared),
    ];
    expect(three).toHaveLength(CLUSTER_MIN_OBJECTS);
    expect(discoverClusters(three).map((c) => c.status)).toEqual(['active']);
    const two = three.slice(0, 2);
    expect(discoverClusters(two).map((c) => c.status)).toEqual(['suggested']);
    const short = [
      obj('a', 0, shared),
      obj('b', 7, shared),
      obj('c', CLUSTER_MIN_SPAN_DAYS - 1, shared),
    ];
    expect(discoverClusters(short).map((c) => c.status)).toEqual(['suggested']);
    expect(discoverClusters([three[0]!])).toEqual([]);
  });

  it('needs a shared entity or a stable theme pair to be active; a theme-only single overlap is suggested', () => {
    const pair = {
      themes: [
        { slug: 'health', weight: 0.8 },
        { slug: 'stability', weight: 0.6 },
      ],
      question: 'Will the routine stick?',
    };
    const themePair = [obj('a', 0, pair), obj('b', 10, pair), obj('c', 20, pair)];
    expect(classifyCluster(themePair, 0.7).status).toBe('active');
    expect(classifyCluster(themePair, 0.7).sharedThemeSlugs.sort()).toEqual([
      'health',
      'stability',
    ]);
    const single = {
      themes: [{ slug: 'health', weight: 0.9 }],
      question: 'Will the routine stick?',
    };
    const themeOnly = [obj('a', 0, single), obj('b', 10, single), obj('c', 20, single)];
    expect(classifyCluster(themeOnly, 0.7).status).toBe('suggested');
  });

  it('a stable theme pair among other themes clears the suggestion floor; a lone shared theme never clusters', () => {
    const a = {
      themes: [
        { slug: 'health', weight: 0.8 },
        { slug: 'patience', weight: 0.65 },
        { slug: 'stability', weight: 0.65 },
      ],
    };
    const b = {
      themes: [
        { slug: 'stability', weight: 0.8 },
        { slug: 'change', weight: 0.65 },
        { slug: 'confidence', weight: 0.65 },
        { slug: 'health', weight: 0.65 },
      ],
    };
    const [c] = discoverClusters([obj('a', 0, a), obj('b', 42, b)]);
    expect(c?.status).toBe('suggested');
    expect(c?.meanAffinity).toBeGreaterThanOrEqual(SUGGEST_MIN_AFFINITY);
    expect(c?.meanAffinity).toBeLessThan(0.4);
    expect(c?.sharedThemeSlugs.sort()).toEqual(['health', 'stability']);
    expect(c?.reasons).toContain('Only two entries so far — a guess, not a pattern');
    // Both readings about exactly one shared theme: over the floor, but no pair → nothing.
    const lone = [
      obj('a', 0, { themes: [{ slug: 'health', weight: 0.9 }] }),
      obj('b', 30, { themes: [{ slug: 'health', weight: 0.9 }] }),
    ];
    expect(discoverClusters(lone)).toEqual([]);
    // Past the activity window the pair sinks under the floor.
    expect(discoverClusters([obj('a', 0, a), obj('b', 200, b)])).toEqual([]);
  });

  it('members must clear the pairwise floor against every current member', () => {
    const maya = { entityIds: ['maya'], themes: [{ slug: 'trust', weight: 0.8 }] };
    const other = { entityIds: ['sam'], themes: [{ slug: 'trust', weight: 0.8 }] };
    const objects = [
      obj('a', 0, maya),
      obj('b', 10, maya),
      obj('c', 20, maya),
      obj('d', 21, other),
    ];
    const clusters = discoverClusters(objects);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('a cluster inside a dismissed member set is not re-suggested; new evidence is', () => {
    const shared = { entityIds: ['maya'], themes: [{ slug: 'trust', weight: 0.8 }] };
    const objects = [obj('a', 0, shared), obj('b', 7, shared), obj('c', 20, shared)];
    expect(discoverClusters(objects, { dismissed: [['a', 'b', 'c']] })).toEqual([]);
    expect(discoverClusters(objects, { dismissed: [['a', 'b', 'c', 'z']] })).toEqual([]);
    const more = [...objects, obj('d', 30, shared)];
    expect(discoverClusters(more, { dismissed: [['a', 'b', 'c']] })).toHaveLength(1);
  });

  it('placeholder titles come from the shared entity, else the shared themes, else the top theme', () => {
    expect(
      placeholderTitle({
        sharedEntityLabels: ['Maya'],
        sharedThemeLabels: ['Trust'],
        topThemeLabels: [],
      }),
    ).toBe('Maya');
    expect(
      placeholderTitle({
        sharedEntityLabels: [],
        sharedThemeLabels: ['Health', 'Stability'],
        topThemeLabels: [],
      }),
    ).toBe('Health and stability');
    expect(
      placeholderTitle({
        sharedEntityLabels: [],
        sharedThemeLabels: [],
        topThemeLabels: ['Decision'],
      }),
    ).toBe('Decision');
    expect(
      placeholderTitle({ sharedEntityLabels: [], sharedThemeLabels: [], topThemeLabels: [] }),
    ).toBe('Untitled journey');
    expect(
      placeholderTitle({
        sharedEntityLabels: ['x'.repeat(200)],
        sharedThemeLabels: [],
        topThemeLabels: [],
      }).length,
    ).toBeLessThanOrEqual(80);
  });
});
