import { estimateTokens } from './bound';

/**
 * The evidence package (docs/ALGORITHMS.md §4 steps 4–6): what `answer_from_evidence` is
 * allowed to know, and nothing else. Each object gets a short label (`E1`, `E2`, …) the model
 * cites; the pipeline maps labels back to ids and strips anything that was not in the
 * package (step 7). What can be in here is a grade rule (spec §19, phase-08 notes):
 *
 *   - readings and life events are the user's own words (question / sentence, a short excerpt
 *     of the note) with derived labels marked as such;
 *   - outcomes are `CONFIRMED_FACT` and cited by the reading they are on;
 *   - a `confirmed` connection is the highest-grade evidence, a `maybe` may be cited *as*
 *     maybe, `pending` and `rejected` never appear;
 *   - entities are resolved ones only — a tentative mention is never rendered as a fact;
 *   - interpretations and summaries are never evidence of anything that happened.
 */

export const NOTE_EXCERPT_CHARS = 240;
export const CITEABLE_LINK_STATES = ['confirmed', 'maybe'] as const;
export type CiteableLinkState = (typeof CITEABLE_LINK_STATES)[number];

export interface EvidenceCard {
  name: string;
  orientation: 'upright' | 'reversed';
  position: string | null;
}

export interface EvidenceOutcome {
  status: string;
  note: string | null;
  recordedOn: string;
  /** The life event the user pointed at, if any. */
  eventTitle: string | null;
}

export interface EvidenceLink {
  otherType: 'reading' | 'life_event';
  otherId: string;
  otherTitle: string;
  otherDate: string;
  state: CiteableLinkState;
}

export interface EvidenceObject {
  id: string;
  type: 'reading' | 'life_event';
  /** ISO date (readings: the day of `occurred_at`). */
  date: string;
  /** The question or the event sentence; null for an open reflection. */
  title: string | null;
  noteExcerpt: string | null;
  lifeArea: string | null;
  eventType: string | null;
  deck: string | null;
  cards: EvidenceCard[];
  themes: string[];
  entities: string[];
  journeys: string[];
  possibilities: string[];
  timeframe: string | null;
  followUp: string | null;
  outcomes: EvidenceOutcome[];
  links: EvidenceLink[];
}

export interface LabelledEvidence extends EvidenceObject {
  label: string;
  rendered: string;
  tokens: number;
}

export interface EvidencePackage {
  objects: LabelledEvidence[];
  /** Ids ranked but dropped by the bound, in rank order. */
  droppedIds: { type: 'reading' | 'life_event'; id: string }[];
  tokens: number;
}

export function excerpt(text: string | null | undefined, max = NOTE_EXCERPT_CHARS): string | null {
  if (!text) return null;
  const c = text.replace(/\s+/g, ' ').trim();
  if (!c) return null;
  return c.length <= max ? c : `${c.slice(0, max - 1).trimEnd()}…`;
}

/** One evidence object as the prompt sees it. Derived fields are named as derived. */
export function renderEvidence(o: EvidenceObject, label: string): string {
  const lines: string[] = [];
  const kind = o.type === 'reading' ? 'Reading' : 'Life event';
  lines.push(
    `[${label}] ${kind} · ${o.date}${o.journeys.length ? ` · in: ${o.journeys.join('; ')}` : ''}`,
  );
  if (o.type === 'reading') {
    lines.push(`  Question: ${o.title ? `“${o.title}”` : 'none (open reflection)'}`);
    if (o.cards.length)
      lines.push(
        `  Cards (${o.deck ?? 'deck unknown'}): ${o.cards
          .map(
            (c) =>
              `${c.name}${c.orientation === 'reversed' ? ' reversed' : ''}${c.position ? ` as ${c.position}` : ''}`,
          )
          .join(', ')}`,
      );
  } else {
    lines.push(`  What happened: “${o.title ?? ''}”`);
    if (o.eventType) lines.push(`  Type (derived): ${o.eventType}`);
  }
  if (o.noteExcerpt) lines.push(`  Their note: “${o.noteExcerpt}”`);
  if (o.lifeArea) lines.push(`  Life area: ${o.lifeArea}`);
  if (o.themes.length) lines.push(`  Themes (derived): ${o.themes.join(', ')}`);
  if (o.entities.length) lines.push(`  Mentions: ${o.entities.join(', ')}`);
  if (o.possibilities.length)
    lines.push(`  Possibilities noted (derived, not facts): ${o.possibilities.join(' | ')}`);
  if (o.timeframe) lines.push(`  Timeframe in the question: ${o.timeframe}`);
  if (o.followUp) lines.push(`  Follow-up status: ${o.followUp.replace(/_/g, ' ')}`);
  for (const oc of o.outcomes)
    lines.push(
      `  Outcome recorded by the user (${oc.recordedOn}): ${oc.status.replace(/_/g, ' ')}${oc.note ? ` — “${oc.note}”` : ''}${oc.eventTitle ? ` — event: “${oc.eventTitle}”` : ''}`,
    );
  for (const l of o.links)
    lines.push(
      `  ${l.state === 'confirmed' ? 'Connection confirmed by the user' : 'Connection the user marked “maybe”'}: ${l.otherType === 'reading' ? 'reading' : 'event'} ${l.otherDate} “${l.otherTitle}”`,
    );
  return lines.join('\n');
}

export function labelEvidence(objects: readonly EvidenceObject[]): LabelledEvidence[] {
  return objects.map((o, i) => {
    const label = `E${i + 1}`;
    const rendered = renderEvidence(o, label);
    return { ...o, label, rendered, tokens: estimateTokens(rendered) };
  });
}

export function renderPackage(pkg: EvidencePackage): string {
  return pkg.objects.map((o) => o.rendered).join('\n\n');
}
