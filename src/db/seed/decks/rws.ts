import { deckSeedSchema, type DeckSeed } from '@/domain/decks/types';
import { RWS_MAJORS } from './rws-majors';
import { RWS_CUPS, RWS_WANDS } from './rws-wands-cups';
import { RWS_PENTACLES, RWS_SWORDS } from './rws-swords-pentacles';

/**
 * Rider–Waite–Smith (1909). Artwork is the public-domain Pamela Colman Smith deck, bundled at
 * `public/cards/rws/<slug>-{160,320,640}.{avif,webp}` (docs/LICENSING.md). Court is
 * Page / Knight / Queen / King; fourth suit is Pentacles.
 */
export const RWS_DECK: DeckSeed = deckSeedSchema.parse({
  slug: 'rws-classic',
  name: 'Rider–Waite–Smith',
  system: 'rws',
  tradition_notes:
    'The 1909 deck drawn by Pamela Colman Smith under Arthur Edward Waite. Every card, including the small cards, carries a scene, so much of its reading is pictorial. Strength is VIII and Justice XI. Reversals are commonly used; each card here carries a reversed meaning.',
  supports_reversals: true,
  art_strategy: 'bundled_public_domain',
  license_note:
    'Rider–Waite–Smith artwork (Pamela Colman Smith, first published 1909 by William Rider & Son, London) is in the public domain. Scans sourced from Wikimedia Commons and re-encoded to AVIF/WebP at three widths. No other deck art is bundled.',
  sort_order: 0,
  cards: [...RWS_MAJORS, ...RWS_WANDS, ...RWS_CUPS, ...RWS_SWORDS, ...RWS_PENTACLES].map((c) => ({
    ...c,
    art_asset_path: `/cards/rws/${c.slug}`,
  })),
});
