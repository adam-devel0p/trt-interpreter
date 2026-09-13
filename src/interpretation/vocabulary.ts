/**
 * Deck-purity vocabulary from the seed modules (pure data; src/ai/ may not import db/, so the
 * banned list is built here and handed to the task).
 */
import { RWS_DECK } from '@/db/seed/decks/rws';
import { THOTH_DECK } from '@/db/seed/decks/thoth';
import { bannedTerms, deckVocabulary, type BannedTerm } from '@/domain/decks/purity';
import type { DeckSystem } from '@/domain/decks/types';

const cache = new Map<DeckSystem, BannedTerm[]>();

export function bannedTermsFor(system: DeckSystem): BannedTerm[] {
  const hit = cache.get(system);
  if (hit) return hit;
  const rws = deckVocabulary(RWS_DECK);
  const thoth = deckVocabulary(THOTH_DECK);
  const list = system === 'thoth' ? bannedTerms(thoth, rws) : bannedTerms(rws, thoth);
  cache.set(system, list);
  return list;
}

/** A short, human-readable subset for the prompt (the validator uses the full list). */
export function forbiddenTermsSample(system: DeckSystem): string[] {
  const list = bannedTermsFor(system).map((t) => t.term.toLowerCase());
  const priority =
    system === 'thoth'
      ? [
          'pentacles',
          'page',
          'strength',
          'justice',
          'temperance',
          'judgement',
          'the world',
          'the magician',
          'the high priestess',
          'wheel of fortune',
          'rider–waite–smith',
        ]
      : [
          'disks',
          'prince',
          'princess',
          'lust',
          'adjustment',
          'art',
          'the aeon',
          'the universe',
          'the magus',
          'fortune',
          'thoth',
        ];
  return priority.filter((p) => list.includes(p));
}
