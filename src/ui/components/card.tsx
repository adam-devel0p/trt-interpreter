import * as React from 'react';
import { astrologyGlyphs, ELEMENT_SIGIL, hebrewLetter, SUIT_GLYPH } from '@/domain/decks/glyphs';
import type { CardView } from '@/domain/decks/types';
import { cn } from '../lib/cn';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';
export type Orientation = 'upright' | 'reversed';

export const ART_WIDTHS = [160, 320, 640] as const;

/** Bundled art lives at `${art_asset_path}-{w}.{avif,webp}` (scripts/build-card-art.ts). */
export function artSrcSet(path: string, ext: 'avif' | 'webp'): string {
  return ART_WIDTHS.map((w) => `${path}-${w}.${ext} ${w}w`).join(', ');
}

const SIZE_CLASS: Record<CardSize, string> = {
  xs: 'w-12',
  sm: 'w-[4.5rem]',
  md: 'w-[7.5rem]',
  lg: 'w-[12.5rem]',
};
const SIZE_PX: Record<CardSize, string> = { xs: '48px', sm: '72px', md: '120px', lg: '200px' };

export interface CardProps {
  card: CardView;
  orientation?: Orientation;
  size?: CardSize;
  /** Show the name (and orientation) as a caption under the card. */
  caption?: boolean;
  /** Skeleton state: same footprint, no content. */
  loading?: boolean;
  /** Eager-load the art (above the fold). */
  priority?: boolean;
  className?: string;
}

/** "Lust — Thoth" · "Strength, reversed — Rider–Waite–Smith". Deck-native, always. */
export function cardAltText(card: Pick<CardView, 'name' | 'deck_name'>, orientation: Orientation) {
  return `${card.name}${orientation === 'reversed' ? ', reversed' : ''} — ${card.deck_name}`;
}

/**
 * A tarot card. Bundled art is served as a plain <picture> with hand-built srcsets (the image
 * optimizer would only re-encode already-optimised AVIF/WebP). Renders bundled art when the row has `art_asset_path`, otherwise the
 * typographic treatment (Thoth ships text-only, §6.7). Reversal is shown by rotating the
 * face *and* by an explicit label — never by rotation or colour alone.
 *
 * Names, titles and glyphs come straight from the `cards` row passed in. This component
 * never consults archetypes (invariant: thoth-never-substitutes-rws).
 */
