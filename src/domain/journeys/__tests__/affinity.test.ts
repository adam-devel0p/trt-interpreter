import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decideAssignment,
  pairAffinity,
  scoreAffinity,
  temporalActivity,
  tokenize,
  weightedJaccard,
  type ObjectFeatures,
} from '../affinity';
import {
  ACTIVE_DECAY_DAYS,
  ACTIVE_WINDOW_DAYS,
  AUTO_ASSIGN,
  PENDING,
  WEIGHTS,
} from '../thresholds';

/**
 * Affinity (docs/ALGORITHMS.md §2): the signal weights, the renormalisation of the
 * unavailable semantic signal, every threshold boundary, and the `fixtures/history/`
 * journey arc walked object by object.
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
  ...(o.embedding ? { embedding: o.embedding } : {}),
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
  assignments: {
    object: Arc['objects'][number];
    journey: string[];
    expect: 'auto' | 'pending' | 'none';
  }[];
}
const arc = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'fixtures/history/journeys/journey-arcs.json'), 'utf8'),
) as Arc;
const toFeatures = (o: Arc['objects'][number]): ObjectFeatures => ({
  id: o.id,
  type: 'reading',
  occurredAt: at(o.day),
  entityIds: o.entities,
  themes: o.themes,
  question: o.question,
});

describe('journey affinity', () => {
  it('weights sum to 1 and the semantic signal is renormalised out until vectors exist', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const a = obj('a', 0, { entityIds: ['e1'], themes: [{ slug: 'trust', weight: 1 }] });
    const b = obj('b', 1, { entityIds: ['e1'], themes: [{ slug: 'trust', weight: 1 }] });
    const r = scoreAffinity(a, { id: 'j', members: [b] });
    expect(r.available).not.toContain('semantic_similarity');
    // Every available signal at 1 (question is null on both → 0) scores as if the missing
    // weight were absent: (0.35 + 0.20 + 0.10) / 0.75.
    expect(r.score).toBeCloseTo((0.35 + 0.2 + 0.1) / 0.75, 3);
    const withVec = scoreAffinity(
      { ...a, embedding: [1, 0] },
      { id: 'j', members: [{ ...b, embedding: [1, 0] }] },
    );
    expect(withVec.available).toContain('semantic_similarity');
    expect(withVec.signals.semantic_similarity).toBeCloseTo(1, 6);
  });

  it('entity overlap is the overlap coefficient against the journey core; no entities scores 0', () => {
    const members = [
      obj('m1', 0, { entityIds: ['maya'] }),
      obj('m2', 5, { entityIds: ['maya', 'sam'] }),
      obj('m3', 9, { entityIds: ['maya'] }),
    ];
    const j = { id: 'j', members };
    // Sam appears in 1 of 3 — a passing mention, not core; Maya (3 of 3) is.
    const one = scoreAffinity(obj('x', 10, { entityIds: ['maya'] }), j);
    expect(one.signals.entity_overlap).toBe(1);
    // Naming Maya and someone else is still about Maya (overlap coefficient, not Jaccard).
    const both = scoreAffinity(obj('y', 10, { entityIds: ['maya', 'sam'] }), j);
    expect(both.signals.entity_overlap).toBe(1);
    const samOnly = scoreAffinity(obj('w', 10, { entityIds: ['sam'] }), j);
    expect(samOnly.signals.entity_overlap).toBe(0);
    const twoCore = scoreAffinity(obj('v', 10, { entityIds: ['maya'] }), {
      id: 'j2',
      members: [
        obj('m4', 0, { entityIds: ['maya', 'sam'] }),
        obj('m5', 3, { entityIds: ['maya', 'sam'] }),
      ],
    });
    expect(twoCore.signals.entity_overlap).toBe(1);
    const none = scoreAffinity(obj('z', 10), j);
    expect(none.signals.entity_overlap).toBe(0);
    expect(none.available).toContain('entity_overlap');
    expect(one.reasons).toContain('Both mention the same person or place');
    expect(
      scoreAffinity(obj('x', 10, { entityIds: ['maya'] }), j, {
        entityLabels: new Map([['maya', 'Maya']]),
      }).reasons,
    ).toContain('Both mention Maya');
  });

  it('theme overlap is the share of the object’s theme weight the journey carries; question similarity a token Jaccard', () => {
    const j3 = {
      id: 'j',
      members: [
        obj('m1', 0, { themes: [{ slug: 'trust', weight: 0.8 }] }),
        obj('m2', 5, {
          themes: [
            { slug: 'trust', weight: 0.6 },
            { slug: 'care', weight: 0.7 },
          ],
        }),
        obj('m3', 9, { themes: [{ slug: 'distance', weight: 0.5 }] }),
      ],
    };
    // trust carried by 2 of 3, care by 1 of 3: (0.6·2/3 + 0.3·1/3) / 0.9.
    const r = scoreAffinity(
      obj('x', 10, {
        themes: [
          { slug: 'trust', weight: 0.6 },
          { slug: 'care', weight: 0.3 },
        ],
      }),
      j3,
    );
    expect(r.signals.theme_overlap).toBeCloseTo((0.6 * (2 / 3) + 0.3 / 3) / 0.9, 6);
    expect(
      scoreAffinity(obj('y', 10, { themes: [{ slug: 'health', weight: 1 }] }), j3).signals
        .theme_overlap,
    ).toBe(0);
    expect(scoreAffinity(obj('z', 10), j3).signals.theme_overlap).toBe(0);
    expect(
      weightedJaccard(
        new Map([
          ['a', 1],
          ['b', 0.5],
        ]),
        new Map([
          ['a', 0.5],
          ['c', 0.5],
        ]),
      ),
    ).toBeCloseTo(0.25, 6);
    expect(tokenize('Should I take the job in Lisbon with my girlfriend?')).toEqual([
      'take',
      'job',
      'lisbon',
      'girlfriend',
    ]);
    const j = { id: 'j', members: [obj('m', 0, { question: 'Should I take the job in Lisbon?' })] };
    const same = scoreAffinity(obj('x', 1, { question: 'Take the Lisbon job?' }), j);
    expect(same.signals.question_similarity).toBe(1);
    const near = scoreAffinity(
      obj('x2', 1, { question: 'Take the Lisbon job or the Porto one?' }),
      j,
    );
    expect(near.signals.question_similarity).toBeCloseTo(3 / 5, 6);
    expect(same.reasons.some((r) => r.startsWith('Asks something close'))).toBe(true);
    const other = scoreAffinity(obj('y', 1, { question: 'What does autumn hold?' }), j);
    expect(other.signals.question_similarity).toBe(0);
  });

  it('temporal activity: 1 inside the window, linear to 0 across the decay span', () => {
    const dates = [T0];
    expect(temporalActivity(at(ACTIVE_WINDOW_DAYS), dates)).toBe(1);
    expect(temporalActivity(at(-ACTIVE_WINDOW_DAYS), dates)).toBe(1);
    expect(temporalActivity(at(ACTIVE_WINDOW_DAYS + ACTIVE_DECAY_DAYS / 2), dates)).toBeCloseTo(
      0.5,
      6,
    );
    expect(temporalActivity(at(ACTIVE_WINDOW_DAYS + ACTIVE_DECAY_DAYS), dates)).toBe(0);
    expect(temporalActivity(at(1000), dates)).toBe(0);
    expect(temporalActivity(at(0), [])).toBe(0);
  });

  it('decides auto at ≥ 0.70, pending at ≥ 0.50, nothing below — at the exact boundaries', () => {
    expect(decideAssignment(AUTO_ASSIGN)).toBe('auto');
    expect(decideAssignment(AUTO_ASSIGN - 0.001)).toBe('pending');
    expect(decideAssignment(PENDING)).toBe('pending');
    expect(decideAssignment(PENDING - 0.001)).toBe('none');
    expect(decideAssignment(0)).toBe('none');
    expect(decideAssignment(1)).toBe('auto');
  });

  it('a shared entity plus activity alone is a pending suggestion; with a shared theme it auto-assigns', () => {
    const j = {
      id: 'j',
      members: [obj('m', 0, { entityIds: ['maya'], themes: [{ slug: 'trust', weight: 0.8 }] })],
    };
    const bare = scoreAffinity(obj('x', 10, { entityIds: ['maya'] }), j);
    // (0.35 + 0.10) / 0.75 = 0.60 → pending.
    expect(bare.score).toBeCloseTo(0.6, 3);
    expect(decideAssignment(bare.score)).toBe('pending');
    const themed = scoreAffinity(
      obj('y', 10, { entityIds: ['maya'], themes: [{ slug: 'trust', weight: 0.8 }] }),
      j,
    );
    expect(decideAssignment(themed.score)).toBe('auto');
    // Themes alone, however strong, never reach auto without an entity or a question.
    const themesOnly = scoreAffinity(obj('z', 10, { themes: [{ slug: 'trust', weight: 0.8 }] }), j);
    expect(themesOnly.score).toBeCloseTo((0.2 + 0.1) / 0.75, 3);
    expect(decideAssignment(themesOnly.score)).toBe('none');
  });

  it('pair affinity is symmetric', () => {
    const a = obj('a', 0, {
      entityIds: ['e1', 'e2'],
      themes: [{ slug: 'x', weight: 0.9 }],
      question: 'Should I move?',
    });
    const b = obj('b', 30, {
      entityIds: ['e1'],
      themes: [
        { slug: 'x', weight: 0.4 },
        { slug: 'y', weight: 0.5 },
      ],
      question: 'Move or stay?',
    });
    expect(pairAffinity(a, b).score).toBe(pairAffinity(b, a).score);
    expect(pairAffinity(a, b).signals).toEqual(pairAffinity(b, a).signals);
  });

  it('reasons are sentences without numbers', () => {
    const j = {
      id: 'j',
      members: [
        obj('m', 0, {
          entityIds: ['maya'],
          themes: [{ slug: 'trust', weight: 0.8 }],
          question: 'How is it with Maya?',
        }),
      ],
    };
    const r = scoreAffinity(
      obj('x', 3, {
        entityIds: ['maya'],
        themes: [{ slug: 'trust', weight: 0.8 }],
        question: 'How is it going with Maya now?',
      }),
      j,
      {
        entityLabels: new Map([['maya', 'Maya']]),
        themeLabels: new Map([['trust', 'Trust']]),
      },
    );
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    for (const s of r.reasons) expect(s).not.toMatch(/\d/);
    expect(r.reasons).toContain('Shares the theme Trust');
    expect(r.reasons).toContain('Happened while this was active');
  });

  it('walks the fixture arc: every assignment expectation holds', () => {
    const byId = new Map(arc.objects.map((o) => [o.id, toFeatures(o)]));
    const labels = new Map(Object.entries(arc.entities));
    for (const a of arc.assignments) {
      const members = a.journey.map((id) => byId.get(id)!);
      const r = scoreAffinity(toFeatures(a.object), { id: 'j', members }, { entityLabels: labels });
      expect(
        decideAssignment(r.score),
        `${a.object.id} → ${a.journey.join(',')} scored ${r.score}`,
      ).toBe(a.expect);
    }
  });
});
