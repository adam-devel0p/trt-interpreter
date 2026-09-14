import { fnv1a } from '../extraction/hash';

/**
 * Retrieval documents (spec §8.3, docs/ALGORITHMS.md §4). One compact, deterministic text per
 * object, built from a template — never model prose, never the user's notes. It is the only
 * thing the embedding provider ever sees (docs/PRIVACY_AND_DELETION.md), so what goes in
 * here is a privacy decision as much as a retrieval one: the question or the event
 * sentence (the user's own words, short by construction), derived labels, deck-native card
 * names, canonical entity labels, and the user's own outcome in a few words.
 *
 * Compact by design (§13): every list is capped and the whole text is capped; over the cap,
 * whole trailing segments are dropped, never a segment mid-way, and the object's own words
 * are never dropped. `content_hash` is over the text, so an unchanged document is never
 * re-embedded.
 */

export const BUILDER_VERSION = 'retrieval_document/1.1.0';

export const DOCUMENT_MAX_CHARS = 700;
export const DOCUMENT_TEXT_MAX_CHARS = 200;
export const DOCUMENT_MAX_THEMES = 6;
export const DOCUMENT_MAX_CARDS = 10;
export const DOCUMENT_MAX_ENTITIES = 6;
export const DOCUMENT_MAX_POSSIBILITIES = 2;
export const DOCUMENT_MAX_LINKED = 2;
export const DOCUMENT_MAX_HIGHLIGHTS = 4;
export const DOCUMENT_ITEM_MAX_CHARS = 100;

export type DocumentObjectType = 'reading' | 'life_event' | 'period_summary';

export interface DocumentCard {
  /** Deck-native name (Thoth "Lust", never "Strength"). */
  name: string;
  orientation?: 'upright' | 'reversed';
}

export interface DocumentInput {
  objectType: DocumentObjectType;
  /** Titles of the journeys the object is a live member of. */
  journeys: readonly string[];
  /** The question, the event sentence, or a summary's headline. Null for an open reflection. */
  text: string | null;
  lifeArea: string | null;
  /** Life events only: the promoted type's label. */
  eventType?: string | null;
  /** Theme labels, strongest first. */
  themes: readonly string[];
  /** Readings only: the deck's display name and the drawn cards in position order. */
  deck?: string | null;
  cards?: readonly DocumentCard[];
  /** Canonical labels of resolved (`auto` / `user`) entities — never tentative ones. */
  entities: readonly string[];
  possibilities?: readonly string[];
  timeframe?: string | null;
  /** The user's own record of what happened, in a few words. */
  outcome?: string | null;
  /** One line each for objects linked by a user-confirmed connection. */
  linked?: readonly string[];
  /** Period summaries only (Phase 10): the verified claim texts, generated prose. */
  highlights?: readonly string[];
}

export interface RetrievalDocument {
  text: string;
  contentHash: string;
  builderVersion: string;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clip(s: string, max: number): string {
  const c = clean(s);
  if (c.length <= max) return c;
  const cut = c.slice(0, max - 1);
  const atSpace = cut.lastIndexOf(' ');
  return `${(atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut).trimEnd()}…`;
}

function list(items: readonly string[], max: number, itemMax = DOCUMENT_ITEM_MAX_CHARS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const item = clip(raw, itemMax);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

const OPEN_REFLECTION = 'Open reflection, no question';
const SUMMARY_FALLBACK = 'Period summary';

/** Builds the document. Pure and deterministic: the same input always yields the same text. */
export function buildRetrievalDocument(input: DocumentInput): RetrievalDocument {
  const own =
    input.text && clean(input.text)
      ? clip(input.text, DOCUMENT_TEXT_MAX_CHARS)
      : input.objectType === 'reading'
        ? OPEN_REFLECTION
        : input.objectType === 'period_summary'
          ? SUMMARY_FALLBACK
          : '';
  const head = [list(input.journeys, 3, 80).join(' / '), own.replace(/[.!?…]+$/, '')]
    .filter(Boolean)
    .join('. ');

  // Ordered by how much each segment is worth to retrieval; trailing ones go first when over cap.
  const segments: string[] = [];
  if (input.objectType === 'life_event' && input.eventType)
    segments.push(`Event: ${clip(input.eventType, 40)}`);
  if (input.lifeArea) segments.push(`Life area: ${clip(input.lifeArea, 40)}`);
  const themes = list(input.themes, DOCUMENT_MAX_THEMES, 40);
  if (themes.length) segments.push(`Themes: ${themes.join(', ')}`);
  const cards = list(
    (input.cards ?? []).map((c) =>
      c.orientation === 'reversed' ? `${c.name} (reversed)` : c.name,
    ),
    DOCUMENT_MAX_CARDS,
    60,
  );
  if (cards.length)
    segments.push(`Cards${input.deck ? ` (${clip(input.deck, 40)})` : ''}: ${cards.join(', ')}`);
  const entities = list(input.entities, DOCUMENT_MAX_ENTITIES, 60);
  if (entities.length) segments.push(`Entities: ${entities.join(', ')}`);
  const possibilities = list(input.possibilities ?? [], DOCUMENT_MAX_POSSIBILITIES);
  for (const p of possibilities) segments.push(`Possibility: ${p.replace(/[.!?…]+$/, '')}`);
  if (input.timeframe) segments.push(`Timeframe: ${clip(input.timeframe, 60)}`);
  if (input.outcome) segments.push(`Outcome: ${clip(input.outcome, 120).replace(/[.!?…]+$/, '')}`);
  const linked = list(input.linked ?? [], DOCUMENT_MAX_LINKED);
  for (const l of linked) segments.push(`Linked: ${l.replace(/[.!?…]+$/, '')}`);
  const highlights = list(input.highlights ?? [], DOCUMENT_MAX_HIGHLIGHTS, 160);
  for (const h of highlights) segments.push(`Highlight: ${h.replace(/[.!?…]+$/, '')}`);

  let text = [head, ...segments].filter(Boolean).join('. ') + '.';
  while (text.length > DOCUMENT_MAX_CHARS && segments.length > 0) {
    segments.pop();
    text = [head, ...segments].filter(Boolean).join('. ') + '.';
  }
  if (text.length > DOCUMENT_MAX_CHARS) text = clip(text, DOCUMENT_MAX_CHARS);
  return {
    text,
    contentHash: fnv1a(`${BUILDER_VERSION}|${text}`),
    builderVersion: BUILDER_VERSION,
  };
}
