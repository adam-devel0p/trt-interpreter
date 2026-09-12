import { deckSeedSchema, type DeckSeed } from '@/domain/decks/types';
import { THOTH_MAJORS } from './thoth-majors';
import { THOTH_CUPS, THOTH_WANDS } from './thoth-wands-cups';
import { THOTH_DISKS, THOTH_SWORDS } from './thoth-swords-disks';

/**
 * Thoth (Crowley / Harris, 1944). Deck-native throughout: Atu names, Knight / Queen / Prince /
 * Princess court, Disks, small-card titles, Qabalistic and astrological correspondences from
 * *The Book of Thoth*. No artwork is bundled (docs/LICENSING.md); `art_strategy = 'text_only'`
 * and the renderer uses the typographic treatment. Reversals are not part of the practice: the
 * deck reads by dignity and position, so `supports_reversals` is false and reversed meanings
 * are null.
 */
export const THOTH_DECK: DeckSeed = deckSeedSchema.parse({
  slug: 'thoth',
  name: 'Thoth',
  system: 'thoth',
  tradition_notes:
    'Designed by Aleister Crowley and painted by Lady Frieda Harris (1938–1943, published 1944). The trumps are called Atu and several carry Crowley’s names — Adjustment, Lust, Art, The Aeon, The Universe. The court is Knight, Queen, Prince and Princess; the earth suit is Disks. Small cards are read by their titles and their decan and sephira. The deck is traditionally read by elemental dignity and position rather than by reversal.',
  supports_reversals: false,
  art_strategy: 'text_only',
  license_note:
    'Lady Frieda Harris’s paintings remain under copyright (Ordo Templi Orientis / the Harris estate). No scans or reproductions are bundled. Cards are rendered as a designed typographic treatment; the schema leaves art_asset_path open for licensed or commissioned art per card.',
  sort_order: 1,
  cards: [...THOTH_MAJORS, ...THOTH_WANDS, ...THOTH_CUPS, ...THOTH_SWORDS, ...THOTH_DISKS],
});
