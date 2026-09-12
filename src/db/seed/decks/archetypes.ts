import type { Arcana, CardSeed, DeckSystem, Suit } from '@/domain/decks/types';
import { ROMAN } from './_builders';

/**
 * Structural archetypes — METADATA ONLY (§6.7). 78 slots shared by every deck so search,
 * analytics and cross-deck aggregation can group "the same position" without ever pretending
 * the cards are the same. Render paths must never resolve a name, title or meaning through
 * these; `thoth-never-substitutes-rws.test.ts` checks the seed and the source tree for it.
 *
 * Labels are deliberately neutral ("Major VIII", "Two of the earth suit"): no deck's name for
 * the slot is promoted to the label.
 */
export interface ArchetypeSeed {
  key: string;
  label: string;
  arcana: Arcana;
  suit_slot: 'fire' | 'water' | 'air' | 'earth' | null;
  rank_slot: string | null;
  number: number | null;
  sort_order: number;
}

const SUIT_SLOT: Record<Suit, 'fire' | 'water' | 'air' | 'earth'> = {
  wands: 'fire',
  cups: 'water',
  swords: 'air',
  pentacles: 'earth',
  disks: 'earth',
};
const SLOT_ORDER = ['fire', 'water', 'air', 'earth'] as const;
const COURT_LABEL = [
  'lowest court rank',
  'second court rank',
  'third court rank',
  'highest court rank',
];
const PIP_LABEL = [
  '',
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];

export const ARCHETYPES: ArchetypeSeed[] = [
  ...Array.from({ length: 22 }, (_, n) => ({
    key: `major.${String(n).padStart(2, '0')}`,
    label: `Major ${ROMAN[n]}`,
    arcana: 'major' as const,
    suit_slot: null,
    rank_slot: null,
    number: n,
    sort_order: n,
  })),
  ...SLOT_ORDER.flatMap((slot, si) => [
    ...Array.from({ length: 10 }, (_, i) => ({
      key: `minor.${slot}.${String(i + 1).padStart(2, '0')}`,
      label: `${PIP_LABEL[i + 1]} of the ${slot} suit`,
      arcana: 'minor' as const,
      suit_slot: slot,
      rank_slot: String(i + 1),
      number: i + 1,
      sort_order: 22 + si * 14 + i,
    })),
    ...Array.from({ length: 4 }, (_, r) => ({
      key: `minor.${slot}.court_${r + 1}`,
      label: `${slot[0]!.toUpperCase()}${slot.slice(1)} suit, ${COURT_LABEL[r]}`,
      arcana: 'minor' as const,
      suit_slot: slot,
      rank_slot: `court_${r + 1}`,
      number: null,
      sort_order: 22 + si * 14 + 10 + r,
    })),
  ]),
];

/** Court rank → structural court slot (1 = lowest … 4 = highest), per deck. */
const COURT_RANK: Record<DeckSystem, Record<string, number>> = {
  rws: { Page: 1, Knight: 2, Queen: 3, King: 4 },
  thoth: { Princess: 1, Prince: 2, Queen: 3, Knight: 4 },
};

/** The one slot a card belongs to. Pure structure: number, suit element, court rank. */
export function archetypeKeyFor(system: DeckSystem, card: CardSeed): string {
  if (card.arcana === 'major') return `major.${String(card.number).padStart(2, '0')}`;
  const slot = SUIT_SLOT[card.suit!];
  if (card.rank_label) {
    const r = COURT_RANK[system][card.rank_label];
    if (!r) throw new Error(`unknown ${system} court rank ${card.rank_label}`);
    return `minor.${slot}.court_${r}`;
  }
  return `minor.${slot}.${String(card.number).padStart(2, '0')}`;
}

const MAJOR_NOTES: Record<number, string> = {
  1: 'Structural slot only: RWS "The Magician" and Thoth "The Magus" share number I; names and imagery differ.',
  2: 'Structural slot only: RWS "The High Priestess" and Thoth "The Priestess" share number II.',
  8: 'Structural slot only: RWS "Strength" and Thoth "Lust" share number VIII by position, not meaning. Thoth reads Lust as rapture in force, not restraint of it.',
  10: 'Structural slot only: RWS "Wheel of Fortune" and Thoth "Fortune" share number X.',
  11: 'Structural slot only: RWS "Justice" and Thoth "Adjustment" share number XI. Adjustment is continuous equilibrium, not verdict.',
  14: 'Structural slot only: RWS "Temperance" and Thoth "Art" share number XIV. Art is the completed alchemical marriage, not moderation.',
  20: 'Structural slot only: RWS "Judgement" and Thoth "The Aeon" share number XX. The Aeon is a change of aeon, not a last judgement.',
  21: 'Structural slot only: RWS "The World" and Thoth "The Universe" share number XXI.',
};

const RWS_COURT_NOTE: Record<string, string> = {
  Page: 'Structural: RWS Page occupies the lowest court rank, as the Thoth Princess does. Different figures, different meanings.',
  Knight:
    'Structural: RWS Knight occupies the second court rank, as the Thoth Prince does. The Thoth Knight is a different card (highest rank).',
  King: 'Structural: RWS King occupies the highest court rank, as the Thoth Knight does. Not the same figure.',
};
const THOTH_COURT_NOTE: Record<string, string> = {
  Princess:
    'Structural: Thoth Princess occupies the lowest court rank, as the RWS Page does. Different figures, different meanings.',
  Prince:
    'Structural: Thoth Prince occupies the second court rank, as the RWS Knight does. Not the same figure as the RWS Knight of this suit.',
  Knight:
    'Structural: Thoth Knight is the highest court rank (mounted), corresponding in position to the RWS King, not the RWS Knight.',
};

/** Explains why a mapping is structural, not interpretive. Null where the slot is uncontroversial. */
export function mappingNoteFor(system: DeckSystem, card: CardSeed): string | null {
  if (card.arcana === 'major') return MAJOR_NOTES[card.number!] ?? null;
  const parts: string[] = [];
  if (card.suit === 'disks')
    parts.push(
      'Structural: Thoth Disks share the earth slot with RWS Pentacles; the suit is not renamed.',
    );
  if (card.suit === 'pentacles')
    parts.push(
      'Structural: RWS Pentacles share the earth slot with Thoth Disks; the suit is not renamed.',
    );
  if (card.rank_label) {
    const note = (system === 'rws' ? RWS_COURT_NOTE : THOTH_COURT_NOTE)[card.rank_label];
    if (note) parts.push(note);
  }
  return parts.length ? parts.join(' ') : null;
}