export function Card({
  card,
  orientation = 'upright',
  size = 'md',
  caption = false,
  loading = false,
  priority = false,
  className,
}: CardProps) {
  const reversed = orientation === 'reversed';
  const alt = cardAltText(card, orientation);

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading card"
        className={cn(
          SIZE_CLASS[size],
          'aspect-[3/5] animate-pulse rounded-card bg-surface-2',
          className,
        )}
      />
    );
  }

  return (
    <figure
      data-deck={card.deck_system}
      data-orientation={orientation}
      className={cn('m-0 inline-flex flex-col items-center gap-1.5', SIZE_CLASS[size], className)}
    >
      <div className="relative w-full">
        <div
          className={cn(
            'w-full overflow-hidden rounded-card bg-surface hairline transition-transform ease-out',
            reversed && 'rotate-180',
          )}
        >
          {card.art_asset_path ? (
            <picture>
              <source
                type="image/avif"
                srcSet={artSrcSet(card.art_asset_path, 'avif')}
                sizes={SIZE_PX[size]}
              />
              <source
                type="image/webp"
                srcSet={artSrcSet(card.art_asset_path, 'webp')}
                sizes={SIZE_PX[size]}
              />
              <img
                src={`${card.art_asset_path}-320.webp`}
                alt={alt}
                width={320}
                height={533}
                loading={priority ? 'eager' : 'lazy'}
                decoding="async"
                className="block aspect-[3/5] h-auto w-full object-cover"
              />
            </picture>
          ) : (
            <TypographicFace card={card} alt={alt} size={size} />
          )}
        </div>
        {reversed ? (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-chip bg-surface/95 px-1.5 py-0.5 text-[0.625rem] leading-none font-medium tracking-wide text-fg uppercase hairline">
            Reversed
          </span>
        ) : null}
      </div>
      {caption ? (
        <figcaption className="max-w-full text-center text-xs leading-tight text-fg-muted">
          <span className="block truncate font-medium text-fg">{card.name}</span>
          {reversed ? <span className="block">Reversed</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Sigil({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-[1em]', className)}>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The designed text-only face. Deck-native name, numeral, title, suit glyph, element sigil and
 * astrological glyphs on a quiet tinted ground with a double hairline frame. It is an intentional
 * treatment, not a missing image: the whole composition scales in em from one per-size font
 * size, and simplifies at the smallest sizes instead of clipping.
 */
const FACE_FONT: Record<CardSize, string> = {
  xs: 'text-[0.5rem]',
  sm: 'text-[0.66rem]',
  md: 'text-[0.95rem]',
  lg: 'text-[1.45rem]',
};

function TypographicFace({ card, alt, size }: { card: CardView; alt: string; size: CardSize }) {
  const tiny = size === 'xs';
  const small = size === 'sm';
  const glyphs = astrologyGlyphs(card.astrology);
  const hebrew = hebrewLetter(card.correspondences.hebrew_letter);
  const element = card.element ? ELEMENT_SIGIL[card.element] : null;
  const suit = card.suit ? SUIT_GLYPH[card.suit] : null;
  const isMajor = card.arcana === 'major';
  const corner = isMajor
    ? card.numeral
    : (card.rank_label ?? (card.number !== null ? String(card.number) : null));

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        'relative flex aspect-[3/5] w-full flex-col justify-between overflow-hidden p-[10%] text-fg select-none',
        'bg-[radial-gradient(120%_90%_at_50%_0%,var(--accent-soft),var(--surface)_70%)]',
        FACE_FONT[size],
      )}
    >
      {/* Double inner frame */}
      <div
        aria-hidden="true"
        // Percent insets on top/bottom resolve against height; 2.7% of a 3:5 height ≈ 4.5% of width.
        className="pointer-events-none absolute inset-x-[4.5%] inset-y-[2.7%] rounded-[calc(var(--radius-card)-4px)] border border-accent/60"
      />
      {!tiny ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[7%] inset-y-[4.2%] rounded-[calc(var(--radius-card)-7px)] border border-accent/25"
        />
      ) : null}

      {/* Top row: numeral / rank · Hebrew letter or suit glyph */}
      <div className="relative z-10 flex items-start justify-between text-[0.55em] leading-none text-accent">
        <span className="font-sans font-medium tracking-wide">{tiny ? '' : corner}</span>
        {isMajor && hebrew ? (
          <span className="font-serif text-[1.35em]" lang="he">
            {hebrew}
          </span>
        ) : suit ? (
          <Sigil d={suit} className="size-[1.4em]" />
        ) : null}
      </div>

      {/* Centre: numeral or suit glyph, name, title */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-[0.35em] text-center">
        {isMajor ? (
          <span
            aria-hidden="true"
            className={cn(
              'font-serif leading-none text-accent/70',
              tiny ? 'text-[1.6em]' : 'text-[2.4em]',
            )}
          >
            {card.numeral}
          </span>
        ) : suit ? (
          <Sigil d={suit} className={cn('text-accent', tiny ? 'size-[1.6em]' : 'size-[2.6em]')} />
        ) : null}
        {!tiny ? (
          <span className="font-serif text-[1.05em] leading-[1.1] font-medium tracking-tight text-balance">
            {card.name}
          </span>
        ) : !isMajor ? (
          <span className="font-serif text-[0.9em] leading-none font-medium">{corner}</span>
        ) : null}
        {card.title && !tiny && !small ? (
          <span className="font-serif text-[0.78em] leading-tight text-accent italic">
            {card.title}
          </span>
        ) : null}
      </div>

      {/* Bottom row: element sigil · astrological glyphs */}
      <div className="relative z-10 flex items-end justify-between text-[0.6em] leading-none text-accent">
        {element ? <Sigil d={element.d} className="size-[1.3em]" /> : <span />}
        {glyphs.length && !tiny ? (
          <span className="font-sans tracking-[0.12em]">{glyphs.join('')}</span>
        ) : null}
      </div>
    </div>
  );
}
