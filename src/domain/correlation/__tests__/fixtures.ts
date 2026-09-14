import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hashEmbedding } from '../../retrieval/hashEmbedding';
import type { CorrelationObject, Provenance } from '../score';

/** The hand-labelled pairs in `fixtures/history/correlation/labeled-pairs.json`. */
export interface LabeledObject {
  at: string;
  entities: (string | { id: string; tentative?: boolean; provenance?: Provenance })[];
  themes: [string, number, Provenance?][];
  journeys: string[];
  horizon?: { start: string; end: string; text: string | null };
  cards?: string[];
  /** Phase 09: the object's retrieval document; when present both sides carry a vector. */
  text?: string;
}
export interface LabeledPair {
  id: string;
  related: boolean;
  note: string;
  reading: LabeledObject;
  event: LabeledObject;
}

export function loadLabeledPairs(): LabeledPair[] {
  const file = path.resolve('fixtures/history/correlation/labeled-pairs.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { pairs: LabeledPair[] }).pairs;
}

export function toObject(
  id: string,
  type: 'reading' | 'life_event',
  o: LabeledObject,
): CorrelationObject {
  return {
    id,
    type,
    occurredAt: `${o.at}T12:00:00.000Z`,
    entities: o.entities.map((e) =>
      typeof e === 'string'
        ? { id: e, resolution: 'auto' as const }
        : {
            id: e.id,
            resolution: e.tentative ? ('tentative' as const) : ('auto' as const),
            provenance: e.provenance,
          },
    ),
    themes: o.themes.map(([slug, weight, provenance]) => ({ slug, weight, provenance })),
    journeys: o.journeys.map((j) => ({ id: j, state: 'auto' as const })),
    ...(o.text ? { embedding: hashEmbedding(o.text) } : {}),
    ...(type === 'reading'
      ? { cards: o.cards ?? ['c1', 'c2', 'c3'], horizon: o.horizon ?? null }
      : {}),
  };
}

/** Precision / recall of "shown" (band ≠ hidden) against the labels. */
export function scoreLabels(results: { id: string; related: boolean; shown: boolean }[]): {
  precision: number;
  recall: number;
  wrongShown: string[];
  missed: string[];
} {
  const tp = results.filter((r) => r.shown && r.related).length;
  const fp = results.filter((r) => r.shown && !r.related);
  const fn = results.filter((r) => !r.shown && r.related);
  return {
    precision: tp + fp.length === 0 ? 1 : tp / (tp + fp.length),
    recall: tp + fn.length === 0 ? 1 : tp / (tp + fn.length),
    wrongShown: fp.map((r) => r.id),
    missed: fn.map((r) => r.id),
  };
}
