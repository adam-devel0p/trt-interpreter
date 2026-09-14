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
 *   - interpretations and summaries are never evidence of anything that happened. Phase 10
 *     lets a stored period summary travel with a package as *compression* of entries the
 *     bound left out (`summaries`, labelled after the objects and rendered as generated
 *     text); the verifier drops any claim that cites only summaries.
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

/** A stored period summary offered as compression (Phase 10), never as a record. */
export interface EvidenceSummary {
  id: string;
  kind: 'weekly' | 'monthly' | 'journey' | 'yearly';
  /** `YYYY-MM` / `YYYY-Www` / `YYYY`; null for a journey summary. */
  periodKey: string | null;
  periodStart: string;
  periodEnd: string;
  headline: string;
  claims: string[];
  /** How many entries the summary was generated from. */
  coversCount: number;
}

export interface LabelledSummary extends EvidenceSummary {
  label: string;
  rendered: string;
  tokens: number;
}

export interface EvidencePackage {
  objects: LabelledEvidence[];
  /** Ids ranked but dropped by the bound, in rank order. */
  droppedIds: { type: 'reading' | 'life_event'; id: string }[];
  tokens: number;
  /** Covering summaries appended after the objects (Phase 10); labels continue the sequence. */
  summaries?: LabelledSummary[];
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

export function renderSummaryEvidence(s: EvidenceSummary, label: string): string {
  const lines = [
    `[${label}] Summary written by the app for ${s.periodStart} to ${s.periodEnd} from ${s.coversCount} entries — generated text, not a record; cite it only alongside the entries themselves`,
    `  Headline: ${s.headline}`,
  ];
  for (const c of s.claims.slice(0, 6)) lines.push(`  Noted: ${c}`);
  return lines.join('\n');
}

/** Labels continue after the objects (`E25`…) so every label stays unique in the package. */
export function labelSummaries(
  summaries: readonly EvidenceSummary[],
  offset: number,
): LabelledSummary[] {
  return summaries.map((s, i) => {
    const label = `E${offset + i + 1}`;
    const rendered = renderSummaryEvidence(s, label);
    return { ...s, label, rendered, tokens: estimateTokens(rendered) };
  });
}

export function renderPackage(pkg: EvidencePackage): string {
  return [...pkg.objects, ...(pkg.summaries ?? [])].map((o) => o.rendered).join('\n\n');
}
